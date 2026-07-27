"""
Shared singleton for the embedding model.
Uses ONNX Runtime exclusively for inference (no PyTorch or SentenceTransformers dependency).
"""

import os
import sys
import glob
import numpy as np

# Resolve backend directory and models cache directory
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MODELS_DIR = os.getenv("IF_MODELS_DIR", os.path.join(_BACKEND_DIR, 'models'))

MODEL_NAME = os.getenv("IF_MODEL_PATH", "Xenova/bge-small-en-v1.5")

MODEL_LOAD_ERROR = None
_backend_name = "unknown"

# ── 1. Locate the ONNX file and tokenizer ────────────────────
_cache_name = MODEL_NAME.replace("/", "--")
_model_cache_dir = os.path.join(_MODELS_DIR, f"models--{_cache_name}")

_onnx_path = None
_tokenizer_path = None
if os.path.isdir(_model_cache_dir):
    onnx_files = glob.glob(os.path.join(_model_cache_dir, '**', 'model.onnx'), recursive=True)
    if onnx_files:
        _onnx_path = onnx_files[0]
    tokenizer_files = glob.glob(os.path.join(_model_cache_dir, '**', 'tokenizer.json'), recursive=True)
    if tokenizer_files:
        _tokenizer_path = tokenizer_files[0]

# ── 2. Initialize Model & Tokenizer ──────────────────────────
_tokenizer = None
_session = None
_MAX_SEQ_LEN = 512


def _detect_max_seq_len(session, tokenizer):
    """Best-effort detection of the model's maximum input length."""
    candidates = []

    if session is not None:
        try:
            first_input = session.get_inputs()[0]
            shape = getattr(first_input, 'shape', None) or []
            for dim in shape:
                if isinstance(dim, int) and dim > 0:
                    candidates.append(dim)
        except Exception:
            pass

    if tokenizer is not None:
        try:
            model_max_length = getattr(tokenizer, 'model_max_length', None)
            if isinstance(model_max_length, int) and model_max_length > 0:
                candidates.append(model_max_length)
        except Exception:
            pass

    # BGE-small uses a 512-token context window; fall back to that if we cannot
    # derive a concrete static length from the tokenizer or ONNX session.
    for value in candidates:
        if 1 <= value <= 4096:
            return value

    return 512

def is_model_loaded():
    return _session is not None and _tokenizer is not None

try:
    if _onnx_path:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        # Load Tokenizer
        _tokenizer = Tokenizer.from_file(_tokenizer_path)

        # Load ONNX Session
        _session = ort.InferenceSession(
            _onnx_path,
            providers=['CPUExecutionProvider']
        )

        _MAX_SEQ_LEN = _detect_max_seq_len(_session, _tokenizer)
        try:
            _tokenizer.enable_truncation(max_length=_MAX_SEQ_LEN)
            _tokenizer.enable_padding(length=_MAX_SEQ_LEN)
        except Exception:
            # If the tokenizer backend rejects the settings, we still clamp in
            # _encode() as a second line of defense.
            pass
        
        _backend_name = "ONNX Runtime + CPU"
        sys.stderr.write(f"[model] Loaded with {_backend_name} backend\n")
    else:
        sys.stderr.write(
            f"[model] WARNING: ONNX model or tokenizer not found in {_model_cache_dir}. "
            f"Run first-time setup to download the model.\n"
        )
except Exception as e:
    MODEL_LOAD_ERROR = f"ONNX load failed: {e}"
    sys.stderr.write(f"[model] Failed to load ONNX pipeline: {e}\n")

sys.stderr.flush()

# BGE models benefit from a query instruction prefix
_BGE_PREFIX = "Represent this sentence for searching relevant passages: "

def encode_query(text):
    """Encode a search query using ONNX Runtime directly."""
    if "bge" in MODEL_NAME.lower():
        text = _BGE_PREFIX + text
        
    return _encode([text])[0]

def encode(texts, normalize_embeddings=True, batch_size=32, **kwargs):
    """Fallback list-based encode method for chunker compatability."""
    return _encode(texts, normalize=normalize_embeddings, batch_size=batch_size)

def _encode(texts, normalize=True, batch_size=32):
    """Core ONNX inference pipeline for text embeddings."""
    if not is_model_loaded():
        raise RuntimeError(f"Embedding model is not loaded. Error: {MODEL_LOAD_ERROR}")
        
    all_embeddings = []
    
    # Process in batches to prevent Out-Of-Memory errors
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]
        
        # Tokenize
        encoded = _tokenizer.encode_batch(batch_texts)
        max_len = _MAX_SEQ_LEN
        if encoded:
            max_len = min(max(len(item.ids) for item in encoded), _MAX_SEQ_LEN)
        input_ids = np.zeros((len(encoded), max_len), dtype=np.int64)
        attention_mask = np.zeros((len(encoded), max_len), dtype=np.int64)
        token_type_ids = np.zeros((len(encoded), max_len), dtype=np.int64)

        for row, item in enumerate(encoded):
            ids = item.ids[:max_len]
            input_ids[row, :len(ids)] = ids
            attention_mask[row, :len(ids)] = 1
            try:
                type_ids = item.type_ids[:max_len]
                token_type_ids[row, :len(type_ids)] = type_ids
            except Exception:
                pass

        # Prepare ONNX inputs
        ort_inputs = {
            'input_ids': input_ids,
            'attention_mask': attention_mask
        }

        # Some exported ONNX models (BERT-style) require `token_type_ids`.
        # If the session expects that input but tokenizer did not return it,
        # provide a default all-zero token_type_ids array to avoid missing-input errors.
        try:
            session_input_names = [inp.name for inp in _session.get_inputs()]
            if 'token_type_ids' in session_input_names and 'token_type_ids' not in ort_inputs:
                ort_inputs['token_type_ids'] = token_type_ids
        except Exception:
            # Non-fatal: if we cannot inspect inputs for any reason, continue and let ONNX raise a clear error
            pass

        # Run inference
        outputs = _session.run(None, ort_inputs)
        
        # CLS Pooling (take the first token's output)
        embeddings = outputs[0][:, 0]
        
        # L2 Normalization
        if normalize:
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            # Avoid division by zero
            norms = np.where(norms == 0, 1e-10, norms)
            embeddings = embeddings / norms
            
        all_embeddings.append(embeddings.astype("float32"))
        
    return np.vstack(all_embeddings)

# Monkey-patch to expose encode directly on the module so old code can use `MODEL.encode`
class _ModelMock:
    @staticmethod
    def encode(texts, normalize_embeddings=True, batch_size=32, **kwargs):
        return encode(texts, normalize_embeddings, batch_size, **kwargs)
        
    @staticmethod
    def get_embedding_dimension():
        return 384
        
    @staticmethod
    def get_sentence_embedding_dimension():
        return 384

MODEL = _ModelMock() if is_model_loaded() else None
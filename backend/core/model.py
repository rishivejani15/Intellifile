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

# ── 1. Locate the ONNX file ──────────────────────────────────
_cache_name = MODEL_NAME.replace("/", "--")
_model_cache_dir = os.path.join(_MODELS_DIR, f"models--{_cache_name}")

_onnx_path = None
if os.path.isdir(_model_cache_dir):
    onnx_files = glob.glob(os.path.join(_model_cache_dir, '**', 'model.onnx'), recursive=True)
    if onnx_files:
        _onnx_path = onnx_files[0]

# ── 2. Initialize Model & Tokenizer ──────────────────────────
_tokenizer = None
_session = None

def is_model_loaded():
    return _session is not None and _tokenizer is not None

try:
    if _onnx_path:
        import onnxruntime as ort
        from transformers import AutoTokenizer

        # Load Tokenizer
        _tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME, 
            cache_dir=_MODELS_DIR, 
            local_files_only=True
        )

        # Load ONNX Session
        _session = ort.InferenceSession(
            _onnx_path, 
            providers=['CPUExecutionProvider']
        )
        
        _backend_name = "ONNX Runtime + CPU"
        sys.stderr.write(f"[model] Loaded with {_backend_name} backend\n")
    else:
        sys.stderr.write(
            f"[model] WARNING: ONNX model not found in {_model_cache_dir}. "
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
        inputs = _tokenizer(
            batch_texts, 
            padding=True, 
            truncation=True, 
            max_length=512, 
            return_tensors="np"
        )

        # Prepare ONNX inputs
        ort_inputs = {
            'input_ids': inputs['input_ids'].astype(np.int64),
            'attention_mask': inputs['attention_mask'].astype(np.int64)
        }
        if 'token_type_ids' in inputs:
             ort_inputs['token_type_ids'] = inputs['token_type_ids'].astype(np.int64)

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
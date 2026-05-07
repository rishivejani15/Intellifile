"""
Shared singleton for the SentenceTransformer model.
Import `MODEL` from here instead of creating new instances.
"""

import os
import sys
from sentence_transformers import SentenceTransformer

# Use all CPU cores for PyTorch inference (significant speedup on multi-core)
try:
    import torch
    _n = max(os.cpu_count() or 4, 4)
    torch.set_num_threads(_n)
    torch.set_num_interop_threads(max(_n // 2, 1))
except Exception:
    pass

# Resolve backend directory and models cache directory
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MODELS_DIR = os.getenv("IF_MODELS_DIR", os.path.join(_BACKEND_DIR, 'models'))

MODEL_NAME = os.getenv("IF_MODEL_PATH", "BAAI/bge-small-en-v1.5")

# Force offline loading when model is already cached locally
_cache_name = MODEL_NAME.replace("/", "--")
_local_cached = any(
    os.path.isdir(os.path.join(_MODELS_DIR, d))
    for d in [f"models--{_cache_name}", f"models--sentence-transformers--{_cache_name}"]
)

# Allow runtime downloads only when explicitly enabled by env var
# Default: do NOT attempt network download inside packaged apps
_allow_download = os.getenv("IF_ALLOW_MODEL_DOWNLOAD", "0") in ("1", "true", "True")

# ── Try ONNX Runtime backend (3-5x faster on CPU) ────────
_onnx_dir = os.path.join(_MODELS_DIR, "onnx-export", _cache_name)
_onnx_ready = os.path.isdir(_onnx_dir) and any(
    f.endswith(".onnx")
    for root, _, files in os.walk(_onnx_dir)
    for f in files
)

_model_kwargs = dict(
    cache_folder=_MODELS_DIR,
    local_files_only=not _allow_download and not _local_cached,
)

MODEL = None
MODEL_LOAD_ERROR = None
_backend_name = "unknown"

def is_model_loaded():
    return MODEL is not None

if _onnx_ready:
    try:
        import onnxruntime  # noqa: F401
        MODEL = SentenceTransformer(
            _onnx_dir,
            backend="onnx",
            model_kwargs={"provider": "CPUExecutionProvider"},
            device="cpu",
        )
        _backend_name = "ONNX Runtime + CPU"
    except Exception as e:
        sys.stderr.write(f"[model] ONNX load failed: {e}\n")
        MODEL = None

if MODEL is None:
    try:
        MODEL = SentenceTransformer(model_name_or_path=MODEL_NAME, **_model_kwargs)
        _backend_name = "PyTorch"
        sys.stderr.write(f"[model] Loaded with {_backend_name} backend\n")
    except Exception as e:
        MODEL = None
        MODEL_LOAD_ERROR = str(e)
        sys.stderr.write(f"[model] Failed to load model '{MODEL_NAME}': {e}\n")

sys.stderr.flush()

# BGE models benefit from a query instruction prefix
_BGE_PREFIX = "Represent this sentence for searching relevant passages: "


def encode_query(text):
    """Encode a search query, applying model-specific instruction prefix."""
    if "bge" in MODEL_NAME.lower():
        text = _BGE_PREFIX + text
    return MODEL.encode(text, normalize_embeddings=True).astype("float32")
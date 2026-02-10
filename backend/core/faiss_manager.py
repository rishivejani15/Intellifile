import faiss
import os

# Resolve data directory relative to this file's location
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(_BACKEND_DIR, 'data', 'vectors.faiss')

# ── In-memory singleton ──────────────────────────────────
_cached_index = None


def load_index(dim=None, force_reload=False):
    """Return the FAISS index, loading from disk only once.
    Returns None when no index file exists and no dim is given."""
    global _cached_index
    if _cached_index is not None and not force_reload:
        return _cached_index

    if os.path.exists(INDEX_PATH):
        _cached_index = faiss.read_index(INDEX_PATH)
    elif dim is not None:
        base = faiss.IndexFlatIP(dim)          # Inner-Product (cosine with normalized vecs)
        _cached_index = faiss.IndexIDMap(base)
    else:
        # No index yet — return None instead of crashing
        return None

    return _cached_index


def save_index(index=None):
    """Persist the index to disk and update the cache."""
    global _cached_index
    if index is not None:
        _cached_index = index
    if _cached_index is None:
        raise RuntimeError("No index to save")
    os.makedirs(os.path.dirname(INDEX_PATH), exist_ok=True)
    faiss.write_index(_cached_index, INDEX_PATH)


def invalidate_cache():
    """Force the next load_index() to re-read from disk."""
    global _cached_index
    _cached_index = None

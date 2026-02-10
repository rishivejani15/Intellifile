import faiss
import os

INDEX_PATH = "data/vectors.faiss"

def load_index(dim=None):
    if os.path.exists(INDEX_PATH):
        return faiss.read_index(INDEX_PATH)
    if dim is None:
        raise ValueError("Dimension required for new index")
    base = faiss.IndexFlatL2(dim)
    return faiss.IndexIDMap(base)

def save_index(index):
    faiss.write_index(index, INDEX_PATH)

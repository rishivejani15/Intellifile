import faiss
import numpy as np
from core.model import MODEL
from core.db import get_connection
from core.faiss_manager import save_index


def build_faiss():
    """Build the entire FAISS index from scratch using all chunks in the DB."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id, text FROM chunks ORDER BY id")
    rows = cur.fetchall()

    if not rows:
        raise RuntimeError("No chunks found.")

    texts = [text for _, text in rows]
    chunk_ids = np.array([cid for cid, _ in rows], dtype="int64")

    embeddings = MODEL.encode(
        texts,
        normalize_embeddings=True,
        batch_size=256,
        show_progress_bar=True,
    ).astype("float32")

    dim = embeddings.shape[1]
    base_index = faiss.IndexFlatIP(dim)          # cosine similarity (vecs are normalized)
    index = faiss.IndexIDMap(base_index)
    index.add_with_ids(embeddings, chunk_ids)

    save_index(index)

    conn.close()
    print(f"FAISS index built with {len(chunk_ids)} chunks.")

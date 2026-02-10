import faiss
import numpy as np
from core.model import MODEL
from core.db import get_connection
from core.faiss_manager import load_index, save_index


def update_faiss(chunk_ids):
    if not chunk_ids:
        print("No FAISS update needed.")
        return

    # Deduplicate IDs
    chunk_ids = list(set(chunk_ids))
    ids_np = np.array(chunk_ids, dtype="int64")

    conn = get_connection()
    cur = conn.cursor()

    placeholders = ",".join("?" * len(chunk_ids))
    cur.execute(
        f"SELECT id, text FROM chunks WHERE id IN ({placeholders})",
        chunk_ids,
    )
    rows = cur.fetchall()
    conn.close()

    # Load cached index (force_reload after external writes)
    index = load_index(force_reload=True)

    if index is None:
        # First run — no index exists yet, create a fresh one
        dim = MODEL.get_sentence_embedding_dimension()
        base = faiss.IndexFlatIP(dim)
        index = faiss.IndexIDMap(base)
    else:
        # Remove affected IDs (safe even if missing)
        index.remove_ids(ids_np)

    if not rows:
        save_index(index)
        print(f"FAISS removed {len(ids_np)} deleted chunks.")
        return

    # Re-add updated chunks
    texts = [t for _, t in rows]
    ids_existing = np.array([cid for cid, _ in rows], dtype="int64")

    embeddings = MODEL.encode(
        texts,
        normalize_embeddings=True,
        batch_size=64,
    ).astype("float32")

    index.add_with_ids(embeddings, ids_existing)
    save_index(index)

    print(f"FAISS updated for {len(ids_existing)} chunks.")

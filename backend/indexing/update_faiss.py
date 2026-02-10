import numpy as np
from sentence_transformers import SentenceTransformer
from backend.core.db import get_connection
from backend.core.crypto_utils import decrypt_text
from backend.core.faiss_manager import load_index, save_index

MODEL = SentenceTransformer("all-MiniLM-L6-v2")

def update_faiss(chunk_ids):
    if not chunk_ids:
        print("No FAISS update needed.")
        return

    # 1️⃣ Deduplicate IDs
    chunk_ids = list(set(chunk_ids))
    ids_np = np.array(chunk_ids, dtype="int64")

    conn = get_connection()
    cur = conn.cursor()

    # 2️⃣ Fetch existing chunks
    placeholders = ",".join("?" * len(chunk_ids))
    cur.execute(
        f"SELECT id, text FROM chunks WHERE id IN ({placeholders})",
        chunk_ids
    )
    rows = cur.fetchall()
    conn.close()

    # 3️⃣ Load FAISS index
    index = load_index()

    # 4️⃣ Always remove affected IDs (safe even if missing)
    index.remove_ids(ids_np)

    if not rows:
        # All affected chunks were deleted
        save_index(index)
        print(f"FAISS removed {len(ids_np)} deleted chunks.")
        return

    # 5️⃣ Re-add existing / updated chunks
    texts = [decrypt_text(t) for _, t in rows]
    ids_existing = np.array([cid for cid, _ in rows], dtype="int64")

    embeddings = MODEL.encode(
        texts,
        normalize_embeddings=True,
        batch_size=16
    ).astype("float32")

    index.add_with_ids(embeddings, ids_existing)
    save_index(index)

    print(f"FAISS updated for {len(ids_existing)} chunks.")

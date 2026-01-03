import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from db import get_connection

def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(vec)
    if n == 0:
        return vec
    return vec / n

def _chunk_text(text: str, max_chars: int = 1500, overlap: int = 200):
    text = text or ""
    chunks = []
    start = 0
    end = len(text)
    while start < end:
        stop = min(start + max_chars, end)
        chunk = text[start:stop]
        chunks.append(chunk)
        if stop >= end:
            break
        start = max(0, stop - overlap)
    return chunks

# Allow swapping in a fine-tuned model via environment variable
MODEL_PATH = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_PATH)

def build_faiss():
    conn = get_connection()
    curr = conn.cursor()

    curr.execute("SELECT id, content FROM files")
    rows = curr.fetchall()

    embeddings = []
    ids = []  # store [file_id, chunk_idx]

    for file_id, content in rows:
        for cidx, chunk in enumerate(_chunk_text(content)):
            emb = MODEL.encode(chunk)
            emb = _l2_normalize(emb).astype("float32")
            embeddings.append(emb)
            ids.append([int(file_id), int(cidx)])

    if len(embeddings) == 0:
        # Write empty index and ids for consistency
        dim = 384
        index = faiss.IndexFlatIP(dim)
        faiss.write_index(index, "data/vectors.faiss")
        np.save("data/ids.npy", np.array([], dtype=np.int64).reshape(0, 2))
        print("No embeddings to index.")
        conn.close()
        return

    embeddings = np.array(embeddings, dtype="float32")

    # Cosine similarity via inner product on normalized vectors
    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(embeddings)

    faiss.write_index(index, "data/vectors.faiss")

    ids_arr = np.array(ids, dtype=np.int64)
    np.save("data/ids.npy", ids_arr)

    print(f"Embeddings built successfully! total_chunks={len(ids)}")

    conn.close()
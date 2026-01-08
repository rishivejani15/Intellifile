import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from db import get_connection

MODEL_PATH = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_PATH)

index = faiss.read_index("data/vectors.faiss")

chunk_map = np.load("data/chunk_ids.npy", allow_pickle=True)

def semantic_search(query, top_k=50, min_similarity=0.3):
    q_emb = MODEL.encode(
        query,
        normalize_embeddings=True
    ).astype("float32").reshape(1, -1)

    distances, indices = index.search(q_emb, top_k)

    conn = get_connection()
    cur = conn.cursor()

    file_scores = {}

    for idx, dist in zip(indices[0], distances[0]):
        if idx == -1:
            continue

        similarity = 1 - (dist / 2)

        # Ignore very weak matches
        if similarity < min_similarity:
            continue

        file_id, _ = chunk_map[idx]

        # Keep BEST score per file
        if file_id not in file_scores or similarity > file_scores[file_id]:
            file_scores[file_id] = similarity

    if not file_scores:
        conn.close()
        return []

    # Fetch file paths
    results = []
    for file_id, score in file_scores.items():
        cur.execute(
            "SELECT path FROM files WHERE id=?",
            (int(file_id),)
        )
        row = cur.fetchone()
        if row:
            results.append((row[0], score))

    conn.close()

    # Sort files by best similarity score (DESC)
    results.sort(key=lambda x: x[1], reverse=True)
    return results

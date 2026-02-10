import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from backend.core.db import get_connection

MODEL_PATH = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_PATH)


# chunk_map = np.load("data/chunk_ids.npy", allow_pickle=True)

def semantic_search(query, top_k=20, min_similarity=0.3):
    index = faiss.read_index("data/vectors.faiss")
    
    q_emb = MODEL.encode(
        query,
        normalize_embeddings=True
    ).astype("float32").reshape(1, -1)

    distances, chunk_ids = index.search(q_emb, top_k * 3)

    conn = get_connection()
    cur = conn.cursor()

    file_scores = {}

    for chunk_id, dist in zip(chunk_ids[0], distances[0]):
        if chunk_id == -1:
            continue

        similarity = 1 - (dist / 2)

        # Ignore very weak matches
        if similarity < min_similarity:
            continue
        
        cur.execute("""
                    SELECT files.path
                    from chunks
                    JOIN files ON chunks.file_id = files.id
                    WHERE chunks.id = ?
                    """,(int(chunk_id),))
        
        row = cur.fetchone()
        if not row:
            continue
        
        path = row[0]
        if path not in file_scores or similarity > file_scores[path]:
            file_scores[path] = similarity    

    conn.close()

    # Sort files by best similarity score (DESC)
    return sorted(file_scores.items(), key=lambda x: x[1], reverse=True)

def keyword_filter(query, limit=500):
    conn = get_connection()
    cur = conn.cursor()

    pattern = f"%{query}%"

    cur.execute("""
    SELECT id FROM chunks
    WHERE text LIKE ?
    LIMIT ?
    """, (pattern, limit))

    rows = cur.fetchall()
    conn.close()

    return [r[0] for r in rows]

def hybrid_search(query, top_k=20):
    candidate_chunk_ids = keyword_filter(query)

    # 🔁 Fallback to PURE semantic search
    if not candidate_chunk_ids:
        return semantic_search(query, top_k)

    index = faiss.read_index("data/vectors.faiss")

    q_emb = MODEL.encode(query, normalize_embeddings=True)
    q_emb = q_emb.astype("float32").reshape(1, -1)

    # fetch more chunks for diversity
    distances, chunk_ids = index.search(q_emb, top_k * 3)

    conn = get_connection()
    cur = conn.cursor()

    file_scores = {}

    candidate_set = set(candidate_chunk_ids)

    for chunk_id, dist in zip(chunk_ids[0], distances[0]):
        if chunk_id == -1 or chunk_id not in candidate_set:
            continue

        similarity = 1 - (dist / 2)

        cur.execute("""
        SELECT files.path
        FROM chunks
        JOIN files ON chunks.file_id = files.id
        WHERE chunks.id = ?
        """, (int(chunk_id),))

        row = cur.fetchone()
        if not row:
            continue

        path = row[0]
        if path not in file_scores or similarity > file_scores[path]:
            file_scores[path] = similarity

    conn.close()

    return sorted(file_scores.items(), key=lambda x: x[1], reverse=True)

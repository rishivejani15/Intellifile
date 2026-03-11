import os
import faiss
import numpy as np
import sys
from sentence_transformers import SentenceTransformer
from .db import get_connection
from .extractor import extract_text
from .chunker import chunk_text

MODEL_PATH = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_PATH)

data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
index_path = os.path.join(data_dir, "vectors.faiss")
chunk_ids_path = os.path.join(data_dir, "chunk_ids.npy")


def check_for_faiss():
    return os.path.exists(index_path)

def reload_index():
    global index
    if os.path.exists(index_path):
        try:
            index = faiss.read_index(index_path)
            print(f"Index reloaded with {index.ntotal} vectors.")
        except Exception as e:
            print(f"Error reloading index: {e}")
            index = None
    else:
        index = None

# Initial load
reload_index()

def semantic_search(query, top_k=50, min_similarity=0.0):
    reload_index()
    if index is None:
        return []

    # Find the most recent created_at
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT MAX(created_at) FROM chunks")
    max_created_at = cur.fetchone()[0]
    
    # Only search chunks from the most recent upload
    cur.execute("""
    SELECT id, text
    FROM chunks
    WHERE created_at = ?
    ORDER BY id
    """, (max_created_at,))
    
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return []

    # For simplicity, since index is global, but we'll filter results
    # Actually, to properly filter, we need to search only these ids
    # But since FAISS has all, we'll search all and filter results
    # But for now, since the index has ids, and we can check if id in recent_ids

    recent_ids = {row[0] for row in rows}
    
    q_emb = MODEL.encode(
        query,
        normalize_embeddings=True
    ).astype("float32").reshape(1, -1)

    distances, indices = index.search(q_emb, top_k * 2)  # Search more to filter
    
    results = []

    for idx, dist in zip(indices[0], distances[0]):
        if idx == -1:
            continue

        similarity = dist  # Since we're using IP with normalized vectors, distance is cosine similarity

        if similarity < min_similarity:
            continue

        chunk_id = idx  # Since we're using IDMap, indices are the chunk IDs

        if chunk_id not in recent_ids:
            continue

        # Get chunk text
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT text FROM chunks WHERE id=?", (int(chunk_id),))
        row = cur.fetchone()
        conn.close()
        if not row:
            continue
        chunk_text_data = row[0]

        results.append((chunk_text_data, similarity))

    # Sort by similarity DESC
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_k]

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python search.py <query>")
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    print(f"DEBUG: Searching for '{query}'")
    results = semantic_search(query)
    print(f"DEBUG: Found {len(results)} results")
    for text, score in results:
        # Replace newlines with spaces to avoid parsing issues
        safe_text = text.replace('\n', ' ').replace('\r', ' ')
        try:
            print(f"{safe_text.encode('ascii', errors='replace').decode('ascii')}\t{score}")
        except Exception:
            pass
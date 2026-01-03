import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from db import get_connection

# Configurable model path to allow fine-tuned models
MODEL_PATH = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_PATH)

index = faiss.read_index("data/vectors.faiss")
ids = np.load("data/ids.npy")

def semantic_search(query, top_k = 5):
    q_emb = MODEL.encode(query)
    # Normalize to use cosine similarity with IP index
    n = np.linalg.norm(q_emb)
    if n != 0:
        q_emb = (q_emb / n)
    q_emb = q_emb.astype("float32").reshape(1, -1)
    distances, indices = index.search(q_emb, top_k)
    
    conn = get_connection()
    curr = conn.cursor()
    
    results = []
    for idx, dist in zip(indices[0], distances[0]):
        if idx < 0:
            continue
        # ids can be shape (N,) or (N,2) -> [file_id, chunk_idx]
        id_row = ids[idx]
        file_id = int(id_row[0]) if isinstance(id_row, (list, tuple, np.ndarray)) and np.ndim(id_row) > 0 else int(id_row)
        curr.execute("SELECT path FROM files WHERE id = ?",(file_id,))
        # print("FAISS idx:", index, "file_id:", file_id)
        row = curr.fetchone()
        if row is None:
            continue  # skip broken reference safely

        path = row[0]
        results.append((path, dist))
    
    conn.close()
    return results
    
    
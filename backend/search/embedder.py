import faiss
import numpy as np
import os
from sentence_transformers import SentenceTransformer
from .db import get_connection

MODEL = SentenceTransformer("all-MiniLM-L6-v2")

def build_faiss():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
    SELECT id, text
    FROM chunks
    ORDER BY id
    """)

    rows = cur.fetchall()

    embeddings = []
    chunk_ids = []

    print(f"DEBUG: Found {len(rows)} chunks in database.")
    
    for chunk_id, text in rows:
        # Correctly encode
        emb = MODEL.encode([text])[0]
        
        embeddings.append(emb)
        chunk_ids.append(chunk_id)
    
    if not embeddings:
        print("DEBUG: No embeddings created.")
        return

    embeddings = np.array(embeddings).astype("float32")
    
    # Create FAISS index with Inner Product (cosine similarity) and ID mapping
    dim = embeddings.shape[1]
    base_index = faiss.IndexHNSWFlat(dim, 32, faiss.METRIC_INNER_PRODUCT)
    index = faiss.IndexIDMap2(base_index)
    faiss.normalize_L2(embeddings)
    index.add_with_ids(embeddings, np.array(chunk_ids, dtype=np.int64))
    
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    os.makedirs(data_dir, exist_ok=True)
    
    faiss.write_index(index, os.path.join(data_dir, "vectors.faiss"))
    
    conn.close()
    print(f"DEBUG: Saved FAISS index with {len(chunk_ids)} vectors.")

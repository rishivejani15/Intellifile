import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from backend.core.crypto_utils import decrypt_text
from backend.core.extractor import extract_text
from backend.core.chunker import chunk_text
from backend.core.db import get_connection

MODEL = SentenceTransformer("all-MiniLM-L6-v2")

def build_faiss():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id,text FROM chunks ORDER BY id")

    rows = cur.fetchall()
    
    if not rows:
        raise RuntimeError("No chunks found.")

    embeddings = []
    chunk_ids = []

    for chunk_id, text in rows:
        plain_text = decrypt_text(text)
        emb = MODEL.encode(
            plain_text,
            normalize_embeddings=True
        )

        embeddings.append(emb)
        chunk_ids.append(chunk_id)

    if not embeddings:
        raise RuntimeError("No embeddings created.")

    embeddings = np.array(embeddings).astype("float32")
    chunk_ids = np.array(chunk_ids).astype("int64")  

    dim = embeddings.shape[1]
    
    base_index = faiss.IndexFlatL2(dim)
    index = faiss.IndexIDMap(base_index)

    index.add_with_ids(embeddings,chunk_ids)
    
    faiss.write_index(index, "data/vectors.faiss")
    # np.save("data/chunk_ids.npy", chunk_ids, allow_pickle=True)
    
    conn.close()
    print("FAISS index built correctly.")

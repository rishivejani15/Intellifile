import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from extractor import extract_text
from chunker import chunk_text
from db import get_connection

MODEL = SentenceTransformer("all-MiniLM-L6-v2")

def build_faiss():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
    SELECT chunks.id, chunks.chunk_index, files.path
    FROM chunks
    JOIN files ON chunks.file_id = files.id
    ORDER BY chunks.id
    """)

    rows = cur.fetchall()

    embeddings = []
    chunk_ids = []

    for chunk_id, chunk_index, path in rows:
        text = extract_text(path)
        chunks = chunk_text(text)

        if chunk_index >= len(chunks):
            continue  # safety check

        chunk_text_data = chunks[chunk_index]

        emb = MODEL.encode(
            chunk_text_data,
            normalize_embeddings=True
        )

        embeddings.append(emb)
        cur.execute("SELECT file_id FROM chunks WHERE id=?", (chunk_id,))
        file_id = cur.fetchone()[0]

        chunk_ids.append((file_id, chunk_index))

    if not embeddings:
        raise RuntimeError("No embeddings created.")

    embeddings = np.array(embeddings).astype("float32")

    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)

    faiss.write_index(index, "data/vectors.faiss")
    np.save("data/chunk_ids.npy", chunk_ids, allow_pickle=True)
    
    conn.close()
    print("Chunk embeddings indexed.")

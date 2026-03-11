import os
import numpy as np
from core.model import MODEL
from core.faiss_manager import load_index
from core.db import get_connection


def semantic_search(query, top_k=10, min_similarity=0.3):
    """Pure semantic search using cached FAISS index + batch SQL."""
    index = load_index()  # returns the in-memory singleton (or None)

    if index is None:
        return []  # no index yet — nothing to search

    if index.ntotal == 0:
        return []  # index exists but is empty

    q_emb = MODEL.encode(
        query,
        normalize_embeddings=True
    ).astype("float32").reshape(1, -1)

    scores, chunk_ids = index.search(q_emb, top_k * 2)

    # Gather valid hits
    valid = [
        (int(cid), float(sim))
        for cid, sim in zip(chunk_ids[0], scores[0])
        if cid != -1 and sim >= min_similarity
    ]

    if not valid:
        return []

    # ── Batch SQL instead of N+1 queries ─────────────
    ids_list = [v[0] for v in valid]
    sim_map = {v[0]: v[1] for v in valid}

    conn = get_connection()
    cur = conn.cursor()

    placeholders = ",".join("?" * len(ids_list))
    cur.execute(
        f"""
        SELECT chunks.id, files.path
        FROM chunks
        JOIN files ON chunks.file_id = files.id
        WHERE chunks.id IN ({placeholders})
        """,
        ids_list,
    )
    rows = cur.fetchall()
    conn.close()

    file_scores = {}
    for chunk_id, path in rows:
        sim = sim_map.get(chunk_id, 0)
        if path not in file_scores or sim > file_scores[path]:
            file_scores[path] = sim

    return sorted(file_scores.items(), key=lambda x: x[1], reverse=True)

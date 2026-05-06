import os
import sqlite3
import time
from typing import Dict, List, Sequence, Tuple

import faiss
import numpy as np

from core.chunker import chunk_text
from core.extractor import extract_text
from core.model import MODEL, encode_query
from core.paths import get_data_dir


_DATA_DIR = get_data_dir()
_CHAT_DB_PATH = os.path.join(_DATA_DIR, "chat_files.db")
_CHAT_INDEX_PATH = os.path.join(_DATA_DIR, "chat_vectors.faiss")

_cached_chat_index = None


def get_chat_connection() -> sqlite3.Connection:
    os.makedirs(_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(_CHAT_DB_PATH, timeout=20.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-32000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn


def init_chat_db() -> None:
    conn = get_chat_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE,
            filename TEXT,
            modified_time INTEGER
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER,
            chunk_index INTEGER,
            text TEXT,
            FOREIGN KEY(file_id) REFERENCES files(id)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_files_path ON files(path)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_chunks_file_id ON chunks(file_id)")
    conn.commit()
    conn.close()


def load_chat_index(dim: int = None, force_reload: bool = False):
    global _cached_chat_index
    if _cached_chat_index is not None and not force_reload:
        return _cached_chat_index

    if os.path.exists(_CHAT_INDEX_PATH):
        _cached_chat_index = faiss.read_index(_CHAT_INDEX_PATH)
    elif dim is not None:
        _cached_chat_index = faiss.IndexIDMap(faiss.IndexFlatIP(dim))
    else:
        return None

    return _cached_chat_index


def save_chat_index(index=None) -> None:
    global _cached_chat_index
    if index is not None:
        _cached_chat_index = index
    if _cached_chat_index is None:
        raise RuntimeError("No chat index to save")
    os.makedirs(_DATA_DIR, exist_ok=True)
    faiss.write_index(_cached_chat_index, _CHAT_INDEX_PATH)


def invalidate_chat_cache() -> None:
    global _cached_chat_index
    _cached_chat_index = None


def reset_chat_store() -> Dict[str, object]:
    init_chat_db()
    conn = get_chat_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM chunks")
    cur.execute("DELETE FROM files")
    cur.execute("DELETE FROM sqlite_sequence WHERE name='chunks'")
    cur.execute("DELETE FROM sqlite_sequence WHERE name='files'")
    conn.commit()
    conn.close()

    dim = MODEL.get_embedding_dimension()
    empty_index = faiss.IndexIDMap(faiss.IndexFlatIP(dim))
    save_chat_index(empty_index)
    invalidate_chat_cache()
    return {"status": "success", "message": "Chat store reset."}


def _insert_chunks(file_id: int, chunks: Sequence[str]) -> List[int]:
    conn = get_chat_connection()
    cur = conn.cursor()
    chunk_ids: List[int] = []
    for idx, chunk in enumerate(chunks):
        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
            (file_id, idx, chunk),
        )
        chunk_ids.append(int(cur.lastrowid))
    conn.commit()
    conn.close()
    return chunk_ids


def ingest_chat_file(file_path: str, clear_existing: bool = True) -> Dict[str, object]:
    init_chat_db()

    abs_path = os.path.abspath(file_path)
    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f"File not found: {abs_path}")

    started = time.perf_counter()
    modified_time = int(os.path.getmtime(abs_path))
    filename = os.path.basename(abs_path)

    # Fast path for chat reopen: same single file, same mtime, and non-empty index.
    conn = get_chat_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM files")
    total_files = int(cur.fetchone()[0])
    cur.execute("SELECT id, modified_time FROM files WHERE path = ?", (abs_path,))
    existing = cur.fetchone()
    existing_file_id = int(existing[0]) if existing else None
    existing_mtime = int(existing[1]) if existing else None
    existing_chunk_count = 0
    if existing_file_id is not None:
        cur.execute("SELECT COUNT(*) FROM chunks WHERE file_id = ?", (existing_file_id,))
        existing_chunk_count = int(cur.fetchone()[0])
    conn.close()

    if clear_existing and existing_file_id is not None and existing_mtime == modified_time and total_files == 1:
        idx = load_chat_index()
        index_size = int(idx.ntotal) if idx is not None else 0
        if existing_chunk_count > 0 and index_size > 0:
            return {
                "status": "skipped",
                "file_id": existing_file_id,
                "path": abs_path,
                "filename": filename,
                "new_chunks": 0,
                "affected_chunk_ids": [],
                "reason": "unchanged",
                "skipped": True,
                "ingest_ms": int((time.perf_counter() - started) * 1000),
            }

    if clear_existing:
        reset_chat_store()

    conn = get_chat_connection()
    cur = conn.cursor()

    if existing_file_id is not None and not clear_existing:
        cur.execute("DELETE FROM chunks WHERE file_id = ?", (existing_file_id,))
        cur.execute(
            "UPDATE files SET filename = ?, modified_time = ? WHERE id = ?",
            (filename, modified_time, existing_file_id),
        )
        file_id = existing_file_id
    else:
        cur.execute(
            "INSERT OR REPLACE INTO files(path, filename, modified_time) VALUES (?, ?, ?)",
            (abs_path, filename, modified_time),
        )
        file_id = int(cur.lastrowid)
        if file_id == 0:
            cur.execute("SELECT id FROM files WHERE path = ?", (abs_path,))
            row = cur.fetchone()
            file_id = int(row[0]) if row else 0

    conn.commit()
    conn.close()

    text = extract_text(abs_path)
    chunks = chunk_text(text, chunk_size=900, overlap=120) if text and text.strip() else []
    name_no_ext = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    chunks.insert(0, f"{name_no_ext} {filename} {abs_path}")

    chunk_ids = _insert_chunks(file_id, chunks)
    embeddings = MODEL.encode(
        chunks,
        normalize_embeddings=True,
        batch_size=min(max(len(chunks), 8), 64),
        show_progress_bar=False,
    ).astype("float32")

    dim = embeddings.shape[1]
    index = faiss.IndexIDMap(faiss.IndexFlatIP(dim))
    index.add_with_ids(embeddings, np.asarray(chunk_ids, dtype="int64"))
    save_chat_index(index)
    invalidate_chat_cache()

    ingest_ms = int((time.perf_counter() - started) * 1000)
    return {
        "status": "indexed",
        "file_id": file_id,
        "path": abs_path,
        "filename": filename,
        "new_chunks": len(chunk_ids),
        "affected_chunk_ids": chunk_ids,
        "reason": "chat_isolated",
        "skipped": False,
        "ingest_ms": ingest_ms,
    }


def search_chat_chunks(query: str, top_k: int = 5, min_similarity: float = 0.18) -> List[Tuple[str, float]]:
    index = load_chat_index()
    if index is None or index.ntotal == 0:
        return []

    fetch_k = max(top_k * 2, top_k)
    query_embedding = encode_query(query).reshape(1, -1)
    scores, ids = index.search(query_embedding, fetch_k)

    ranked: List[Tuple[int, float]] = []
    for cid, sim in zip(ids[0], scores[0]):
        if int(cid) != -1 and float(sim) >= min_similarity:
            ranked.append((int(cid), float(sim)))

    if not ranked:
        return []

    chunk_ids = [cid for cid, _ in ranked]
    conn = get_chat_connection()
    cur = conn.cursor()
    placeholders = ",".join("?" * len(chunk_ids))
    cur.execute(
        f"SELECT id, text FROM chunks WHERE id IN ({placeholders})",
        chunk_ids,
    )
    rows = {int(cid): text for cid, text in cur.fetchall()}
    conn.close()

    ordered: List[Tuple[str, float]] = []
    for cid, sim in ranked:
        text = rows.get(cid)
        if text:
            ordered.append((text, sim))
            if len(ordered) >= top_k:
                break
    return ordered


def get_chat_index_size() -> int:
    idx = load_chat_index()
    return int(idx.ntotal) if idx is not None else 0
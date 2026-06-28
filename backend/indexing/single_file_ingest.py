import os
import sys
import time as _time
from typing import Dict, List

from core.chunker import chunk_text
from core.db import get_connection, init_db, rebuild_fts
from core.extractor import extract_text_with_status
from core.model import MODEL
from core.faiss_manager import invalidate_cache, save_index
from core.scanner import is_indexable_document
from indexing.update_faiss import update_faiss


def ingest_single_file(file_path: str, allow_protected: bool = False) -> Dict[str, object]:
    """
    Ingest one file into the canonical files.db + vectors.faiss pipeline.
    Uses persistent dedup based on absolute path + modified time.
    """
    init_db()

    abs_path = os.path.abspath(file_path)
    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f"File not found: {abs_path}")

    if not is_indexable_document(abs_path):
        return {
            "status": "skipped",
            "path": abs_path,
            "filename": os.path.basename(abs_path),
            "new_chunks": 0,
            "affected_chunk_ids": [],
            "reason": "unsupported_file_type",
            "skipped": True,
        }

    modified_time = int(os.path.getmtime(abs_path))
    created_time = int(os.stat(abs_path).st_ctime)
    filename = os.path.basename(abs_path)

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id, modified_time FROM files WHERE path = ?", (abs_path,))
    existing = cur.fetchone()

    affected_chunk_ids: List[int] = []
    if existing:
        file_id, old_mtime = existing
        if int(old_mtime) == modified_time:
            conn.close()
            sys.stderr.write(f"[ingest] Skipped (unchanged): {abs_path}\n")
            sys.stderr.flush()
            return {
                "status": "skipped",
                "file_id": int(file_id),
                "path": abs_path,
                "filename": filename,
                "new_chunks": 0,
                "affected_chunk_ids": [],
                "reason": "unchanged",
                "skipped": True,
            }

    text, reason = extract_text_with_status(abs_path, allow_protected=allow_protected)
    if reason in {"permission_denied", "file_locked", "password_protected", "not_found", "access_error"} and not allow_protected:
        conn.close()
        return {
            "status": "skipped",
            "path": abs_path,
            "filename": filename,
            "new_chunks": 0,
            "affected_chunk_ids": [],
            "reason": reason,
            "skipped": True,
        }

    if existing:
        cur.execute("SELECT id FROM chunks WHERE file_id = ?", (file_id,))
        affected_chunk_ids.extend([row[0] for row in cur.fetchall()])
        cur.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
        cur.execute(
            "UPDATE files SET filename = ?, modified_time = ? WHERE id = ?",
            (filename, modified_time, file_id),
        )
    else:
        cur.execute(
            "INSERT INTO files(path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            (abs_path, filename, modified_time, created_time),
        )
        file_id = cur.lastrowid

    chunks = chunk_text(text) if text and len(text.strip()) >= 50 else []

    name_no_ext = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    meta_chunk = f"{name_no_ext} {filename} {abs_path}"
    chunks.insert(0, meta_chunk)

    new_chunk_ids: List[int] = []
    for idx, chunk in enumerate(chunks):
        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
            (file_id, idx, chunk),
        )
        new_chunk_ids.append(cur.lastrowid)

    conn.commit()
    conn.close()

    affected_chunk_ids.extend(new_chunk_ids)
    rebuild_fts()
    update_faiss(affected_chunk_ids)
    invalidate_cache()

    sys.stderr.write(f"[ingest] Indexed {filename}: {len(new_chunk_ids)} chunks ({'updated' if existing else 'new'})\n")
    sys.stderr.flush()

    return {
        "status": "indexed",
        "file_id": int(file_id),
        "path": abs_path,
        "filename": filename,
        "new_chunks": len(new_chunk_ids),
        "affected_chunk_ids": affected_chunk_ids,
        "reason": "updated" if existing else "new",
        "skipped": False,
    }


def remove_single_file(file_path: str) -> Dict[str, object]:
    """
    Remove one file from the canonical files.db + vectors.faiss pipeline.
    """
    init_db()
    t0 = _time.perf_counter()

    abs_path = os.path.abspath(file_path)
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id, filename FROM files WHERE path = ?", (abs_path,))
    row = cur.fetchone()
    if not row:
        conn.close()
        sys.stderr.write(f"[ingest] Delete skipped (not in index): {abs_path}\n")
        sys.stderr.flush()
        return {
            "status": "skipped",
            "path": abs_path,
            "reason": "not_found",
        }

    file_id, filename = row
    cur.execute("SELECT id FROM chunks WHERE file_id = ?", (file_id,))
    chunk_ids = [r[0] for r in cur.fetchall()]
    cur.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
    cur.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    conn.close()

    if chunk_ids:
        update_faiss(chunk_ids)
    rebuild_fts()
    invalidate_cache()

    elapsed = round(_time.perf_counter() - t0, 2)
    sys.stderr.write(f"[ingest] Deleted {filename} from index: {len(chunk_ids)} chunks removed in {elapsed}s\n")
    sys.stderr.flush()

    return {
        "status": "deleted",
        "file_id": int(file_id),
        "path": abs_path,
        "filename": filename,
        "removed_chunks": len(chunk_ids),
    }


def reset_canonical_index_store() -> Dict[str, object]:
    """
    Clears canonical files/chunks and resets FAISS index to empty.
    """
    init_db()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM chunks")
    cur.execute("DELETE FROM files")
    cur.execute("DELETE FROM sqlite_sequence WHERE name='chunks'")
    cur.execute("DELETE FROM sqlite_sequence WHERE name='files'")
    conn.commit()
    conn.close()

    rebuild_fts()

    import faiss

    dim = MODEL.get_embedding_dimension()
    empty_index = faiss.IndexIDMap(faiss.IndexFlatIP(dim))
    save_index(empty_index)
    invalidate_cache()

    return {"status": "success", "message": "Canonical index store reset."}
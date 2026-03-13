import os
import sys
import time
import concurrent.futures
from core.scanner import fast_scan_device
from core.extractor import extract_text
from core.chunker import chunk_text
from core.db import init_db, get_connection, rebuild_fts


# ── Parallel text extraction ────────────────────────────
_EXTRACT_WORKERS = min(16, (os.cpu_count() or 4) * 2)
_BATCH_SIZE = 500          # files per commit batch


def _extract_one(path):
    """Extract + chunk a single file. Returns (path, chunks) or (path, None)."""
    try:
        text = extract_text(path)
        chunks = chunk_text(text) if len(text.strip()) >= 50 else []

        # Always include filename + path as a searchable chunk so every
        # indexed file can be found by its name even without body text.
        filename = os.path.basename(path)
        name_no_ext = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
        meta_chunk = f"{name_no_ext} {filename} {path}"
        chunks.insert(0, meta_chunk)

        return (path, chunks)
    except Exception:
        return (path, None)


def index_files_incremental(progress_cb=None):
    """
    Scan the entire device fast, extract text in parallel, chunk, and store
    in SQLite.  Returns a list of chunk IDs that were added or modified
    (to be passed to update_faiss).

    progress_cb(phase, detail, pct) is called with live progress updates
    if provided.
    """
    def _progress(phase, detail="", pct=None):
        if progress_cb:
            progress_cb(phase, detail, pct)

    init_db()
    t0 = time.perf_counter()

    _progress("scan", "Scanning drives…")

    files = {}  # path -> mtime
    for path, mtime in fast_scan_device(max_workers=8):
        files[path] = mtime

    total_scanned = len(files)
    scan_secs = time.perf_counter() - t0
    _progress("scan", f"Found {total_scanned} files ({scan_secs:.1f}s)", pct=100)
    print(f"Scanned {total_scanned} supported files in {scan_secs:.1f}s.", flush=True)

    conn = get_connection()
    cur = conn.cursor()

    affected_chunk_ids = []

    # Load the entire DB state into memory for instant O(1) lookups
    cur.execute("SELECT path, modified_time, id FROM files")
    db_states = {row[0]: (row[2], row[1]) for row in cur.fetchall()}

    # ── Determine which files actually need work ────────
    files_to_process = []      # (path, mtime, file_id_or_None)

    for path, modified_time in files.items():
        if path in db_states:
            file_id, old_mtime = db_states[path]
            if old_mtime == modified_time:
                continue
            # modified → mark old chunks as affected, delete them
            cur.execute("SELECT id FROM chunks WHERE file_id=?", (file_id,))
            affected_chunk_ids.extend(r[0] for r in cur.fetchall())
            cur.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
            cur.execute("UPDATE files SET modified_time=? WHERE id=?",
                        (modified_time, file_id))
            files_to_process.append((path, modified_time, file_id))
        else:
            # new file — insert the file row now so we have its ID
            filename = os.path.basename(path)
            cur.execute(
                "INSERT INTO files(path, filename, modified_time) VALUES (?, ?, ?)",
                (path, filename, modified_time),
            )
            files_to_process.append((path, modified_time, cur.lastrowid))

    conn.commit()  # commit file-row inserts/updates before extraction

    t_extract = time.perf_counter()
    _progress("extract", f"Extracting text from {len(files_to_process)} files…", pct=0)
    print(f"Files to extract: {len(files_to_process)}", flush=True)

    # ── Extract text in parallel using a thread pool ────
    path_to_fid = {p: fid for p, _, fid in files_to_process}
    paths = [p for p, _, _ in files_to_process]
    total_to_extract = len(paths)

    processed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=_EXTRACT_WORKERS) as pool:
        batch_data = []  # accumulate (file_id, idx, chunk_text)

        for path, chunks in pool.map(_extract_one, paths):
            if chunks is None:
                processed += 1
                continue

            fid = path_to_fid[path]
            for idx, chunk in enumerate(chunks):
                batch_data.append((fid, idx, chunk))

            processed += 1

            # Flush to DB in batches to keep memory low & allow progress
            if len(batch_data) >= _BATCH_SIZE * 5:
                cur.executemany(
                    "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                    batch_data,
                )
                conn.commit()
                batch_data.clear()

            if processed % 200 == 0 or processed == total_to_extract:
                pct = int(processed / total_to_extract * 100) if total_to_extract else 100
                _progress("extract", f"Extracted {processed}/{total_to_extract} files", pct=pct)
                print(f"  … extracted {processed}/{total_to_extract} files", flush=True)

        # Flush remaining
        if batch_data:
            cur.executemany(
                "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                batch_data,
            )
            conn.commit()

    # Collect IDs of newly inserted chunks for FAISS
    fids = list(path_to_fid.values())
    for i in range(0, len(fids), 500):
        batch = fids[i:i + 500]
        placeholders = ",".join("?" * len(batch))
        cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({placeholders})", batch)
        affected_chunk_ids.extend(r[0] for r in cur.fetchall())

    # ── Handle deleted files ────────────────────────────
    deleted_fids = []
    for path, (file_id, _) in db_states.items():
        if path not in files:
            deleted_fids.append(file_id)

    if deleted_fids:
        for i in range(0, len(deleted_fids), 500):
            batch = deleted_fids[i:i + 500]
            placeholders = ",".join("?" * len(batch))
            cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({placeholders})", batch)
            affected_chunk_ids.extend(r[0] for r in cur.fetchall())
            cur.execute(f"DELETE FROM chunks WHERE file_id IN ({placeholders})", batch)
            cur.execute(f"DELETE FROM files WHERE id IN ({placeholders})", batch)

    conn.commit()
    conn.close()

    extract_secs = time.perf_counter() - t_extract
    print(f"Extraction + chunking took {extract_secs:.1f}s.", flush=True)

    # Rebuild FTS5 keyword index for hybrid search
    t_fts = time.perf_counter()
    _progress("fts", "Building keyword index…")
    rebuild_fts()
    fts_secs = time.perf_counter() - t_fts
    print(f"FTS5 rebuild took {fts_secs:.1f}s.", flush=True)

    total_secs = time.perf_counter() - t0
    affected_chunk_ids = list(set(affected_chunk_ids))
    print(f"Indexing completed — {len(affected_chunk_ids)} chunks affected "
          f"(scan {scan_secs:.1f}s + extract {extract_secs:.1f}s + fts {fts_secs:.1f}s "
          f"= {total_secs:.1f}s total).", flush=True)
    _progress("extract", f"{len(affected_chunk_ids)} chunks ready ({total_secs:.1f}s)", pct=100)
    return affected_chunk_ids

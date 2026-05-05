import os
import sys
import time
import concurrent.futures
from functools import partial
from core.scanner import fast_scan_device
from core.extractor import extract_text_with_status
from core.chunker import chunk_text
from core.db import init_db, get_connection, rebuild_fts


# ── Parallel text extraction ────────────────────────────
_EXTRACT_WORKERS = min(8, (os.cpu_count() or 4))
_BATCH_SIZE = 500          # files per commit batch
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_SKIP_REASONS = {"permission_denied", "file_locked", "password_protected", "not_found", "access_error"}


def _init_worker():
    """Initializer for ProcessPoolExecutor children — ensures imports work."""
    if _BACKEND_DIR not in sys.path:
        sys.path.insert(0, _BACKEND_DIR)


def _extract_one(path, allow_protected=False):
    """Extract + chunk a single file. Returns (path, chunks, reason) or (path, None, reason)."""
    text, reason = extract_text_with_status(path, allow_protected=allow_protected)
    if reason in _SKIP_REASONS and not allow_protected:
        return (path, None, reason)

    chunks = chunk_text(text) if len(text.strip()) >= 50 else []

    # Always include filename + path as a searchable chunk so every
    # indexed file can be found by its name even without body text.
    filename = os.path.basename(path)
    name_no_ext = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    meta_chunk = f"{name_no_ext} {filename} {path}"
    chunks.insert(0, meta_chunk)

    return (path, chunks, reason)


def index_files_incremental(root_folder=None, progress_cb=None, allow_protected=False):
    """
    Scan the device (or a specified root), extract text in parallel, chunk, and store
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

    roots = root_folder
    if isinstance(root_folder, str) and not root_folder.strip():
        roots = None

    roots_label = "default-roots"
    if roots is None:
        roots_label = "default-roots"
    elif isinstance(roots, (list, tuple)):
        roots_label = ", ".join(roots) if roots else "(none)"
    else:
        roots_label = str(roots)

    _progress("scan", f"Scanning ({roots_label})…")
    print(f"Index scan roots: {roots_label}", flush=True)

    files = {}  # path -> (mtime, ctime)

    for path, mtime, ctime in fast_scan_device(max_workers=8, roots=roots):
        files[path] = (mtime, ctime)

    total_scanned = len(files)
    scan_secs = time.perf_counter() - t0
    _progress("scan", f"Found {total_scanned} files ({scan_secs:.1f}s)", pct=100)
    print(f"Scanned {total_scanned} supported files in {scan_secs:.1f}s.", flush=True)

    conn = get_connection()
    cur = conn.cursor()

    affected_chunk_ids = []

    # Load the entire DB state into memory for instant O(1) lookups
    cur.execute("SELECT path, modified_time, id FROM files")
    db_states = {row[0]: (row[2], row[1]) for row in cur.fetchall()}  # path -> (file_id, mtime)

    # ── Determine which files actually need work ────────
    files_to_process = []      # (path, mtime, file_id_or_None)
    new_files_data = []        # (path, filename, mtime, ctime) for bulk insert
    modified_fids = []         # file_ids that changed
    modified_updates = []      # (mtime, file_id) for bulk update
    unchanged_files = 0

    _progress("diff", f"Comparing {len(files)} files against database…", pct=0)

    for path, (modified_time, created_time) in files.items():
        if path in db_states:
            file_id, old_mtime = db_states[path]
            if old_mtime == modified_time:
                unchanged_files += 1
                continue
            modified_fids.append(file_id)
            modified_updates.append((modified_time, file_id))
            files_to_process.append((path, modified_time, file_id))
        else:
            filename = os.path.basename(path)
            new_files_data.append((path, filename, modified_time, created_time))

    # Bulk-delete old chunks for modified files
    if modified_fids:
        for i in range(0, len(modified_fids), 500):
            batch = modified_fids[i:i + 500]
            ph = ",".join("?" * len(batch))
            cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({ph})", batch)
            affected_chunk_ids.extend(r[0] for r in cur.fetchall())
            cur.execute(f"DELETE FROM chunks WHERE file_id IN ({ph})", batch)
        cur.executemany("UPDATE files SET modified_time=? WHERE id=?", modified_updates)

    # Bulk-insert new file rows
    if new_files_data:
        cur.executemany(
            "INSERT INTO files(path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            new_files_data,
        )
        # Retrieve assigned IDs for new files
        new_paths = [d[0] for d in new_files_data]
        for i in range(0, len(new_paths), 500):
            batch = new_paths[i:i + 500]
            ph = ",".join("?" * len(batch))
            cur.execute(f"SELECT path, id FROM files WHERE path IN ({ph})", batch)
            path_to_id = {r[0]: r[1] for r in cur.fetchall()}
            for p, _, mt, _ in new_files_data[i:i + 500]:
                files_to_process.append((p, mt, path_to_id[p]))

    new_files = len(new_files_data)
    modified_files = len(modified_fids)
    conn.commit()  # commit file-row inserts/updates before extraction

    t_extract = time.perf_counter()
    _progress("extract", f"Extracting text from {len(files_to_process)} files…", pct=0)
    print(f"Files to extract: {len(files_to_process)}", flush=True)

    # ── Extract text in parallel (ThreadPool) ───────────────
    # ThreadPool is safe on low-RAM systems — no extra process overhead
    path_to_fid = {p: fid for p, _, fid in files_to_process}
    paths = [p for p, _, _ in files_to_process]
    total_to_extract = len(paths)

    processed = 0
    sys.stderr.write(f"[engine] Extracting with ThreadPool ({_EXTRACT_WORKERS} workers)\n")
    sys.stderr.flush()

    skipped = []
    skipped_by_reason = {}
    extractor = partial(_extract_one, allow_protected=allow_protected)

    with concurrent.futures.ThreadPoolExecutor(max_workers=_EXTRACT_WORKERS) as pool:
        batch_data = []  # accumulate (file_id, idx, chunk_text)

        for path, chunks, reason in pool.map(extractor, paths):
            if chunks is None:
                skipped.append((path, reason))
                if reason:
                    skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + 1
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

    if skipped:
        skipped_fids = [path_to_fid.get(path) for path, _ in skipped]
        skipped_fids = [fid for fid in skipped_fids if fid is not None]
        if skipped_fids:
            for i in range(0, len(skipped_fids), 500):
                batch = skipped_fids[i:i + 500]
                placeholders = ",".join("?" * len(batch))
                cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({placeholders})", batch)
                affected_chunk_ids.extend(r[0] for r in cur.fetchall())
                cur.execute(f"DELETE FROM chunks WHERE file_id IN ({placeholders})", batch)
                cur.execute(f"DELETE FROM files WHERE id IN ({placeholders})", batch)

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

    deleted_files = len(deleted_fids)
    print(
        f"Index delta: {new_files} new, {modified_files} modified, "
        f"{deleted_files} deleted, {unchanged_files} unchanged",
        flush=True,
    )

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
    skipped_total = len(skipped)
    if skipped_total:
        _progress("extract", f"{len(affected_chunk_ids)} chunks ready ({total_secs:.1f}s) — skipped {skipped_total} protected files", pct=100)
    else:
        _progress("extract", f"{len(affected_chunk_ids)} chunks ready ({total_secs:.1f}s)", pct=100)

    return {
        "affected_chunk_ids": affected_chunk_ids,
        "skipped_total": skipped_total,
        "skipped_by_reason": skipped_by_reason,
    }
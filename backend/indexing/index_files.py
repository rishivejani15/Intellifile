import os
import sys
import time
import concurrent.futures
from functools import partial
from core.scanner import fast_scan_device
from core.extractor import extract_text_with_status
from core.chunker import chunk_text
from core.db import (
    folder_metadata,
    get_connection,
    init_db,
    normalized_search_key,
    rebuild_fts,
    upsert_folder_catalog,
)


# ── Parallel text extraction ────────────────────────────
# Dynamically scale extraction workers, guaranteeing at least 50% CPU headroom
def get_optimal_extraction_workers(cpu_count=None):
    if cpu_count is None:
        cpu_count = os.cpu_count() or 4
    if cpu_count <= 2:
        return 1
    elif cpu_count <= 4:
        return 2
    elif cpu_count <= 8:
        return max(2, cpu_count // 2)
    else:
        # Cap multi-process extraction at 8 workers to prevent disk I/O bottleneck
        return min(8, max(4, cpu_count // 2))

_cpu_count = os.cpu_count() or 4
_EXTRACT_WORKERS = get_optimal_extraction_workers(_cpu_count)
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

    filename = os.path.basename(path)
    name_no_ext = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    chunks = chunk_text(text, doc_context=name_no_ext) if len(text.strip()) >= 50 else []

    # Zero chunks for textless files (images, icons, etc.) and no redundant meta_chunk
    return (path, chunks, reason)


def _is_under_roots(file_path, roots):
    if not roots:
        return True
    if isinstance(roots, (str, os.PathLike)):
        roots = [roots]
    norm_path = os.path.normcase(os.path.abspath(file_path)).rstrip("\\/")
    for r in roots:
        norm_r = os.path.normcase(os.path.abspath(r)).rstrip("\\/")
        if norm_path == norm_r or norm_path.startswith(norm_r + os.sep):
            return True
    return False


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

    # Self-healing: identify existing files in DB that have not completed extraction (chunk_count IS NULL)
    cur.execute("SELECT files.path FROM files WHERE chunk_count IS NULL")
    files_with_no_chunks = {row[0] for row in cur.fetchall()}

    # ── Determine which files actually need work ────────
    files_to_process = []      # (path, mtime, file_id_or_None)
    new_files_data = []        # (path, filename, filename_key, mtime, ctime, folder_path, folder_name)
    modified_fids = []         # file_ids that changed
    modified_updates = []      # (mtime, file_id) for bulk update
    unchanged_files = 0

    _progress("diff", f"Comparing {len(files)} files against database…", pct=0)

    for path, (modified_time, created_time) in files.items():
        if path in db_states:
            file_id, old_mtime = db_states[path]
            if old_mtime == modified_time and path not in files_with_no_chunks:
                unchanged_files += 1
                continue
            modified_fids.append(file_id)
            modified_updates.append((modified_time, file_id))
            files_to_process.append((path, modified_time, file_id))
        else:
            filename = os.path.basename(path)
            folder_path, folder_name = folder_metadata(path)
            new_files_data.append(
                (
                    path,
                    filename,
                    normalized_search_key(filename),
                    modified_time,
                    created_time,
                    folder_path,
                    folder_name,
                )
            )

    # Bulk-delete old chunks for modified files
    if modified_fids:
        for i in range(0, len(modified_fids), 500):
            batch = modified_fids[i:i + 500]
            ph = ",".join("?" * len(batch))
            cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({ph})", batch)
            affected_chunk_ids.extend(r[0] for r in cur.fetchall())
            cur.execute(f"DELETE FROM chunks WHERE file_id IN ({ph})", batch)
        cur.executemany("UPDATE files SET modified_time=? WHERE id=?", modified_updates)

    # Bulk-insert new file rows in batches of 100, committing after each batch
    if new_files_data:
        for i in range(0, len(new_files_data), 100):
            batch_data = new_files_data[i:i + 100]
            cur.executemany(
                """INSERT INTO files(
                       path, filename, filename_key, modified_time, created_time, folder_path, folder_name
                   ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                batch_data,
            )
            # Retrieve assigned IDs for new files in this batch
            batch_paths = [d[0] for d in batch_data]
            ph = ",".join("?" * len(batch_paths))
            cur.execute(f"SELECT path, id FROM files WHERE path IN ({ph})", batch_paths)
            path_to_id = {r[0]: r[1] for r in cur.fetchall()}
            for p, _, _, mt, _, _, _ in batch_data:
                if p in path_to_id:
                    files_to_process.append((p, mt, path_to_id[p]))

            # Keep the separate ancestor catalog current for folder queries.  A
            # file under ``Computer Networks\\Study Material`` registers both
            # folders without changing its stored content or embedding.
            upsert_folder_catalog(cur, batch_paths)
            conn.commit()

    new_files = len(new_files_data)
    modified_files = len(modified_fids)
    conn.commit()  # commit file-row inserts/updates before extraction

    t_extract = time.perf_counter()
    if unchanged_files > 0:
        start_pct = int(unchanged_files / total_scanned * 100) if total_scanned else 0
        _progress("extract", f"Resuming: {unchanged_files} already indexed, extracting remaining {len(files_to_process)} files…", pct=start_pct)
        print(f"Resuming indexing: {unchanged_files} files already extracted, {len(files_to_process)} remaining to extract.", flush=True)
    else:
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

    chunk_count_updates = []
    skipped_fids_to_purge = []
    last_flush_time = time.time()
    last_progress_emit = 0.0

    with concurrent.futures.ThreadPoolExecutor(max_workers=_EXTRACT_WORKERS) as pool:
        batch_data = []  # accumulate (file_id, idx, chunk_text)

        for path, chunks, reason in pool.map(extractor, paths):
            fid = path_to_fid[path]
            if not chunks:
                if reason in _SKIP_REASONS:
                    skipped.append((path, reason))
                    if fid is not None:
                        skipped_fids_to_purge.append(fid)
                    if reason:
                        skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + 1
                else:
                    # Textless file (e.g. image with no OCR text) — mark completed with 0 chunks
                    chunk_count_updates.append((0, fid))
                processed += 1
            else:
                chunk_count_updates.append((len(chunks), fid))
                for idx, chunk in enumerate(chunks):
                    batch_data.append((fid, idx, chunk))
                processed += 1

            now = time.time()
            # Flush to DB frequently (every 5 files, 25 chunks, or 1.5s) to guarantee durability against app exit
            if (
                len(chunk_count_updates) >= 5
                or len(batch_data) >= 25
                or skipped_fids_to_purge
                or ((chunk_count_updates or batch_data) and now - last_flush_time >= 1.5)
            ):
                if batch_data:
                    cur.executemany(
                        "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                        batch_data,
                    )
                    batch_data.clear()
                if chunk_count_updates:
                    cur.executemany(
                        "UPDATE files SET chunk_count = ? WHERE id = ?",
                        chunk_count_updates,
                    )
                    chunk_count_updates.clear()
                if skipped_fids_to_purge:
                    for s_start in range(0, len(skipped_fids_to_purge), 500):
                        s_batch = skipped_fids_to_purge[s_start:s_start + 500]
                        s_ph = ",".join("?" * len(s_batch))
                        cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({s_ph})", s_batch)
                        affected_chunk_ids.extend(r[0] for r in cur.fetchall())
                        cur.execute(f"DELETE FROM chunks WHERE file_id IN ({s_ph})", s_batch)
                        cur.execute(f"DELETE FROM files WHERE id IN ({s_ph})", s_batch)
                    skipped_fids_to_purge.clear()
                conn.commit()
                last_flush_time = now

            if now - last_progress_emit >= 0.2 or processed == total_to_extract:
                time.sleep(0.001)  # Yield CPU slice to OS and UI scheduler
                overall_done = unchanged_files + processed
                pct = int(overall_done / total_scanned * 100) if total_scanned else 100
                if unchanged_files > 0:
                    detail = f"Extracted {overall_done}/{total_scanned} files ({processed}/{total_to_extract} remaining)"
                else:
                    detail = f"Extracted {processed}/{total_to_extract} files"
                _progress("extract", detail, pct=pct)
                print(f"  … {detail}", flush=True)
                last_progress_emit = now

        # Flush remaining chunks, chunk_count updates, and skipped files
        if batch_data or chunk_count_updates or skipped_fids_to_purge:
            if batch_data:
                cur.executemany(
                    "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                    batch_data,
                )
                batch_data.clear()
            if chunk_count_updates:
                cur.executemany(
                    "UPDATE files SET chunk_count = ? WHERE id = ?",
                    chunk_count_updates,
                )
                chunk_count_updates.clear()
            if skipped_fids_to_purge:
                for s_start in range(0, len(skipped_fids_to_purge), 500):
                    s_batch = skipped_fids_to_purge[s_start:s_start + 500]
                    s_ph = ",".join("?" * len(s_batch))
                    cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({s_ph})", s_batch)
                    affected_chunk_ids.extend(r[0] for r in cur.fetchall())
                    cur.execute(f"DELETE FROM chunks WHERE file_id IN ({s_ph})", s_batch)
                    cur.execute(f"DELETE FROM files WHERE id IN ({s_ph})", s_batch)
                skipped_fids_to_purge.clear()
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
            conn.commit()

    # Collect IDs of newly inserted chunks for FAISS
    fids = list(path_to_fid.values())
    for i in range(0, len(fids), 500):
        batch = fids[i:i + 500]
        placeholders = ",".join("?" * len(batch))
        cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({placeholders})", batch)
        affected_chunk_ids.extend(r[0] for r in cur.fetchall())

    # Also collect any un-embedded chunks (e.g. from an interrupted previous run)
    cur.execute("SELECT id FROM chunks WHERE embedded = 0")
    affected_chunk_ids.extend(r[0] for r in cur.fetchall())

    # ── Handle deleted files ────────────────────────────
    deleted_fids = []
    for path, (file_id, _) in db_states.items():
        # When roots is specified, only consider files that fall under the scanned roots
        if roots is not None and not _is_under_roots(path, roots):
            continue
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
        skip_details = []
        protected_count = sum(skipped_by_reason.get(k, 0) for k in ("permission_denied", "file_locked", "password_protected", "access_error"))
        no_text_count = skipped_by_reason.get("no_text_in_image", 0)
        if protected_count:
            skip_details.append(f"{protected_count} protected")
        if no_text_count:
            skip_details.append(f"{no_text_count} images without text")
        other_count = skipped_total - protected_count - no_text_count
        if other_count > 0:
            skip_details.append(f"{other_count} other")
        skip_str = "skipped: " + ", ".join(skip_details)
        _progress("extract", f"{len(affected_chunk_ids)} chunks ready ({total_secs:.1f}s) — {skip_str}", pct=100)    
    else:
        _progress("extract", f"{len(affected_chunk_ids)} chunks ready ({total_secs:.1f}s)", pct=100)

    return {
        "affected_chunk_ids": affected_chunk_ids,
        "skipped_total": skipped_total,
        "skipped_by_reason": skipped_by_reason,
    }

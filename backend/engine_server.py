import json
import sys
import os
import threading
import queue
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

if "--offline-setup" in sys.argv:
    from setup_offline import main as _offline_setup_main

    sys.argv = [arg for arg in sys.argv if arg != "--offline-setup"]
    _offline_setup_main()
    sys.exit(0)

# Ensure backend/ is on sys.path
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

sys.stderr.write("[engine] Starting resilient process...\n")
sys.stderr.flush()

_DATA_DIR = os.getenv("IF_DATA_DIR", os.path.join(_BACKEND_DIR, "data"))
os.makedirs(_DATA_DIR, exist_ok=True)
try:
    from core.db import init_db
    init_db()
    sys.stderr.write("[engine] SQLite database ready\n")
except Exception as e:
    sys.stderr.write(f"[engine] DB init warning (non-fatal): {e}\n")
sys.stderr.flush()

try:
    from main_orchestrator import set_emitter, start_autosort, stop_autosort, settings_get, settings_update, autosort_recent, autosort_undo
except Exception:
    set_emitter = None
    start_autosort = None
    stop_autosort = None
    settings_get = None
    settings_update = None
    autosort_recent = None
    autosort_undo = None

# Global engine instances (lazy loaded)
_version_engine = None
_preview_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="document-preview")
_preview_slots = threading.BoundedSemaphore(4)
_stdout_lock = Lock()


def _emit_json(payload):
    with _stdout_lock:
        print(json.dumps(payload), flush=True)


def _finish_document_preview(req_id, future):
    try:
        result = future.result()
        _emit_json({"_id": req_id, **result})
    except Exception as exc:
        _emit_json({"_id": req_id, "error": str(exc)})
    finally:
        _preview_slots.release()

def get_version_engine():
    global _version_engine
    if _version_engine is None:
        try:
            from core.versioning.version_engine import VersionEngine
            _version_engine = VersionEngine()
        except Exception as e:
            sys.stderr.write(f"[engine] VersionEngine Lazy Init Error: {e}\n")
            class MockVE:
                def process_and_save(self, *args): return {"error": f"Init failed: {e}"}
            _version_engine = MockVE()
    return _version_engine

# Background indexing queue and lock
_index_queue = queue.Queue(maxsize=10)
_index_lock = Lock()
_current_index_job = None

# Background delete queue — separate from indexing so deletes don't queue-block
# behind long-running index jobs, and vice-versa.
_delete_queue = queue.Queue(maxsize=50)

def _background_deleter():
    """Process file deletion jobs in background to avoid blocking the main stdin loop.
    
    This is the critical fix for the search-bar freeze bug: remove_single_file()
    calls update_faiss() which rebuilds the FAISS index synchronously. When this
    ran on the main thread, it blocked ALL other requests (including search) for
    the duration of the rebuild (1-3+ minutes on large indices).
    """
    while True:
        try:
            job = _delete_queue.get()
            if job is None:  # Sentinel for shutdown
                break
            
            req_id = job['req_id']
            file_path = job['file_path']
            
            try:
                import time as _time
                from indexing.single_file_ingest import remove_single_file
                
                t0 = _time.perf_counter()
                sys.stderr.write(f"[engine-bg-delete] Removing from index: {file_path}\n")
                sys.stderr.flush()
                
                result = remove_single_file(file_path)
                
                elapsed = round(_time.perf_counter() - t0, 2)
                status = result.get('status', 'unknown')
                removed = result.get('removed_chunks', 0)
                sys.stderr.write(f"[engine-bg-delete] Done in {elapsed}s — status={status}, chunks_removed={removed}, path={file_path}\n")
                sys.stderr.flush()
                
                _emit_json({"_id": req_id, "success": True, "file_path": file_path, "data": result})
            except Exception as e:
                sys.stderr.write(f"[engine-bg-delete] Failed for {file_path}: {e}\n")
                sys.stderr.flush()
                _emit_json({"_id": req_id, "error": f"Delete failed: {e}"})
        except Exception as e:
            sys.stderr.write(f"[engine-bg-delete] Background deleter error: {e}\n")
            sys.stderr.flush()
        finally:
            _delete_queue.task_done()

# Start background deleter thread
_deleter_thread = threading.Thread(target=_background_deleter, daemon=True)
_deleter_thread.start()

def _background_indexer():
    """Process indexing jobs in background to avoid blocking other requests"""
    global _current_index_job
    while True:
        try:
            job = _index_queue.get()
            if job is None:  # Sentinel for shutdown
                break
            
            _current_index_job = job
            req_id = job['req_id']
            folder = job['folder']
            allow_protected = job['allow_protected']
            
            try:
                from indexing.index_files import index_files_incremental
                from indexing.update_faiss import update_faiss
                from core.faiss_manager import load_index, invalidate_cache
                import time as _time
                
                root_label = folder or "default"
                sys.stderr.write(f"[engine-bg] Indexing started (root={root_label})\n")
                sys.stderr.flush()
                
                _t_total = _time.perf_counter()
                
                def emit_progress(phase, detail="", pct=None):
                    payload = {
                        "_id": req_id,
                        "type": "progress",
                        "phase": phase,
                        "detail": detail,
                    }
                    if pct is not None:
                        payload["pct"] = pct
                    print(json.dumps(payload), flush=True)
                
                result = index_files_incremental(folder, progress_cb=emit_progress, allow_protected=allow_protected)
                affected = result["affected_chunk_ids"] if isinstance(result, dict) else result
                skipped_total = int(result.get("skipped_total", 0)) if isinstance(result, dict) else 0
                skipped_by_reason = result.get("skipped_by_reason", {}) if isinstance(result, dict) else {}
                update_faiss(affected, progress_cb=emit_progress)
                invalidate_cache()
                load_index(force_reload=True)
                total_secs = round(_time.perf_counter() - _t_total, 1)
                sys.stderr.write(f"[engine-bg] Indexing completed in {total_secs}s (chunks={len(affected)}, skipped={skipped_total})\n")
                sys.stderr.flush()
                
                detail = f"Indexing complete — {len(affected)} chunks in {total_secs}s"
                if skipped_total:
                    detail += f" (skipped {skipped_total} protected files)"
                emit_progress("done", detail, pct=100)
                print(json.dumps({
                    "_id": req_id,
                    "status": "indexed",
                    "folder": folder or "",
                    "total_secs": total_secs,
                    "chunks": len(affected),
                    "skipped_total": skipped_total,
                    "skipped_by_reason": skipped_by_reason,
                }), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Background indexing failed: {e}"}), flush=True)
            finally:
                _current_index_job = None
        except Exception as e:
            sys.stderr.write(f"[engine-bg] Background indexer error: {e}\n")
            sys.stderr.flush()
        finally:
            _index_queue.task_done()

# Start background indexer thread
_indexer_thread = threading.Thread(target=_background_indexer, daemon=True)
_indexer_thread.start()

print("IntelliFile Python Engine Ready", flush=True)

try:
    if callable(set_emitter):
        set_emitter(_emit_json)
    if callable(start_autosort):
        start_autosort()
except Exception as e:
    sys.stderr.write(f"[engine] Autosort bootstrap warning: {e}\n")
    sys.stderr.flush()

def _warm_faiss_index():
    try:
        from core.faiss_manager import load_index
        idx = load_index()
        if idx is None:
            sys.stderr.write("[engine] FAISS index not found; warmup skipped\n")
        else:
            sys.stderr.write("[engine] FAISS index warmed\n")
    except Exception as e:
        sys.stderr.write(f"[engine] FAISS warmup skipped: {e}\n")
    sys.stderr.flush()

threading.Thread(target=_warm_faiss_index, daemon=True).start()


while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break

        request = json.loads(line.strip())
        action = request.get("action")
        req_id = request.get("_id")

        if action == "search":
            try:
                # Ensure embedding model is available before running semantic search
                try:
                    from core.model import is_model_loaded, MODEL_LOAD_ERROR
                    if not is_model_loaded():
                        err = MODEL_LOAD_ERROR or "Embedding model not available"
                        print(json.dumps({"_id": req_id, "error": f"Embeddings unavailable: {err}"}), flush=True)
                        continue
                except Exception:
                    # If model module isn't reachable, fail the request
                    print(json.dumps({"_id": req_id, "error": "Embedding model check failed"}), flush=True)
                    continue

                from core.search import semantic_search
                query = request.get("query", "").strip()
                date_from = request.get("date_from")  # Unix timestamp or None
                date_to = request.get("date_to")      # Unix timestamp or None
                root_folder = request.get("root_folder")
                results = semantic_search(query, date_from=date_from, date_to=date_to, root_folder=root_folder)
                response = {
                    "_id": req_id,
                     "results": [
                        {
                            "path": r["path"],
                            "score": round(float(r["score"]), 3),
                            "created_time": r.get("created_time"),
                        }
                        for r in results
                    ]
                }
                print(json.dumps(response), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Search failed: {e}"}), flush=True)

        elif action == "index":
            try:
                folder = request.get("folder")
                allow_protected = bool(request.get("allow_protected"))
                # Prevent long-running index when embedding model unavailable
                try:
                    from core.model import is_model_loaded, MODEL_LOAD_ERROR
                    if not is_model_loaded():
                        err = MODEL_LOAD_ERROR or "Embedding model not available"
                        print(json.dumps({"_id": req_id, "error": f"Embeddings unavailable: {err}"}), flush=True)
                        continue
                except Exception:
                    print(json.dumps({"_id": req_id, "error": "Embedding model check failed"}), flush=True)
                    continue

                # Submit indexing to background thread to avoid blocking other operations
                try:
                    _index_queue.put_nowait({
                        'req_id': req_id,
                        'folder': folder,
                        'allow_protected': allow_protected
                    })
                    # Immediately acknowledge so caller doesn't block
                    print(json.dumps({"_id": req_id, "type": "progress", "phase": "queued", "detail": "Indexing job queued"}), flush=True)
                except queue.Full:
                    print(json.dumps({"_id": req_id, "error": "Indexing queue full - another indexing job is in progress"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Indexing submission failed: {e}"}), flush=True)

        elif action == "index_file":
            try:
                import time as _time
                from indexing.single_file_ingest import ingest_single_file
                from core.scanner import is_indexable_document
                file_path = request.get("file_path")
                allow_protected = bool(request.get("allow_protected"))
                # Check model availability for embedding of single file
                try:
                    from core.model import is_model_loaded, MODEL_LOAD_ERROR
                    if not is_model_loaded():
                        err = MODEL_LOAD_ERROR or "Embedding model not available"
                        sys.stderr.write(f"[engine] index_file skipped (model unavailable): {file_path}\n")
                        sys.stderr.flush()
                        print(json.dumps({"_id": req_id, "error": f"Embeddings unavailable: {err}"}), flush=True)
                        continue
                except Exception:
                    print(json.dumps({"_id": req_id, "error": "Embedding model check failed"}), flush=True)
                    continue

                if file_path and os.path.exists(file_path):
                    if not is_indexable_document(file_path):
                        sys.stderr.write(f"[engine] index_file skipped (unsupported type): {file_path}\n")
                        sys.stderr.flush()
                        print(json.dumps({"_id": req_id, "status": "skipped", "reason": "unsupported_file_type", "file_path": file_path}), flush=True)
                        continue
                    t0 = _time.perf_counter()
                    sys.stderr.write(f"[engine] index_file started: {file_path}\n")
                    sys.stderr.flush()
                    result = ingest_single_file(file_path, allow_protected=allow_protected)
                    elapsed = round(_time.perf_counter() - t0, 2)
                    status = result.get('status', 'unknown')
                    chunks = result.get('new_chunks', 0)
                    reason_str = result.get('reason', '')
                    sys.stderr.write(f"[engine] index_file done in {elapsed}s — status={status}, chunks={chunks}, reason={reason_str}, path={file_path}\n")
                    sys.stderr.flush()
                    print(json.dumps({"_id": req_id, "status": "indexed", "file_path": file_path, "data": result}), flush=True)
                else:
                    sys.stderr.write(f"[engine] index_file skipped (not found): {file_path}\n")
                    sys.stderr.flush()
                    print(json.dumps({"_id": req_id, "status": "skipped", "reason": "file_not_found", "file_path": file_path}), flush=True)
            except Exception as e:
                sys.stderr.write(f"[engine] index_file failed: {file_path} — {e}\n")
                sys.stderr.flush()
                print(json.dumps({"_id": req_id, "error": f"Single file indexing failed: {e}"}), flush=True)

        elif action == "model_status":
            try:
                from core.model import is_model_loaded, MODEL_LOAD_ERROR
                loaded = is_model_loaded()
                print(json.dumps({"_id": req_id, "loaded": loaded, "error": MODEL_LOAD_ERROR}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Model status check failed: {e}"}), flush=True)

        elif action == "document_preview":
            from core.document_preview import build_document_preview
            if not _preview_slots.acquire(blocking=False):
                _emit_json({"_id": req_id, "error": "Document preview service is busy. Please try again."})
            else:
                try:
                    preview_future = _preview_executor.submit(build_document_preview, request.get("file_path", ""))
                    preview_future.add_done_callback(lambda future, request_id=req_id: _finish_document_preview(request_id, future))
                except Exception:
                    _preview_slots.release()
                    raise

        elif action == "delete_file":
            try:
                file_path = request.get("file_path")
                if not file_path:
                    print(json.dumps({"_id": req_id, "error": "Missing file_path"}), flush=True)
                else:
                    # Dispatch to background thread so FAISS rebuild doesn't block
                    # the main stdin loop (this was the root cause of the search
                    # bar freeze bug — see implementation_plan.md).
                    try:
                        _delete_queue.put_nowait({
                            'req_id': req_id,
                            'file_path': file_path,
                        })
                        sys.stderr.write(f"[engine] delete_file queued for background processing: {file_path}\n")
                        sys.stderr.flush()
                        # Immediately acknowledge so the main loop continues
                        # processing other requests (especially search).
                        print(json.dumps({"_id": req_id, "success": True, "queued": True, "file_path": file_path}), flush=True)
                    except Exception:
                        # Queue full — fall back but warn
                        sys.stderr.write(f"[engine] delete_file queue full, dropping: {file_path}\n")
                        sys.stderr.flush()
                        print(json.dumps({"_id": req_id, "error": "Delete queue full"}), flush=True)
            except Exception as e:
                sys.stderr.write(f"[engine] delete_file dispatch error: {e}\n")
                sys.stderr.flush()
                print(json.dumps({"_id": req_id, "error": f"Delete failed: {e}"}), flush=True)

        elif action == "settings_get":
            try:
                if callable(settings_get):
                    key = request.get("key")
                    result = settings_get(key)
                    print(json.dumps({"_id": req_id, **result}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Settings service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Settings read failed: {e}"}), flush=True)

        elif action == "settings_update":
            try:
                if callable(settings_update):
                    key = request.get("key")
                    value = request.get("value")
                    result = settings_update(key, value)
                    print(json.dumps({"_id": req_id, **result}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Settings service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Settings update failed: {e}"}), flush=True)

        elif action == "watcher_start":
            try:
                if callable(start_autosort):
                    print(json.dumps({"_id": req_id, **start_autosort()}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Autosort service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Watcher start failed: {e}"}), flush=True)

        elif action == "watcher_stop":
            try:
                if callable(stop_autosort):
                    print(json.dumps({"_id": req_id, **stop_autosort()}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Autosort service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Watcher stop failed: {e}"}), flush=True)

        elif action == "autosort_recent":
            try:
                if callable(autosort_recent):
                    limit = request.get("limit", 20)
                    result = autosort_recent(limit=limit)
                    print(json.dumps({"_id": req_id, **result}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Autosort service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Recent autosort lookup failed: {e}"}), flush=True)

        elif action == "autosort_undo":
            try:
                if callable(autosort_undo):
                    log_id = request.get("log_id")
                    result = autosort_undo(log_id)
                    print(json.dumps({"_id": req_id, **result}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "error": "Autosort service unavailable"}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Undo failed: {e}"}), flush=True)

        elif action == "save_version":
            file_path = request.get("file_path")
            old_content = request.get("old_content", "")
            new_content = request.get("new_content", "")
            
            # Strict Deduplication: Prevent double-entries from Chokidar overlapping with internal saves
            from core.versioning.snapshot_manager import get_last_version, compute_file_hash
            import os
            ext = os.path.splitext(file_path)[1].lower() if file_path else ""
            is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]
            
            try:
                last_version = get_last_version(file_path)
                current_hash = compute_file_hash(new_content if not is_binary else file_path, is_binary)
                
                if last_version and last_version.get("file_hash") == current_hash:
                    # File is identical to the very last snapshot. Silently ignore duplicate.
                    print(json.dumps({"_id": req_id, "success": True, "data": last_version}), flush=True)
                    continue
            except Exception:
                pass
                
            ve = get_version_engine()
            result = ve.process_and_save(file_path, old_content, new_content)
            print(json.dumps({"_id": req_id, "success": True, "data": result}), flush=True)

        elif action == "get_versions":
            try:
                from core.versioning.snapshot_manager import list_versions, get_last_version, compute_file_hash, get_version_content
                import os
                file_path = request.get("file_path")
                
                # Auto-sync external changes
                if file_path and os.path.exists(file_path):
                    ext = os.path.splitext(file_path)[1].lower()
                    is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]
                    current_content = None
                    if is_binary:
                        current_hash = compute_file_hash(file_path, True)
                    else:
                        with open(file_path, "r", encoding="utf-8") as f:
                            current_content = f.read()
                        current_hash = compute_file_hash(current_content, False)
                        
                    last_version = get_last_version(file_path)
                    
                    if not last_version or last_version.get("file_hash") != current_hash:
                        # Skip creating a meaningless version if it's a freshly created 0-byte file
                        if not last_version and os.path.getsize(file_path) == 0:
                            pass
                        else:
                            ve = get_version_engine()
                            old_content = None
                            if last_version:
                                try:
                                    old_content = get_version_content(file_path, last_version["version_id"])
                                except Exception:
                                    pass
                                    
                            # Prevent text diff engine crashes from NoneType by defaulting to empty string
                            if not is_binary and old_content is None:
                                old_content = ""
                                    
                            if is_binary:
                                ve.process_and_save(file_path, old_content, file_path)
                            else:
                                ve.process_and_save(file_path, old_content, current_content)

                versions = list_versions(file_path)
                print(json.dumps({"_id": req_id, "success": True, "data": versions}), flush=True)
            except Exception as e:
                import traceback
                print(json.dumps({"_id": req_id, "error": str(e) + " " + traceback.format_exc()}), flush=True)

        elif action == "restore_version":
            try:
                import importlib
                import core.versioning.rollback_manager as rollback_manager
                rollback_manager = importlib.reload(rollback_manager)
                file_path = request.get("file_path")
                version_id = request.get("version_id")
                result = rollback_manager.restore_version(file_path, version_id)
                result["_id"] = req_id
                print(json.dumps(result), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": str(e)}), flush=True)

        elif action == "smart_cleanup":
            try:
                from core.versioning.cleanup_manager import run_smart_cleanup
                file_path = request.get("file_path")
                result = run_smart_cleanup(file_path)
                result["_id"] = req_id
                print(json.dumps(result), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": str(e)}), flush=True)
            
        elif action == "compare_versions":
            try:
                from core.versioning.snapshot_manager import compare_versions
                file_path = request.get("file_path")
                version_a = request.get("version_a")
                version_b = request.get("version_b")
                result = compare_versions(file_path, version_a, version_b)
                print(json.dumps({"_id": req_id, "success": True, "data": result}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": str(e)}), flush=True)

        else:
            print(json.dumps({"_id": req_id, "error": "Unknown action"}), flush=True)

    except Exception as e:
        # Global catch-all to prevent loop crash
        try:
            print(json.dumps({"_id": req_id if 'req_id' in locals() else None, "error": f"Critical engine error: {e}"}), flush=True)
        except:
            pass

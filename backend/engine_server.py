import json
import sys
import os
import threading
# Ensure backend/ is on sys.path
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

sys.stderr.write("[engine] Starting resilient process...\n")
sys.stderr.flush()

_DATA_DIR = os.path.join(_BACKEND_DIR, "data")
os.makedirs(_DATA_DIR, exist_ok=True)
try:
    from core.db import init_db
    init_db()
    sys.stderr.write("[engine] SQLite database ready\n")
except Exception as e:
    sys.stderr.write(f"[engine] DB init warning (non-fatal): {e}\n")
sys.stderr.flush()

# Global engine instances (lazy loaded)
_version_engine = None

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

print("IntelliFile Python Engine Ready", flush=True)

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
                from core.search import semantic_search
                query = request.get("query", "").strip()
                date_from = request.get("date_from")  # Unix timestamp or None
                date_to = request.get("date_to")      # Unix timestamp or None
                results = semantic_search(query, date_from=date_from, date_to=date_to)
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
                from indexing.index_files import index_files_incremental
                from indexing.update_faiss import update_faiss
                from core.faiss_manager import load_index, invalidate_cache
                
                root_label = folder or "default"
                sys.stderr.write(f"[engine] Indexing started (root={root_label})\n")
                sys.stderr.flush()

                import time as _time
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

                affected = index_files_incremental(folder, progress_cb=emit_progress)
                update_faiss(affected, progress_cb=emit_progress)
                invalidate_cache()
                load_index(force_reload=True)
                total_secs = round(_time.perf_counter() - _t_total, 1)
                sys.stderr.write(f"[engine] Indexing completed in {total_secs}s (chunks={len(affected)})\n")
                sys.stderr.flush()

                emit_progress("done", f"Indexing complete — {len(affected)} chunks in {total_secs}s", pct=100)
                print(json.dumps({"_id": req_id, "status": "indexed", "folder": folder or "", "total_secs": total_secs, "chunks": len(affected)}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Indexing failed: {e}"}), flush=True)

        elif action == "index_file":
            try:
                from indexing.single_file_ingest import ingest_single_file
                file_path = request.get("file_path")
                if file_path and os.path.exists(file_path):
                    result = ingest_single_file(file_path)
                    print(json.dumps({"_id": req_id, "status": "indexed", "file_path": file_path, "data": result}), flush=True)
                else:
                    print(json.dumps({"_id": req_id, "status": "skipped", "reason": "file_not_found", "file_path": file_path}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Single file indexing failed: {e}"}), flush=True)

        elif action == "delete_file":
            try:
                from indexing.single_file_ingest import remove_single_file
                file_path = request.get("file_path")
                if not file_path:
                    print(json.dumps({"_id": req_id, "error": "Missing file_path"}), flush=True)
                else:
                    result = remove_single_file(file_path)
                    print(json.dumps({"_id": req_id, "success": True, "file_path": file_path, "data": result}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Delete failed: {e}"}), flush=True)

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
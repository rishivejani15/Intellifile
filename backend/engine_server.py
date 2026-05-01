import json
import sys
import os

# Ensure backend/ is on sys.path
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

sys.stderr.write("[engine] Starting resilient process...\n")
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
                results = semantic_search(query)
                response = {
                    "_id": req_id,
                    "results": [{"path": p, "score": round(float(s), 3)} for p, s in results]
                }
                print(json.dumps(response), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Search failed: {e}"}), flush=True)

        elif action == "index":
            try:
                folder = request.get("folder", "").strip()
                from indexing.index_files import index_files_incremental
                from indexing.update_faiss import update_faiss
                from core.faiss_manager import load_index, invalidate_cache
                
                affected = index_files_incremental(folder)
                update_faiss(affected)
                invalidate_cache()
                load_index(force_reload=True)
                print(json.dumps({"_id": req_id, "status": "indexed", "folder": folder}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": f"Indexing failed: {e}"}), flush=True)

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
                from core.versioning.rollback_manager import restore_version
                file_path = request.get("file_path")
                version_id = request.get("version_id")
                result = restore_version(file_path, version_id)
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

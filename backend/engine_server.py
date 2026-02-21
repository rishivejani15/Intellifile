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
            ve = get_version_engine()
            result = ve.process_and_save(file_path, old_content, new_content)
            print(json.dumps({"_id": req_id, "success": True, "data": result}), flush=True)

        elif action == "get_versions":
            try:
                from core.versioning.snapshot_manager import list_versions
                file_path = request.get("file_path")
                versions = list_versions(file_path)
                print(json.dumps({"_id": req_id, "success": True, "data": versions}), flush=True)
            except Exception as e:
                print(json.dumps({"_id": req_id, "error": str(e)}), flush=True)

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

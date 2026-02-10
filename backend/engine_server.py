import json
import sys
import os

# Ensure backend/ is on sys.path so `core.*` imports work
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

sys.stderr.write("[engine] Starting up...\n")
sys.stderr.flush()

try:
    sys.stderr.write("[engine] Loading model...\n")
    sys.stderr.flush()
    from core.search import semantic_search
    from core.faiss_manager import load_index, invalidate_cache
    sys.stderr.write("[engine] Model loaded OK\n")
    sys.stderr.flush()
except Exception as e:
    sys.stderr.write(f"[engine] FATAL import error: {e}\n")
    sys.stderr.flush()
    sys.exit(1)


def _run_indexing(folder):
    """
    Run the full index-then-embed pipeline for *folder*.
    Imported lazily so the startup path stays fast.
    """
    from indexing.index_files import index_files_incremental
    from indexing.update_faiss import update_faiss

    affected = index_files_incremental(folder)
    update_faiss(affected)
    # After building new vectors, make search pick them up
    invalidate_cache()
    load_index(force_reload=True)


print("IntelliFile Python Engine Ready", flush=True)

while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break

        request = json.loads(line.strip())
        action = request.get("action")
        req_id = request.get("_id")       # echo back for request multiplexing

        if action == "search":
            query = request.get("query", "").strip()
            results = semantic_search(query)
            response = {
                "_id": req_id,
                "results": [
                    {"path": path, "score": round(float(score), 3)}
                    for path, score in results
                ]
            }
            print(json.dumps(response), flush=True)

        elif action == "index":
            folder = request.get("folder", "").strip()
            if not folder or not os.path.isdir(folder):
                print(json.dumps({"_id": req_id, "error": f"Invalid folder: {folder}"}), flush=True)
                continue
            _run_indexing(folder)
            print(json.dumps({"_id": req_id, "status": "indexed", "folder": folder}), flush=True)

        else:
            print(json.dumps({"_id": req_id, "error": "Unknown action"}), flush=True)

    except Exception as e:
        print(json.dumps({"_id": req_id if 'req_id' in dir() else None, "error": str(e)}), flush=True)

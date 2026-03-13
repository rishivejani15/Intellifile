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


def _run_indexing(req_id=None):
    """
    Run the full index-then-embed pipeline for the whole device.
    Streams progress lines to stdout so the frontend can show live updates.
    """
    import time
    import json as _json
    from indexing.index_files import index_files_incremental
    from indexing.update_faiss import update_faiss

    pipeline_start = time.perf_counter()

    def send_progress(phase, detail="", pct=None):
        elapsed = time.perf_counter() - pipeline_start
        msg = {
            "_id": req_id,
            "type": "progress",
            "phase": phase,
            "detail": detail,
            "elapsed": round(elapsed, 1),
        }
        if pct is not None:
            msg["pct"] = pct
        print(_json.dumps(msg), flush=True)

    send_progress("scan", "Scanning drives for files…")
    affected = index_files_incremental(progress_cb=send_progress)

    send_progress("embed", f"Embedding {len(affected)} chunks…")
    update_faiss(affected, progress_cb=send_progress)

    # After building new vectors, make search pick them up
    invalidate_cache()
    load_index(force_reload=True)

    total_secs = time.perf_counter() - pipeline_start
    mins, secs = divmod(int(total_secs), 60)
    time_str = f"{mins}m {secs}s" if mins else f"{secs}s"
    send_progress("done", f"Indexing complete in {time_str}", pct=100)

    # ── Auto-run a second pass to catch any files missed during extraction ──
    send_progress("scan", "Running verification pass…")
    affected2 = index_files_incremental(progress_cb=send_progress)
    if affected2:
        send_progress("embed", f"Embedding {len(affected2)} new chunks…")
        update_faiss(affected2, progress_cb=send_progress)
        invalidate_cache()
        load_index(force_reload=True)
        extra_secs = time.perf_counter() - pipeline_start - total_secs
        send_progress("done", f"Verification pass done (+{int(extra_secs)}s)", pct=100)


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
            _run_indexing(req_id=req_id)
            print(json.dumps({"_id": req_id, "status": "indexed", "scope": "device"}), flush=True)

        else:
            print(json.dumps({"_id": req_id, "error": "Unknown action"}), flush=True)

    except Exception as e:
        print(json.dumps({"_id": req_id if 'req_id' in dir() else None, "error": str(e)}), flush=True)

import json
import sys

from core.search import semantic_search

print("IntelliFile Python Engine Ready", flush=True)

while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break

        request = json.loads(line.strip())
        action = request.get("action")

        if action == "search":
            query = request.get("query", "").strip()

            results = semantic_search(query)

            response = {
                "results": [
                    {
                        "path": path,
                        "score": round(float(score), 3)
                    }
                    for path, score in results
                ]
            }

            print(json.dumps(response), flush=True)

        else:
            print(json.dumps({"error": "Unknown action"}), flush=True)

    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)

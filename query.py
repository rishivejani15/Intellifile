from search import semantic_search

# print("FAISS idx:", id, "file_id:", file_id)

while True:
    q = input("\n Search query (or 'exit'): ")
    if q.lower() == "exit":
        break
    
    results = semantic_search(q, top_k=1)
    
    if results:
        path, score = results[0]
        print(f"1. {path} (Score: {score:.4f})")
    else:
        print("No results found.")
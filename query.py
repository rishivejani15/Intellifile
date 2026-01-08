from search import semantic_search

print("IntelliFile Semantic Search")
print("Type your query or 'exit' to quit.")

while True:
    query = input("\nSearch query (or 'exit'): ").strip()

    if query.lower() == "exit":
        print("Exiting...")
        break

    if not query:
        print("Please enter a valid query.")
        continue

    results = semantic_search(query, top_k=20)

    if not results:
        print("No relevant files found.")
        continue

    print("\nTop Results:")
    for i, (path, score) in enumerate(results, 1):
        print(f"{i}. {path}")
        print(f"   Similarity score: {score:.3f}")

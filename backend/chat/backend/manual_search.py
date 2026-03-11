import sys
import os

# Set up path to allow imports
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from backend.search.search import semantic_search

query = "please summarize this whole file"
print(f"Searching for: {query}")
results = semantic_search(query)
print(f"Results: {len(results)}")
for text, score in results:
    print(f"- {score}: {text[:50]}...")

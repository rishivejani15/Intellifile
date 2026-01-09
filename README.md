# IntelliFile

Semantic search for local documents using SentenceTransformers embeddings and a FAISS index.

IntelliFile scans a folder of files (PDF, DOCX, TXT), extracts text, splits it into chunks, embeds each chunk, and builds a FAISS index for fast similarity search. You can search via a simple CLI or call the search function programmatically.

## Features
- PDF, DOCX, and TXT ingestion
- SQLite metadata store for files and chunk mapping
- Word-based text chunking (default ~400 words)
- Embedding with SentenceTransformers (default: `all-MiniLM-L6-v2`)
- FAISS L2 index with normalized embeddings
- Simple interactive search CLI

## Project Structure
```
build_index.py      # Build the FAISS vector index from chunks in the DB
chunker.py          # Split extracted text into ~400-word chunks
db.py               # SQLite schema and connection helpers
embedder.py         # Create embeddings and write FAISS index + chunk map
extractor.py        # Extract text from PDF/DOCX/TXT
index_files.py      # Scan folder, extract text, create chunk rows in DB
query.py            # Interactive CLI for semantic search
requirements.txt    # Python dependencies
scanner.py          # Discover supported files recursively
search.py           # Load model + index and perform semantic search

data/
  files.db          # SQLite DB (created at runtime)
  vectors.faiss     # FAISS index (created by build step)
  chunk_ids.npy     # Mapping (file_id, chunk_index) per vector

test_files/         # Example input directory to scan
```

## Installation
1. Use Python 3.9+ (recommended).
2. Install dependencies:

```bash
pip install -r requirements.txt
```

If you are on Windows and encounter FAISS install issues, ensure you are using the `faiss-cpu` wheel provided on PyPI and a compatible Python version.

## Quick Start
1. Put some documents in `test_files/` (PDF, DOCX, or TXT). You can change the target folder later.
2. Index files into the SQLite DB (creates file and chunk rows):

```bash
python index_files.py
```

3. Build the embeddings and FAISS index:

```bash
python build_index.py
```

4. Run the interactive search CLI:

```bash
python query.py
```

Type queries and press Enter. Results are paths ranked by similarity.

## Programmatic Usage
You can call the semantic search function directly:

```python
from search import semantic_search

results = semantic_search("renewal clause termination", top_k=20)
for path, score in results:
    print(path, score)
```

### Scoring
Search uses normalized embeddings and FAISS L2 distances, converted to a similarity in `[0, 1]`. Very weak matches below `min_similarity` (default `0.3`) are ignored.

## Configuration
- Model selection: set `IF_MODEL_PATH` to override the default SentenceTransformers model.
  
  Example:
  ```bash
  set IF_MODEL_PATH=all-MiniLM-L12-v2  # Windows (cmd)
  export IF_MODEL_PATH=all-MiniLM-L12-v2  # macOS/Linux
  ```
- Scan folder: by default, `index_files.py` scans `test_files/`. Change the argument in `scan_folder("test_files")` to point to another directory.
- Supported types: configured in `scanner.py` (`.pdf`, `.docx`, `.txt`).

## Re-indexing and Updates
- Adding new files: re-run `index_files.py` then `build_index.py`.
- Modifying existing files: the current pipeline inserts file rows with `INSERT OR IGNORE`. It does not update changed files/chunks automatically. For a clean rebuild, delete generated artifacts and re-run:
  - Remove `data/files.db`, `data/vectors.faiss`, and `data/chunk_ids.npy`.
  - Run `python index_files.py` then `python build_index.py`.

## How It Works
1. `index_files.py`: scans the folder, records files in SQLite, and adds chunk rows per file (without embeddings yet).
2. `build_index.py` → `embedder.build_faiss()`: loads each file, re-chunks text, embeds chunks with SentenceTransformers, writes a FAISS index and a NumPy chunk map.
3. `search.py`: loads the model and FAISS index, embeds the query, retrieves nearest chunk vectors, maps them back to files, and aggregates the best score per file.
4. `query.py`: lightweight CLI loop that prints ranked results.

## Notes & Limitations
- Chunking is word-count based with no overlap; consider overlap for better recall on long passages.
- `build_index.py` re-extracts and re-chunks text when embedding; for very large corpora, consider caching extracted text/chunks.
- The DB currently doesn’t handle updates/deletes; a future improvement is tracking `modified_time` to refresh affected chunks.

## Troubleshooting
- FAISS or torch install issues: verify Python version compatibility and retry `pip install -r requirements.txt`. On Windows, prefer `faiss-cpu` wheels.
- Empty or short files: files with less than 50 characters are skipped.
- No results: try lowering `min_similarity` in `semantic_search(query, min_similarity=0.2)`.


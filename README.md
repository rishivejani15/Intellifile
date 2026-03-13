# IntelliFile

AI-powered desktop search that finds files by meaning, keywords, and filename.

IntelliFile scans your drives, extracts text from supported documents, builds a vector index, and lets you search with natural language. Example: searching `tax return last year` can find a file even when those exact words are not in the filename.

Built with Electron + React (frontend) and Python + FAISS + SQLite + SentenceTransformers (backend).

---

## What This Project Does

- Indexes local files across available drives.
- Extracts document text (PDF, Word, Excel, PowerPoint, text formats).
- Splits text into chunks and converts each chunk to embeddings.
- Stores:
  - metadata/chunks in SQLite
  - vectors in FAISS
  - keyword index in SQLite FTS5
- Runs hybrid search using:
  - semantic similarity (FAISS)
  - keyword match (FTS5 BM25)
  - filename/path match (SQL LIKE)

---

## Current Search Approach

IntelliFile uses a hybrid ranking pipeline:

1. Semantic retrieval from FAISS using cosine similarity.
2. Keyword retrieval from SQLite FTS5 (BM25 ranking).
3. Filename/path substring retrieval.
4. Reciprocal Rank Fusion (RRF) combines all rankings.
5. UI score shows real cosine similarity (not fake normalization to 100%).

This improves both recall (semantic) and precision (keyword/filename).

---

## Indexing Approach

### First indexing run

- Full scan across drives.
- Extract text from all eligible files.
- Chunk + embed + write vectors.
- Build/rebuild FTS5 index.

### Subsequent runs (incremental)

- Uses file `modified_time` comparison in SQLite.
- Only new/changed files are reprocessed.
- Deleted files are removed from DB + FAISS.

### Verification pass

After the first pass completes, the engine automatically runs a second incremental pass to catch files changed/locked during the first pass.

---

## Performance Optimizations Implemented

- ONNX Runtime backend for faster CPU embedding (fallback to PyTorch if ONNX unavailable).
- CPU thread tuning for embedding.
- Sentence-aware chunking.
- Larger chunk size with overlap to reduce chunk count.
- Max chunks per file cap to prevent outlier files dominating indexing time.
- Extracted text size cap per file.
- Batched DB writes and batched embedding updates.
- Parallel extraction worker pool.
- FAISS singleton cache + reload control.
- SQLite WAL mode + memory/cache pragmas.

---

## Why Some Files May Not Be Indexed

A file can be skipped if:

- extension is not in supported list
- file is larger than configured max size
- file is inside ignored folders (system/cache/dev folders)
- extraction parser fails on malformed/corrupted file
- access denied by OS permissions/locks

Even when text extraction is weak, filename/path matching still helps discover files.

---

## Supported File Types

Current indexing focuses on document-like formats:

- `.pdf`, `.docx`, `.doc`, `.odt`
- `.xlsx`, `.xls`, `.csv`
- `.pptx`, `.ppt`
- `.txt`, `.md`, `.rtf`

Code/config/log-heavy extensions are intentionally excluded to avoid noisy C: drive indexing.

---

## High-Level Architecture

- `frontend/`:
  - Electron app + React UI
  - progress display and user actions
- `backend/engine_server.py`:
  - stdin/stdout JSON bridge
  - search/index actions
- `backend/core/`:
  - scanner, extractor, chunker, model, search, db, faiss manager
- `backend/indexing/`:
  - incremental indexing pipeline
  - FAISS update flow

---

## Install

### Prerequisites

- Python 3.9+
- Node.js 18+

### Steps

1. Install Python dependencies:

```bash
pip install -r requirements.txt
```

2. Install frontend dependencies:

```bash
cd frontend
npm install
```

3. (Recommended) Ensure ONNX acceleration packages are installed:

```bash
pip install onnxruntime optimum
```

4. (One-time) Download model for offline usage:

```bash
python backend/setup_offline.py
```

---

## Run

```bash
cd frontend
npm start
```

- App launches Electron + backend engine.
- Indexing can run in background while you search.

---

## Reset and Rebuild Index

If you changed chunking/scanner/search behavior and want a clean rebuild:

```bash
del backend\data\files.db backend\data\vectors.faiss
```

Then start app and run indexing again.

---

## Configuration Notes

Important defaults are configured in code:

- model selection: `backend/core/model.py`
- scanner file filters/ignore dirs: `backend/core/scanner.py`
- extraction limits: `backend/core/extractor.py`
- chunking strategy: `backend/core/chunker.py`
- hybrid ranking and thresholds: `backend/core/search.py`
- incremental indexing pipeline: `backend/indexing/index_files.py`
- FAISS embedding update batching: `backend/indexing/update_faiss.py`

---

## Known Limitations

- Best quality is for English text.
- Typos/spelling mistakes reduce quality.
- Scanned image PDFs need OCR for best results.
- Very broad queries (example: `work stuff`) can return mixed relevance.

---

## License

MIT

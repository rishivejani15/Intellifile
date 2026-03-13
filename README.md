# IntelliFile

**AI-powered semantic file search engine for your entire computer.**

IntelliFile scans all drives on your machine, extracts text from documents (PDF, DOCX, XLSX, PPTX, TXT, CSV, MD), builds a vector index, and lets you search across everything using natural language. Type "tax return from last year" and it finds relevant files — even if those exact words don't appear in them.

Built with Electron + React on the frontend and Python (SentenceTransformers + FAISS + SQLite) on the backend.

![Hybrid Search Architecture](https://img.shields.io/badge/Search-Hybrid%20(Semantic%20%2B%20Keyword%20%2B%20Filename)-6c63ff?style=flat-square)
![Model](https://img.shields.io/badge/Model-all--MiniLM--L6--v2-green?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-28.2.3-blue?style=flat-square)

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [How Search Works](#how-search-works)
  - [1. Semantic Search (FAISS)](#1-semantic-search-faiss)
  - [2. Keyword Search (FTS5 BM25)](#2-keyword-search-fts5-bm25)
  - [3. Filename Search (FTS5)](#3-filename-search-fts5)
  - [Result Fusion (RRF)](#result-fusion-reciprocal-rank-fusion)
- [How Indexing Works](#how-indexing-works)
  - [Why It's Fast](#why-indexing-is-fast)
- [Search Accuracy](#search-accuracy)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Technical Details](#technical-details)
- [Performance Benchmarks](#performance-benchmarks)
- [App Size Breakdown](#app-size-breakdown)

---

## Features

- **Natural language search** — find files by meaning, not just keywords
- **Hybrid search** — combines semantic AI, keyword matching (BM25), and filename matching
- **Full device scan** — indexes all drives (C:\, D:\, etc.) automatically
- **Incremental indexing** — only re-processes changed/new files on subsequent runs
- **Live progress bar** — real-time progress streaming during indexing
- **Non-blocking UI** — search while indexing continues in the background
- **Auto-start indexing** — begins indexing as soon as the engine is ready
- **Supported formats**: PDF, DOCX, XLSX, XLS, CSV, PPTX, TXT, MD, RTF
- **Offline-first** — the ML model is bundled locally, no internet required
- **Desktop app** — Electron + React GUI with file explorer and diff viewer

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Electron (main.js)                         │
│  ┌──────────────┐    stdin/stdout JSON     ┌────────────────┐  │
│  │  React UI    │ ◄──────────────────────► │  Python Engine │  │
│  │  (Search.js) │    IPC bridge            │  (engine_      │  │
│  │              │                          │   server.py)   │  │
│  └──────────────┘                          └───────┬────────┘  │
│                                                    │           │
│                                    ┌───────────────┼─────────┐ │
│                                    │               │         │ │
│                              ┌─────▼──┐   ┌───────▼──┐  ┌───▼─┤
│                              │ FAISS  │   │ SQLite   │  │Model│
│                              │ Index  │   │ DB+FTS5  │  │(L6) │
│                              └────────┘   └──────────┘  └─────┤
└────────────────────────────────────────────────────────────────┘
```

**Communication Protocol**: The Electron main process spawns Python as a child process. They communicate via **line-delimited JSON** over stdin (requests) and stdout (responses + progress events). Each request carries a unique `_id` for multiplexing.

---

## How Search Works

IntelliFile uses a **hybrid search** combining three independent signals, fused with **Reciprocal Rank Fusion (RRF)** for maximum accuracy.

### 1. Semantic Search (FAISS)

**What it does**: Finds files whose *meaning* is similar to the query, even if they use different words.

- **Model**: [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) — a 22M parameter sentence transformer (384-dimensional embeddings)
- **Index**: FAISS `IndexFlatIP` (Inner Product on L2-normalized vectors = cosine similarity)
- **How**: The query is encoded to a 384-dim vector and compared against all stored chunk vectors
- **Threshold**: Minimum cosine similarity of `0.15` to filter noise
- **Aggregation**: Per file, the best chunk score is taken + diminishing bonuses for up to 3 additional matching chunks (×0.15 each). This means a 50-page PDF with 8 relevant sections ranks higher than a file with just 1 lucky match.

**Example**: Query "company financial planning" matches a file about "corporate budget allocation strategy" even though they share no exact words.

### 2. Keyword Search (FTS5 BM25)

**What it does**: Finds files containing the *exact terms* from the query.

- **Engine**: SQLite FTS5 virtual table with BM25 scoring
- **How**: The query is sanitized (strip special characters), terms are joined with OR, and matched against the full-text index of all chunk text
- **Why it matters**: Semantic search can miss exact matches. Searching for "Invoice #4829" needs keyword matching — the embedding model doesn't understand invoice numbers.

### 3. Filename Search (FTS5)

**What it does**: Boosts files whose *filename or path* matches the query terms.

- **Engine**: Separate FTS5 virtual table over `files.filename` and `files.path`
- **Why it matters**: Searching for "budget report" should rank `Budget_Report_2024.xlsx` highly, even before looking at its contents.

### Result Fusion (Reciprocal Rank Fusion)

Each signal produces an independent ranked list of files. These are combined using **RRF** — a proven fusion algorithm used in production search engines (Microsoft, Elasticsearch):

```
RRF_score(file) = Σ  weight_i / (K + rank_i)
```

Where `K = 60` (constant that controls how quickly lower-ranked results decay).

| Signal | Weight | Purpose |
|--------|--------|---------|
| Semantic (FAISS) | **50%** | Meaning-based recall |
| Keyword (FTS5/BM25) | **30%** | Exact term precision |
| Filename (FTS5) | **20%** | Filename relevance boost |

**Why RRF over simple score averaging?** Raw scores from different systems aren't comparable (cosine similarity ∈ [0,1] vs BM25 ∈ (-∞,0]). RRF converts everything to rank-based scores, making fusion fair and robust.

---

## How Indexing Works

```
Scan Drives ──► Extract Text ──► Chunk Text ──► Embed Chunks ──► FAISS Index
(os.scandir)    (pypdf/docx/     (400 words,    (MiniLM-L6-v2   (IndexFlatIP
 8 threads)      openpyxl/pptx)   80 overlap)    batch=256)       + IDMap)
                                      │
                                      ▼
                               SQLite DB + FTS5
                               (files, chunks,
                                chunks_fts, files_fts)
```

### Step-by-step

1. **Drive Scan** — `os.scandir` recursively traverses all logical drives (C:\, D:\, etc.). Top-level directories are distributed across 8 threads for parallelism. System folders (Windows, Program Files, node_modules, .git, etc.) are skipped. Only files ≤ 5 MB with supported extensions are collected.

2. **Incremental Diff** — All existing file records are loaded into a Python dict for O(1) lookups. Each scanned file is compared by `modified_time`:
   - **Unchanged** → skip entirely
   - **Modified** → delete old chunks, re-extract
   - **New** → insert file record, extract
   - **Deleted** → remove file + chunks from DB and FAISS

3. **Parallel Text Extraction** — A `ThreadPoolExecutor` (8 workers) extracts text from files concurrently. This is the biggest speed win because PDF/DOCX parsing is I/O-bound. Files with < 50 characters of content are skipped.

4. **Chunking** — Text is split into overlapping windows of **400 words** with **80-word overlap**. Each chunk is prefixed with the filename (e.g., `[Budget_Report.xlsx] ...text...`) so the embedding captures the file's identity.

5. **Embedding** — Chunks are encoded in batches of **256** using `all-MiniLM-L6-v2` with `normalize_embeddings=True`. Normalized vectors enable cosine similarity via fast inner-product search.

6. **FAISS Update** — Old chunk IDs are removed from the index, new embeddings are added with their SQLite row IDs. The index is saved to `vectors.faiss`.

7. **FTS5 Rebuild** — Both FTS5 virtual tables (`chunks_fts`, `files_fts`) are rebuilt for keyword search.

### Why Indexing is Fast

| Optimization | Impact |
|---|---|
| **Thread-pool extraction** (8 workers) | PDF/DOCX I/O runs in parallel → ~4-8x speedup |
| **WAL journal mode** | SQLite writes don't block reads |
| **64 MB page cache** (`PRAGMA cache_size=-64000`) | Hot data stays in memory |
| **In-memory temp store** | Avoids temp-file I/O |
| **Batch embedding** (256/batch) | Maximizes CPU throughput per encode call |
| **Batch DB commits** (every ~1000 chunks) | Fewer fsync calls |
| **Incremental indexing** | Only changed files are re-processed |
| **DB indexes** on `files.path` and `chunks.file_id` | O(log n) lookups |
| **5 MB file size cap** | Prevents massive files from blocking the pipeline |

---

## Search Accuracy

### Estimated Accuracy by Scenario

| Search Type | Example Query | Accuracy | Why |
|---|---|---|---|
| **Exact phrase** | "meeting notes January 15" | ~90% | FTS5 BM25 finds exact terms, semantic adds meaning |
| **Conceptual / synonym** | "financial planning" → finds "budget strategy" | ~75% | Semantic embeddings capture meaning |
| **Filename match** | "homework assignment" → `Homework_Assignment.docx` | ~85% | Filename FTS5 + chunk prefix |
| **Multi-section document** | Long PDF with many relevant paragraphs | ~80% | Multi-chunk aggregation with bonus scoring |
| **Numeric / ID search** | "Invoice #4829" | ~85% | FTS5 keyword match (semantic alone would fail) |
| **Misspelled query** | "budgt reprot" | ~40% | Neither FTS5 nor embeddings handle typos well |

### Model Characteristics

| Property | Value |
|---|---|
| Model | `all-MiniLM-L6-v2` |
| Parameters | 22.7M |
| Embedding dimensions | 384 |
| Max sequence length | 256 tokens (~200 words) |
| Training data | 1B+ sentence pairs |
| Semantic Textual Similarity (STS) benchmark | 78.9 (Spearman correlation) |
| Speed (CPU) | ~1000-2000 sentences/sec |

### Limitations

- **Max 256 tokens per chunk**: Text beyond ~200 words per chunk is truncated by the model's tokenizer. The 400-word chunk size accounts for this partially via overlap.
- **English-centric**: The model performs best on English text. Other languages work but with reduced accuracy.
- **No typo tolerance**: Misspellings degrade both semantic and keyword search.
- **Flat index (no ANN)**: FAISS `IndexFlatIP` is exact (100% recall) but O(n). For millions of chunks, an IVF or HNSW index would be needed.

---

## Project Structure

```
IntelliFile/
├── README.md
├── requirements.txt
│
├── backend/
│   ├── engine_server.py          # Python engine (stdin/stdout JSON protocol)
│   ├── setup_offline.py          # Download model for offline use
│   │
│   ├── core/
│   │   ├── model.py              # SentenceTransformer singleton (all-MiniLM-L6-v2)
│   │   ├── search.py             # Hybrid search: semantic + keyword + filename + RRF
│   │   ├── scanner.py            # Multi-drive recursive file scanner (8 threads)
│   │   ├── extractor.py          # Text extraction (PDF, DOCX, XLSX, PPTX, CSV, TXT)
│   │   ├── chunker.py            # Word-level overlapping chunker with filename prefix
│   │   ├── embedder.py           # Full FAISS index builder (from scratch)
│   │   ├── faiss_manager.py      # FAISS index singleton (load/save/cache)
│   │   ├── db.py                 # SQLite + FTS5 schema, WAL mode, indexes
│   │   └── file_state.py         # File state helpers
│   │
│   ├── indexing/
│   │   ├── run_indexing.py        # Entry point: index + update FAISS
│   │   ├── index_files.py        # Parallel incremental indexing pipeline
│   │   ├── update_faiss.py       # Batched FAISS vector updates
│   │   └── build_index.py        # Full FAISS rebuild from scratch
│   │
│   ├── data/                     # Runtime data (created automatically)
│   │   ├── files.db              # SQLite database
│   │   └── vectors.faiss         # FAISS vector index
│   │
│   └── models/                   # Cached ML model (~87 MB)
│       └── models--sentence-transformers--all-MiniLM-L6-v2/
│
├── frontend/
│   ├── main.js                   # Electron main process + Python spawning
│   ├── preload.js                # Context bridge (IPC + intellifile API)
│   ├── package.json              # Electron 28.2.3 + React 18
│   │
│   ├── public/
│   │   └── index.html
│   │
│   └── src/
│       ├── App.js
│       ├── pages/
│       │   ├── Search.js         # Search page with progress bar + auto-indexing
│       │   ├── Search.css
│       │   ├── Home.js
│       │   └── Settings.js
│       ├── components/
│       │   ├── FileExplorer/     # File browser component
│       │   ├── FileUpload/       # File upload component
│       │   ├── DiffViewer/       # File diff viewer
│       │   ├── MergeSuggestions/ # AI merge suggestions
│       │   └── FileSelector/     # File selector widget
│       └── services/
│           └── searchService.js  # Search/index API wrapper
│
└── test_files/                   # Test documents
```

---

## Installation

### Prerequisites

- **Python 3.9+** (tested with 3.11)
- **Node.js 18+**
- **npm**

### Setup

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd IntelliFile
   ```

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Install frontend dependencies**:
   ```bash
   cd frontend
   npm install
   ```

4. **Download the ML model** (for offline use):
   ```bash
   python backend/setup_offline.py
   ```
   This caches `all-MiniLM-L6-v2` into `backend/models/` (~87 MB).

---

## Quick Start

1. **Start the app**:
   ```bash
   cd frontend
   npm start
   ```
   This launches both the React dev server and Electron.

2. **Search** — The engine auto-starts indexing on launch. You can search immediately; results improve as indexing progresses.

3. **Re-index** — Click "🧠 Index Entire Device" to trigger a full re-index. Only changed files are re-processed.

### Programmatic Usage

```python
from core.search import semantic_search

results = semantic_search("quarterly budget report", top_k=20)
for path, score in results:
    print(f"{score:.3f}  {path}")
```

---

## Configuration

| Setting | Location | Default | Description |
|---|---|---|---|
| **ML Model** | `IF_MODEL_PATH` env var | `all-MiniLM-L6-v2` | SentenceTransformer model name |
| **Chunk size** | `core/chunker.py` | 400 words | Words per chunk |
| **Chunk overlap** | `core/chunker.py` | 80 words | Overlap between consecutive chunks |
| **Max file size** | `core/scanner.py` | 5 MB | Files larger than this are skipped |
| **Scan threads** | `core/scanner.py` | 8 | Thread pool size for drive scanning |
| **Extract threads** | `indexing/index_files.py` | 8 (or CPU count) | Thread pool size for text extraction |
| **Embed batch size** | `indexing/update_faiss.py` | 256 | Sentences per encode call |
| **Search timeout** | `frontend/main.js` | 120 sec | Default IPC timeout |
| **Index timeout** | `frontend/main.js` | 1800 sec (30 min) | Indexing IPC timeout |
| **Semantic weight** | `core/search.py` | 0.50 | RRF weight for semantic signal |
| **Keyword weight** | `core/search.py` | 0.30 | RRF weight for keyword signal |
| **Filename weight** | `core/search.py` | 0.20 | RRF weight for filename signal |
| **Min similarity** | `core/search.py` | 0.15 | FAISS cosine similarity floor |
| **RRF K** | `core/search.py` | 60 | Reciprocal Rank Fusion constant |
| **Top-K results** | `core/search.py` | 20 | Max results returned |
| **Ignored dirs** | `core/scanner.py` | Windows, Program Files, node_modules, .git, etc. | Skipped during scan |

---

## Technical Details

### SQLite Configuration

| PRAGMA | Value | Purpose |
|---|---|---|
| `journal_mode` | WAL | Concurrent reads during writes |
| `synchronous` | NORMAL | Faster writes with data safety |
| `cache_size` | -64000 (64 MB) | Large page cache for hot data |
| `temp_store` | MEMORY | Avoid temp file I/O |

### Database Schema

```sql
-- File metadata
CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE,
    filename TEXT,
    modified_time INTEGER       -- Unix timestamp
);

-- Text chunks
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER,
    chunk_index INTEGER,
    text TEXT,
    FOREIGN KEY(file_id) REFERENCES files(id)
);

-- FTS5 for keyword search over chunk content
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');

-- FTS5 for filename/path search
CREATE VIRTUAL TABLE files_fts USING fts5(filename, path, content='files', content_rowid='id');

-- Indexes
CREATE INDEX idx_files_path ON files(path);
CREATE INDEX idx_chunks_file_id ON chunks(file_id);
```

### FAISS Index

| Property | Value |
|---|---|
| Type | `IndexFlatIP` (exact inner product) |
| Wrapper | `IndexIDMap` (preserves chunk row IDs) |
| Dimensions | 384 |
| Normalization | L2-normalized (cosine similarity via IP) |
| Recall | 100% (exact search, not approximate) |
| Storage | `backend/data/vectors.faiss` |

### Electron ↔ Python Protocol

```
Electron                          Python
   │                                │
   │── {"action":"search",   ──────►│
   │    "query":"...",              │
   │    "_id":1}                    │
   │                                │
   │◄── {"_id":1, "results": ──────│
   │     [{path,score},...]}        │
   │                                │
   │── {"action":"index",    ──────►│
   │    "_id":2}                    │
   │                                │
   │◄── {"_id":2, "type":    ──────│  (progress, streamed)
   │     "progress", "phase":       │
   │     "extract", "pct":45}       │
   │     ...                        │
   │◄── {"_id":2, "status":  ──────│  (final response)
   │     "indexed"}                 │
```

---

## Performance Benchmarks

### Search Latency

| Step | Time |
|---|---|
| Query embedding (all-MiniLM-L6-v2) | ~15–40 ms |
| FAISS inner product search | ~1–15 ms |
| FTS5 keyword search | ~1–5 ms |
| FTS5 filename search | ~1–3 ms |
| SQLite path lookup + RRF fusion | ~2–10 ms |
| **Total** | **~50–200 ms** |

### Indexing Time (first run)

| Phase | Home PC (~5K files) | Dev Machine (~20K files) |
|---|---|---|
| Drive scan (8 threads) | ~30–90 sec | ~1–2 min |
| Text extraction (8 threads) | ~2–5 min | ~5–10 min |
| Embedding (CPU, batch=256) | ~1–3 min | ~3–8 min |
| FTS5 rebuild | ~1–5 sec | ~5–15 sec |
| **Total** | **~4–8 min** | **~10–20 min** |

### Incremental Re-index

Only changed/new files are processed: **seconds to ~1 minute**.

---

## App Size Breakdown

| Component | Size |
|---|---|
| Electron + node_modules | ~563 MB |
| PyTorch (CPU-only) | ~447 MB |
| transformers library | ~88 MB |
| all-MiniLM-L6-v2 model | ~87 MB |
| faiss-cpu | ~25 MB |
| Other Python deps | ~20 MB |
| Application code | < 1 MB |
| **Runtime data** (DB + FAISS index) | ~50–200 MB |

| | |
|---|---|
| **Development total** | ~1.2 GB |
| **Packaged app (estimated)** | ~800 MB – 1 GB |

---

## Dependencies

### Python (`requirements.txt`)

| Package | Purpose |
|---|---|
| `sentence-transformers` | ML model for text embeddings |
| `faiss-cpu` | Vector similarity search |
| `pypdf` | PDF text extraction |
| `python-docx` | DOCX text extraction |
| `openpyxl` | XLSX/XLS spreadsheet extraction |
| `python-pptx` | PPTX presentation extraction |
| `Pillow` | Image handling (future OCR support) |
| `pytesseract` | OCR engine wrapper (future support) |
| `numpy` | Numerical operations |
| `tqdm` | Progress bars |

### Frontend (`package.json`)

| Package | Purpose |
|---|---|
| `electron` 28.2.3 | Desktop app framework |
| `react` 18.2.0 | UI framework |
| `react-dom` 18.2.0 | React DOM rendering |
| `react-diff-view` | File diff visualization |
| `axios` | HTTP client |
| `concurrently` | Run multiple scripts |

---

## License

MIT

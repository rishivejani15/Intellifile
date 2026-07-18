# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

IntelliFile is an AI-powered, privacy-first desktop search engine + document chat (RAG) app. Everything runs 100% offline. The shipped product is an Electron shell wrapping a Python backend. Two other subsystems live in the repo but are not part of the desktop build: a peer-to-peer `sync/` service and a separate Flutter mobile/web app under `intellifile_app/`.

## Architecture

### Two-process desktop app (the main product)
- **Frontend** (`frontend/`): Electron (`main.js`, `preload.js`) + React (`src/`). `main.js` owns the OS-integration logic (default file-manager registration, single-instance lock, startup path parsing, sync engine, updater). `preload.js` exposes a `contextBridge` as `window.intellifile.*` (and `window.electron.*`) so the renderer never touches Node directly.
- **Backend engine** (`backend/engine_server.py`): a long-running Python process spawned by Electron as a child process. It speaks a **line-delimited JSON protocol over stdin/stdout** — each request is one JSON object with an `action` and `_id`; each response is one JSON object with the same `_id`. Actions: `search`, `index`, `index_file`, `delete_file`, `model_status`, `document_preview`, `save_version`, `get_versions`, `restore_version`, `smart_cleanup`, `compare_versions`.
- **Chat/RAG API** (`backend/chat/backend/main.py`): a separate FastAPI app run via `uvicorn` (default port 8001) that powers "Chat with File". It streams tokens (SSE-like `StreamingResponse`) and is proxied by Electron through IPC. This is distinct from `engine_server.py`.

The flow: Renderer → `window.intellifile.*` (preload) → `ipcMain` handlers in `main.js` → either `engine_server.py` (stdio JSON) or the FastAPI chat server (HTTP).

### Indexing & search pipeline (`backend/core/` + `backend/indexing/`)
1. `scanner.py` crawls drives, skipping `node_modules`, `.git`, system temp, and applying length/chunk caps to avoid throttling on huge files.
2. `extractor.py` parses PDF / DOCX / XLSX / TXT / code; format-specific chunking lives in `chunker.py` (sentence-aware, ~512 tokens, ≥50-token overlap; Excel rows handled distinctly from narrative text).
3. `core/model.py` + `embedder.py` produce 384-dim embeddings with **ONNX Runtime only** (no PyTorch/SentenceTransformers) using `Xenova/bge-small-en-v1.5`.
4. Vectors go into a **FAISS** index (`core/faiss_manager.py`); metadata + FTS5 full-text index go into **SQLite** (`core/db.py`, WAL mode). Indexing is **incremental** via `modified_time` + content hashing (`crypto_utils.py`, `file_state.py`).
5. `core/search.py` ranks results with **Reciprocal Rank Fusion (RRF, k=60)** fusing three signals: FAISS semantic similarity, SQLite FTS5 BM25, and a filename/path boost. Supports `date_from`/`date_to` and `root_folder` filters.

### Chat RAG (`backend/chat/backend/`)
- `llm.py` loads Qwen 2.5 (1.5B/3B) via `llama-cpp` (GGUF `q4_k_m`/`q5_k_m`), tuned `n_ctx=4096`, `n_batch=512`, `n_gpu_layers=-1`, `n_threads=max`.
- `chat_store.py` enforces **isolated per-file context** — only the double-clicked file's chunks are injected, and the buffer is cleared when the target changes, preventing cross-document "context bleed".

### Versioning (`backend/core/versioning/`)
`snapshot_manager.py`, `version_engine.py`, `rollback_manager.py`, `cleanup_manager.py`. Text files get content diffs; binary (`docx`/`xlsx`/`pdf`/`zip`) are versioned by hash/path. `engine_server.py` dedupes identical consecutive snapshots and auto-syncs external file changes on `get_versions`.

### Models
Stored under `backend/models/` (ONNX embedder + Qwen GGUF). Fetched by `backend/setup_offline.py` or the app's offline-setup flow. Config via env: `IF_MODEL_PATH`, `IF_MODELS_DIR`, `IF_DATA_DIR` (`core/paths.py`). The active embedding model is a singleton in `core/model.py`.

### Backgrounding
`engine_server.py` runs indexing and deletions on **background threads** (separate queues) so long FAISS rebuilds don't block the search-bar request loop — keep this invariant when touching indexing.

## Common commands

### Prerequisites
- Python 3.11+, Node.js 18+, C++ build tools (Windows). For GPU: install `llama-cpp-python` with the right CUDA/cuBLAS flags.

### Backend (developer setup)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows PowerShell
pip install -r requirements.txt
pip install onnxruntime optimum
python setup_offline.py       # downloads embedder + Qwen GGUF into backend/models
```

### Run backend components manually
```bash
# Chat/RAG API (FastAPI) — used by Electron for "Chat with File"
cd backend && python -m uvicorn chat.backend.main:app --host 127.0.0.1 --port 8001

# Engine IPC server (normally spawned by Electron, but runnable directly)
python backend/engine_server.py
```
The engine accepts `--offline-setup` to run the model-download flow and exit.

### Frontend
```bash
cd frontend
npm install
npm start            # runs react-scripts (localhost:3000) + Electron concurrently
# or separately:
npm run react-start  # React dev server only
npm run electron-dev # Electron only (point it at an already-running backend)
```

### Build the installer (Windows)
```powershell
.\build.ps1          # from repo root: PyInstaller freeze -> npm build -> electron-builder
# equivalent: cd frontend && npm run dist
```
Output: `dist/IntelliFile Setup x.y.z.exe`. PyInstaller spec is `backend/intellifile_engine.spec`; the frozen binary lands in `backend-dist/` which electron-builder bundles as `extraResources`.

### AI provider config
Chat provider is selected by `backend/config/settings.py` (`AI_PROVIDER`). Providers live in `backend/ai/providers/` (base, rule_based, gemini) selected by `backend/ai/ai_factory.py`. Default is `rule_based`.

### Tests
Backend tests are `unittest`-based (e.g. `backend/tests/test_document_preview.py`).
```bash
# Run the whole backend test suite
python -m unittest discover -s backend/tests -v
# Run a single test file
python -m unittest backend.tests.test_document_preview -v
# Run a single test case / method
python -m unittest backend.tests.test_document_preview.DocumentPreviewTests.test_pdf_preview_marks_page_without_extractable_text -v
```
Standalone smoke scripts at repo root (`test_model.py`, `test_ort.py`) and `backend/test.py` (raw `llama_cpp` load) are manual, not part of the suite. Frontend has no automated test runner configured.

### Linting
- Frontend: `react-app` ESLint config is declared in `frontend/package.json`; there is no `lint` npm script — run `npx eslint frontend/src` if needed.
- Backend: no linter is configured in the repo.

## Notes / gotchas
- The desktop app is **Windows-first** (NSIS installer, registry-based default file-manager, `subst` tricks in `build.ps1` to keep PyInstaller paths short).
- `engine_server.py` uses **stdin/stdout JSON** — never print debug text to stdout except via `_emit_json`/`print(json...)`; logs go to **stderr**.
- `app.py` is a legacy Tkinter GUI; it is disabled (the Electron frontend is used instead) — don't revive it without intent.
- Hitting the embedding model before it's loaded returns an `Embeddings unavailable` error from `engine_server.py`; always check `model_status` first in the UI.

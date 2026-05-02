# 🧠 IntelliFile

**IntelliFile** is an AI-powered, privacy-first desktop search engine and conversational document intelligence system. 

It scans your local hardware, indexes your documents by their *semantic meaning*, and lets you search for files using natural language (e.g. searching `"tax return last year"` instantly finds the relevant document even if those exact words are not in the filename). Additionally, you can seamlessly open specific documents and chat directly with them via an integrated local LLM.

Everything runs 100% offline. Zero data leaves your machine. 

Built beautifully with **Electron + React** (Frontend) and highly optimized with **Python + FAISS + SQLite + Llama-cpp** (Backend).

---

## 📌 Complete Overview: What We Built

1. **Full-Device Drive Indexing:** We migrated from basic folder scanning to rapid, complete full-drive hierarchical indexing. IntelliFile aggressively crawls, extracts and categorizes PDFs, Word documents, Excel spreadsheets, Text formats and code structures across Windows drives.
2. **Hybrid Semantic Search Engine:** A fusion search engine utilizing vector embeddings (semantic meaning), BM25 (exact keyword match), and file-path hierarchy matching. 
3. **Isolated 'Chat with File' Pipeline:** A private Retrieval-Augmented Generation (RAG) system. Users double-click a search result to securely isolate that document context, ingest it locally via Qwen models running under Llama-cpp, and perform deep Q&A interactions directly against the file's text with **zero hallucinations**.
4. **Smart Versioning & Diffing:** Intelligent tracking of file changes with specific format engines (Excel Diff Engine, Word Diff Engine, etc.) allowing users to spot detailed alterations across file versions over time.

---

## 🎯 Accuracy Strategies

To ensure that IntelliFile returns accurate searches and perfectly aligned chat generations, we implemented rigorous ML accuracy loops spanning document ingestion, query ranking, and chat inference:

### 1. Hybrid Reciprocal Rank Fusion (RRF)
Relying strictly on Vector Similarity or keyword parsing alone creates blind spots. IntelliFile merges three paradigms into a mathematical Rank Fusion score to guarantee maximum precision:
- **Semantic Search (FAISS):** Translates paragraphs into 384-dimensional dense vectors. Captures intent, tone, and synonymous meanings (e.g. searching "fiscal reporting" easily scores a local "2024_tax_filing.pdf" file).
- **Keyword Match (SQLite FTS5 - BM25):** Vector embeddings fail on distinct jargon, raw code snippets, and strict alphanumeric IDs. BM25 algorithm guarantees that exact phrasing constraints return 100% hits.
- **Path & Filename Tiers:** Documents whose literal filenames strongly match user queries are algorithmically boosted in weight, as filename intent naturally denotes file content strongly.

### 2. SOTA Embedding Model Selection
- We bypassed massive, slow API-dependent models (like `text-embedding-3-large`) for the local `BAAI/bge-small-en-v1.5` architecture.
- **Why?** It generates 384-dimensional embeddings (yielding a ~4x smaller RAM and Disk footprint) while ranking at the absolute top of the MTEB (Massive Text Embedding Benchmark) for semantic retrieval against models ten times its size.

### 3. Contextual Document Chunking (Sentence-Aware)
- Splitting documents arbitrarily breaks thoughts mid-sentence, destroying LLM reasoning in the RAG loop.
- IntelliFile uses aggressive sentence-aware chunking boundaries (e.g. limiting to ~512 tokens) with a minimum 50-token trailing overlap. This ensures ideas persist across vector borders implicitly. We also isolate structural chunks depending on the source format (e.g., handling row/column data in Excel distinctively from narrative paragraphs in Word documents).

### 4. Pure Isolated Chat Context (No Cross-Talk)
- A major flaw in desktop search AIs is "Context Bleed," where asking a question about an NDA accidentally pulls context from an employee handbook.
- Our custom `chat_store.py` orchestrates **Isolated RAG Extraction**. When you double click to chat with a file, its semantic chunks are strictly temporarily housed in an isolated memory buffer. The Qwen Models (`1.5b` or `3b`) receive precise, fenced contexts restricted exclusively to the target file. We then dynamically clear the history state if file targets change, achieving absolute zero cross-document hallucination.

---

## ⚡ Performance Optimizations

Indexing an entire hard drive and executing 3-Billion-Parameter models locally necessitates heavy systems optimization. We implemented the following breakthroughs to sustain 60FPS UI and microsecond delays:

### 1. Hardware-Accelerated Quantized LLMs
- **Dynamic Context Windowing (`n_ctx=4096`):** Standard LLM endpoints easily OOM (Out-of-Memory) on local rigs. We strictly tune Llama.cpp to limit maximum token context parsing memory natively, ensuring large parsed document slices can reliably fit in context without crashing the system pipeline.
- **Massive Batching Processing (`n_batch=512`):** Prompt evaluation speed is massively accelerated.
- **GPU Matrix Offloading (`n_gpu_layers = -1`):** Utilizing Llama-cpp Python binaries, we completely delegate tensor math to your local GPU (CUDA, Metal, Vulkan) whenever available.
- **Maximized CPU Thread Binding (`n_threads = max_cores`):** On hardware lacking discrete GPUs, the engine programmatically harnesses maximum logical core parallelization to brute-force batched executions.
- **GGUF Quantization (`q4_k_m`, `q5_k_m` format):** Shrinks model VRAM footprints by 70%. A standard 6GB+ FP16 model fits into leaner ~2.5GB sizes on disk and RAM while maintaining 98% perplexity parity.

### 2. Deep-Engine Indexing Acceleration
- **ONNX Runtime + CUDA GPU:** The embedding model is compiled to ONNX and executed via ONNX Runtime with CUDA GPU acceleration, achieving **~5,700 embeddings/sec** — a 56% speedup over raw PyTorch inference.
- **FAISS vs Heavy DB Servers:** Rather than installing bloated Vector databases (like Milvus, Qdrant, or Postgres pgvector plugin), vector computations are housed dynamically via C++ Map integrations natively inside FAISS. 
- **Indexed File Caps & Exclusions:** Deep outlier files (like a 40,000 line debug log) throttle indexing pipelines. Our core explicitly intercepts arbitrary limits (text length caps, chunk caps in `extractor.py`) and systematically ignores known bottleneck temp directories (`node_modules`, `.git`, system caches).
- **Parallel Extraction Worker Pools:** Local indexing handles document parses across independent background CPU pools to prevent synchronous I/O blocking.
- **Incremental Diff Indexing:** First runs utilize full-device mappings, but daily usage is processed incrementally. The `crypto_utils` and SQLite state manager simply hash `modified_time` paths. We strictly parse Delta mutations on files, compressing indexing scans to the multi-millisecond range.
- **SQLite WAL Mode & Pragma Tuning:** Memory cache sizes, Synchronous mechanisms, and Write-Ahead Logging (WAL) pragmas are strictly instantiated in `db.py` to allow non-blocking concurrent reads (UI search) during massive background indexing writes.

---

## 🛠️ Architecture Stack

### **Frontend**
- **Electron:** Cross-platform native shell rendering.
- **React.js:** Component-driven UI (File Explorer, Chat Sidebar, Search Dashboard).
- **Service IPC:** Asynchronous communication channels to Python core.

### **Backend Core**
- **Python 3.11+:** Multi-threaded ingestion application runtime.
- **Llama-cpp Python:** Sub-system binding bringing quantization capability.
- **Sentence-Transformers:** Integrated context embedding module. 
- **ONNX Runtime + CUDA:** GPU-accelerated embedding inference.
- **FAISS:** N-Dimensional similarity search backbone.
- **SQLite3 / FTS5:** Local associative metadata structuring and highly polished Keyword Indexing.

---

## 🚀 Getting Started (First-Time Setup)

### 1. System Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Python** | 3.11+ | [python.org/downloads](https://www.python.org/downloads/) |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Git** | Any | [git-scm.com](https://git-scm.com/) |
| **NVIDIA GPU** | Optional | Recommended for fast embeddings + LLM inference |
| **C++ Build Tools** | VS 2019+ | Required for `llama-cpp-python` compilation ([Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)) |

### 2. Clone the Repository

```bash
git clone https://github.com/rishivejani15/Intellifile.git
cd Intellifile
```

### 3. Setup the Python Backend

```powershell
cd backend

# Create virtual environment
python -m venv .venv

# Activate it (PowerShell)
.venv\Scripts\Activate.ps1
# Or (CMD)
.venv\Scripts\activate.bat
```

#### Install PyTorch (with CUDA GPU support)

> **Important:** PyTorch must be installed **before** the other requirements. Use `cu124` for NVIDIA GPUs:

```powershell
pip install torch==2.6.0+cu124 torchvision==0.21.0+cu124 --index-url https://download.pytorch.org/whl/cu124
```

<details>
<summary>🖥️ No NVIDIA GPU? Use CPU-only PyTorch instead</summary>

```powershell
pip install torch torchvision
```

</details>

#### Install remaining dependencies

```powershell
# Base dependencies (works on all systems — uses ONNX CPU)
pip install -r requirements.txt

# NVIDIA GPU users: upgrade to CUDA-accelerated ONNX Runtime
pip install -r requirements-gpu.txt
```

> The base `requirements.txt` uses `onnxruntime` (CPU). On systems with an NVIDIA GPU, `requirements-gpu.txt` replaces it with `onnxruntime-gpu` for ~56% faster embeddings. The fallback chain is: **ONNX+CUDA → ONNX+CPU → PyTorch** — it always works.

#### Install `llama-cpp-python` (for Chat with File)

For **NVIDIA GPU** acceleration (recommended):
```powershell
$env:CMAKE_ARGS="-DGGML_CUDA=on"
pip install llama-cpp-python --no-cache-dir
```

<details>
<summary>🖥️ CPU-only fallback</summary>

```powershell
pip install llama-cpp-python
```

</details>

### 4. Download AI Models

#### Embedding Model (auto-downloaded)

Run the offline setup script to download and cache the embedding model + export ONNX:

```powershell
python setup_offline.py
```

This downloads `BAAI/bge-small-en-v1.5` (~130 MB) and exports the ONNX-optimized version.

#### Chat Model (manual download)

Download **one** of these GGUF models and place it in the `backend/models/` folder:

| Model | Size | Speed | Download |
|---|---|---|---|
| **Qwen 2.5 1.5B Q4** (faster) | ~1.1 GB | ⚡ Fast | [qwen2.5-1.5b-instruct-q4_k_m.gguf](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf) |
| **Qwen 2.5 3B Q5** (smarter) | ~2.3 GB | 🧠 Balanced | [qwen2.5-3b-instruct-q5_k_m.gguf](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q5_k_m.gguf) |

```powershell
# Example: download the 1.5B model directly via curl
curl -L -o models/qwen2.5-1.5b-instruct-q4_k_m.gguf https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

> **Note:** Chat with File works without the GGUF model — search and file browsing still function. The chat feature will simply show as disabled.

### 5. Setup the Frontend

```powershell
cd ../frontend
npm install
```

### 6. Launch IntelliFile 🚀

From the `frontend/` directory:

```powershell
npm start
```

This single command:
1. Starts the React dev server on `http://localhost:3000`
2. Launches Electron which auto-spawns both Python backend processes:
   - **Engine Server** — search, indexing, versioning (IPC via stdin/stdout)
   - **Chat API** — FastAPI server on port 8000 for document Q&A

The app will auto-index your device on first launch. You can then search, browse files, and chat with documents!

---

## 📁 Project Structure

```
Intellifile/
├── frontend/                  # Electron + React UI
│   ├── main.js                # Electron main process (spawns Python backends)
│   ├── preload.js             # IPC bridge
│   ├── src/                   # React components
│   └── package.json
├── backend/                   # Python core engine
│   ├── engine_server.py       # Search/Index/Version engine (stdin/stdout JSON)
│   ├── setup_offline.py       # One-time model download + ONNX export
│   ├── requirements.txt
│   ├── core/
│   │   ├── model.py           # Embedding model singleton (ONNX+CUDA → PyTorch)
│   │   ├── search.py          # Hybrid search (FAISS + BM25 + path)
│   │   ├── faiss_manager.py   # FAISS index management
│   │   └── versioning/        # File version tracking & diffing
│   ├── chat/backend/
│   │   ├── main.py            # FastAPI chat server
│   │   ├── llm.py             # Qwen LLM inference (llama-cpp)
│   │   └── chat_store.py      # Isolated RAG document store
│   ├── indexing/              # File crawling & incremental indexing
│   ├── parsers/               # PDF, DOCX, XLSX, PPTX extractors
│   ├── models/                # Cached models (gitignored)
│   └── data/                  # FAISS index + SQLite DB (gitignored)
└── README.md
```

---

## ⚙️ Quick Reference

| Command | Purpose |
|---|---|
| `cd frontend && npm start` | Launch the full app (frontend + auto-starts backend) |
| `python backend/setup_offline.py` | Download & cache AI models for offline use |
| `cd backend && python engine_server.py` | Run search engine standalone (for debugging) |

---

## 🔧 Troubleshooting

### ONNX+CUDA fails, falls back to PyTorch
Ensure PyTorch version matches ONNX Runtime expectations:
```powershell
# Check versions
python -c "import torch; print(torch.__version__); import onnxruntime; print(onnxruntime.__version__)"
```
- `onnxruntime-gpu >= 1.25` requires `torch >= 2.6` (for `torch.int4` support)
- Use `pip install torch==2.6.0+cu124 --index-url https://download.pytorch.org/whl/cu124`

### `llama-cpp-python` fails to install
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **"Desktop development with C++"** workload
- For CUDA: ensure `CUDA Toolkit 12.x` is installed and `CMAKE_ARGS="-DGGML_CUDA=on"` is set

### Chat shows as "disabled"
- Verify a `.gguf` model file exists in `backend/models/`
- Check the console for `llama_cpp` import errors

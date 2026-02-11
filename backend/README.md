
# IntelliFile Backend

This is the Python backend for the IntelliFile application, providing offline RAG capabilities using local LLMs.

## Prerequisites

- Python 3.10+
- A C++ compiler (for `llama-cpp-python` build)
- NVidia GPU drivers (optional, for GPU acceleration)

## Installation

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   # For CPU only:
   pip install -r requirements.txt

   # For NVIDIA GPU (cuBLAS) support:
   # You must set CMAKE_ARGS before installing llama-cpp-python
   $env:CMAKE_ARGS="-DLLAMA_CUBLAS=on"
   pip install llama-cpp-python --upgrade --force-reinstall --no-cache-dir
   pip install -r requirements.txt
   ```

## Running the Server

Run the FastAPI server from the `backend` directory:

```bash
cd backend
python main.py
```
Or using uvicorn directly:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API will be available at `http://127.0.0.1:8000`.

## API Endpoints

- `POST /ingest`: Upload a file path to process.
  - Body: `{"file_path": "C:\\path\\to\\file.pdf"}`
- `POST /chat`: Query the document context.
  - Body: `{"query": "What does the document say about X?"}`

## Structure

- `main.py`: FastAPI application entry point.
- `model.py`: Handles LLM loading (Qwen), Embeddings (all-MiniLM), and FAISS vectors.
- `processor.py`: Handles PDF text extraction and chunking logic.
- `storage.db`: SQLite database for text storage.
- `faiss_index.bin`: FAISS index file.

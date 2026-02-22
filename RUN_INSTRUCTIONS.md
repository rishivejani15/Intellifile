
# IntelliFile Run Instructions

## Prerequisites
- **Python 3.10+** installed.
- **Node.js 18+** installed.
- **Visual Studio Build Tools** (for compiling `llama-cpp-python` if needed, though prebuilt wheels exist).

## 1. Setup Backend environment

Open a terminal in `d:\Projects\IntelliFile\backend`:

```bash
cd backend
python -m venv venv
# Windows
.\venv\Scripts\activate
# Linux
source venv/bin/activate

pip install -r requirements.txt
```

## 2. Download Models

1.  **LLM Model**: Download `qwen2.5-1.5b-instruct-q4_k_m.gguf` (or similar Qwen model) and place it in `d:\Projects\IntelliFile\models`.
    -   You can find it on HuggingFace (e.g., `Qwen/Qwen2.5-3B-Instruct-GGUF`).
    -   Rename it to `qwen2.5-3b-instruct-q4_k_m.gguf` or update the command below.

2.  **Embedding Model**: The system will automatically download `all-MiniLM-L6-v2` on first run.

## 3. Start the Local LLM Server

We run the LLM heavily optimized in a separate process.
Open a NEW terminal:

```bash
cd backend
.\venv\Scripts\activate
# Adjust --model_path if your filename differs
python -m llama_cpp.server --model_path ../models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080
```

Keep this terminal running.

## 4. Run the Application

Open a NEW terminal in `d:\Projects\IntelliFile`:

```bash
npm install
npm run start
```

This will:
1.  Start the Electron app.
2.  Electron will automatically start the Python backend (on port 8001).
3.  The backend connects to the LLM Server (port 8080).

## 5. Usage (Dummy Test)

1.  **Create a Dummy File**: Create a file `test_doc.txt` with content:
    ```
    IntelliFile is a local RAG chatbot system designed for privacy and speed.
    It uses FAISS for vector storage and Qwen-3B for answering questions.
    The primary developer is Antigravity.
    Steps to use:
    1. Upload a document.
    2. Wait for indexing.
    3. Ask a question.
    ```
2.  **Upload**: Click the Paperclip icon in the app and select `test_doc.txt`.
3.  **Wait**: You should see "I've loaded the document...".
4.  **Ask**: "What is IntelliFile?" or "Who is the developer?".
5.  **Verify**: The answer should cite the document.

## Troubleshooting

-   **Backend Fails to Start**: Check `backend/backend.log` if implemented, or seeing the Electron console output.
-   **LLM Error**: Ensure the LLM server is running on port 8080.
-   **Missing Modules**: Ensure you activated the venv before installing requirements.

import asyncio
import hashlib
import logging
import os
import sys
from typing import Any, Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Ensure backend package root is importable from this nested package.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from core.faiss_manager import invalidate_cache, load_index
from .chat_store import get_chat_index_size, reset_chat_store
from core.versioning.rollback_manager import restore_version
from core.versioning.snapshot_manager import compare_versions, list_versions
from core.versioning.version_engine import VersionEngine
from indexing.single_file_ingest import reset_canonical_index_store
from .llm import chat, ingest_file, init_models, is_chat_model_loaded, get_chat_status
from .models import ChatQueryRequest, ChatResponse, IngestResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("IntelliFile")

app = FastAPI(title="IntelliFile Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from core.paths import get_data_dir

DATA_DIR = get_data_dir()
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class CompareVersionsRequest(BaseModel):
    file_path: str
    version_a: str
    version_b: str


class RestoreVersionRequest(BaseModel):
    file_path: str
    version_id: str


class UploadPathRequest(BaseModel):
    file_path: str


@app.on_event("startup")
async def startup_event():
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, init_models)
    logger.info("LLM initialization started in background.")


@app.get("/health")
async def health_check():
    idx = load_index()
    index_size = idx.ntotal if idx is not None else 0
    chat_status = get_chat_status()
    return {
        "status": "ok",
        "chat_model": "loaded" if is_chat_model_loaded() else "not_loaded",
        "chat_enabled": bool(chat_status.get("enabled")),
        "chat_mode": chat_status.get("mode"),
        "chat_lock_reason": chat_status.get("reason", ""),
        "faiss_index_size": int(index_size),
        "chat_index_size": int(get_chat_index_size()),
    }


@app.get("/chat/status")
async def chat_status():
    return get_chat_status()


@app.post("/download_model")
async def download_model():
    # Canonical embedding model is loaded by backend/core/model.py.
    return {
        "status": "success",
        "message": "Canonical embedding model is managed by core/model.py and loads automatically.",
    }


@app.post("/refresh_index")
async def refresh_index():
    invalidate_cache()
    idx = load_index(force_reload=True)
    return {"ok": True, "size": int(idx.ntotal) if idx is not None else 0}


@app.post("/reset")
async def reset_index():
    try:
        reset_result = reset_canonical_index_store()
        if os.path.isdir(UPLOAD_DIR):
            for name in os.listdir(UPLOAD_DIR):
                path = os.path.join(UPLOAD_DIR, name)
                if os.path.isfile(path):
                    os.remove(path)
        logger.info("Canonical store and upload cache reset.")
        return reset_result
    except Exception as e:
        logger.error("Failed to reset index: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/reset")
async def reset_chat_index():
    try:
        reset_result = reset_chat_store()
        return reset_result
    except Exception as e:
        logger.error("Failed to reset chat index: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


def _snapshot_uploaded_file(file_path: str) -> Dict[str, Any]:
    engine = VersionEngine()
    format_type = engine.detect_format(file_path)

    old_content: Any = ""
    versions = list_versions(file_path)
    if versions:
        # Let process_and_save handle fallback logic for missing structure files.
        old_content = ""

    if format_type == "text":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            new_content: Any = f.read()
    else:
        # For binary format handlers, version engine expects a path.
        new_content = file_path

    return engine.process_and_save(file_path, old_content, new_content)


@app.post("/upload", response_model=IngestResponse)
async def upload_document(file: UploadFile = File(...), clear_previous: bool = Form(False)):
    filename = file.filename or "uploaded_file"
    safe_filename = "".join([c for c in filename if c.isalnum() or c in "._- "]) or "uploaded_file"

    if clear_previous:
        try:
            reset_chat_store()
            logger.info("Cleared chat knowledge base before upload.")
        except Exception as e:
            logger.error("Failed to clear previous data: %s", e)
            raise HTTPException(status_code=500, detail="Failed to clear previous data")

    try:
        payload = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload: {e}")

    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_hash = hashlib.sha256(payload).hexdigest()[:16]
    file_path = os.path.join(UPLOAD_DIR, f"{file_hash}_{safe_filename}")

    if not os.path.exists(file_path):
        with open(file_path, "wb") as buffer:
            buffer.write(payload)
    else:
        # Keep dedup stable by preserving mtime for byte-identical files.
        logger.info("Upload dedup hit for %s", file_path)

    try:
        ingest_result = ingest_file(file_path)
    except Exception as e:
        logger.error("Ingestion failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {e}")

    try:
        version_meta = _snapshot_uploaded_file(file_path)
        logger.info("Version snapshot created: %s", version_meta.get("version_id"))
    except Exception as e:
        logger.warning("Version snapshot skipped due to error: %s", e)

    return IngestResponse(
        ok=True,
        doc_id=file_hash,
        filename=safe_filename,
        pages=1,
        chunks_indexed=int(ingest_result.get("new_chunks", 0)),
    )


@app.post("/chat/ingest")
async def chat_ingest_document(request: UploadPathRequest):
    """Isolated ingest for chat only, avoiding version snapshotting."""
    file_path = request.file_path
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=400, detail="Invalid file path")

    try:
        ingest_result = ingest_file(file_path)
    except Exception as e:
        logger.error("Chat path ingestion failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {e}")

    return {
        "ok": True,
        "path": file_path,
        "filename": os.path.basename(file_path),
        "chunks_indexed": int(ingest_result.get("new_chunks", 0)),
        "status": ingest_result.get("status"),
        "ingest_ms": ingest_result.get("ingest_ms", 0),
    }


@app.post("/upload_path")
async def upload_document_by_path(request: UploadPathRequest):
    file_path = request.file_path
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=400, detail="Invalid file path")

    try:
        ingest_result = ingest_file(file_path)
    except Exception as e:
        logger.error("Path ingestion failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {e}")

    try:
        version_meta = _snapshot_uploaded_file(file_path)
        logger.info("Version snapshot created: %s", version_meta.get("version_id"))
    except Exception as e:
        logger.warning("Version snapshot skipped due to error: %s", e)

    return {
        "ok": True,
        "path": file_path,
        "filename": os.path.basename(file_path),
        "chunks_indexed": int(ingest_result.get("new_chunks", 0)),
        "status": ingest_result.get("status"),
    }


@app.post("/ask", response_model=ChatResponse)
async def ask_question(request: ChatQueryRequest):
    answer_parts = list(chat(request.query, chunks=None, stream=False))
    answer = "".join(answer_parts).strip()
    if not answer:
        answer = "I could not generate an answer."
    return ChatResponse(ok=True, answer=answer, sources=[])


@app.post("/chat")
async def chat_endpoint(request: ChatQueryRequest):
    return StreamingResponse(chat(request.query, chunks=None, stream=True), media_type="text/plain")


@app.get("/versions")
async def get_versions(file_path: str):
    try:
        return {"ok": True, "versions": list_versions(file_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/versions/compare")
async def compare_versions_endpoint(request: CompareVersionsRequest):
    try:
        result = compare_versions(request.file_path, request.version_a, request.version_b)
        return {"ok": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/versions/restore")
async def restore_version_endpoint(request: RestoreVersionRequest):
    try:
        result = restore_version(request.file_path, request.version_id)
        if result.get("success"):
            # Re-index restored file so chat context remains in sync.
            ingest_file(request.file_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
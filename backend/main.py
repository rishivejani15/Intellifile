
import os
import shutil
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any
import uuid
from datetime import datetime
import numpy as np

# Internal modules
from storage.sqlite_store import SQLiteStore
from storage.faiss_index import FaissIndex
from storage.models import ChunkMetadata, QueryResponse, SearchResult, IngestResponse, ChatQueryRequest
from processing.pdf_extract import PDFExtractor
from processing.chunking import TextChunker

# -----------------
# EMBEDDING & LLM
# -----------------
from sentence_transformers import SentenceTransformer
# We will use llama_cpp for local LLM (Qwen)
try:
    from llama_cpp import Llama
    HAS_LLAMA = True
except ImportError:
    HAS_LLAMA = False

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="IntelliFile Backend")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
DATA_DIR = "data"
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# Components
sqlite_store = SQLiteStore()

# Global Model Instances
embedding_model = None
llm_model = None
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
embedding_dim = 384
faiss_index = None

@app.on_event("startup")
async def startup_event():
    global embedding_model, embedding_dim, faiss_index, llm_model
    
    # 1. Load Embedding Model
    logger.info(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
    try:
        embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        # Determine dim
        test_vec = embedding_model.encode(["test"], convert_to_numpy=True)
        embedding_dim = test_vec.shape[1]
        logger.info(f"Embedding Model loaded. Dimension: {embedding_dim}")
    except Exception as e:
        logger.error(f"Failed to load embedding model: {e}")
    
    # 2. Initialize FAISS
    faiss_index = FaissIndex(dim=embedding_dim)

    # 3. Load Local LLM (Qwen) if available
    llm_path = os.path.join(MODELS_DIR, "qwen2.5-3b-instruct-q4_k_m.gguf")
    # For now, we look for any .gguf in models if specific one missing? No, user specified structure.
    # Actually, user's models folder is d:\Projects\IntelliFile\models
    # Our backend is d:\Projects\IntelliFile\backend
    # So MODELS_DIR calculated above should be correct (../models)
    
    if HAS_LLAMA:
        if os.path.exists(llm_path):
            logger.info(f"Loading LLM from {llm_path}...")
            try:
                # n_ctx should be large enough for context
                llm_model = Llama(model_path=llm_path, n_ctx=2048, n_gpu_layers=0, verbose=False)
                logger.info("LLM loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load LLM: {e}")
        else:
            logger.warning(f"LLM model not found at {llm_path}. RAG will default to 'I don't know'.")
    else:
        logger.warning("llama-cpp-python not installed. RAG disabled.")


# -------------------------------------------------------------
# HELPERS
# -------------------------------------------------------------

def get_embeddings_internal(texts: List[str]) -> Optional[np.ndarray]:
    if embedding_model is None:
        logger.error("Embedding model not loaded.")
        return None
    try:
        embeddings = embedding_model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        return embeddings
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        return None

def generate_rag_answer(query: str, context: List[str]) -> str:
    if not context:
        return "I don't have enough information to answer that question."
    
    if not llm_model:
        return "Local LLM is not loaded. I retrieved documents but cannot generate an answer."

    # Construct Prompt for Qwen
    # Qwen uses ChatML format
    # <|im_start|>system
    # ...<|im_end|>
    # <|im_start|>user
    # ...<|im_end|>
    # <|im_start|>assistant
    
    system_msg = (
        "You are a helpful AI assistant called IntelliFile. "
        "Your task is to answer the user's question using ONLY the provided context below. "
        "If the answer is not in the context, strictly state that you don't know."
    )
    
    context_str = "\n".join([f"[Context {i+1}]: {chunk}" for i, chunk in enumerate(context)])
    
    user_msg = f"Context:\n{context_str}\n\nQuestion: {query}"
    
    # Debug log context length
    logger.info(f"RAG Context Length: {len(context_str)} chars from {len(context)} chunks.")

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_msg}
    ]
    
    try:
        output = llm_model.create_chat_completion(
            messages=messages,
            max_tokens=512,
            temperature=0.3
        )
        return output['choices'][0]['message']['content'].strip()
    except Exception as e:
        logger.error(f"LLM generation failed: {e}")
        return "Error generating answer from LLM."

# -------------------------------------------------------------
# API ENDPOINTS
# -------------------------------------------------------------

@app.post("/ingest_pdf", response_model=IngestResponse)
async def ingest_pdf(file: UploadFile = File(...)):
    doc_id = str(uuid.uuid4())
    filename = file.filename
    safe_filename = "".join([c for c in filename if c.isalpha() or c.isdigit() or c in "._-"])
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_filename}")
    
    logger.info(f"Ingesting: {filename}")

    # Save
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Extract
    try:
        pages = PDFExtractor.extract_from_file(file_path)
        logger.info(f"Extracted {len(pages)} pages.")
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF: {e}")

    # Chunk
    all_chunks_metadata = []
    chunk_texts = []
    
    for page_num, text in pages:
        chunks = TextChunker.chunk_text(text)
        for i, chunk_text in enumerate(chunks):
            meta = ChunkMetadata(
                doc_id=doc_id, 
                source_name=filename, 
                page=page_num, 
                chunk_index=i, 
                text=chunk_text, 
                created_at=datetime.utcnow().isoformat()
            )
            all_chunks_metadata.append(meta)
            chunk_texts.append(chunk_text)
    
    logger.info(f"Created {len(chunk_texts)} chunks.")

    if not chunk_texts:
        return IngestResponse(ok=True, doc_id=doc_id, filename=filename, pages=len(pages), chunks_indexed=0)

    # DB Insert
    try:
        ids = sqlite_store.insert_chunks(all_chunks_metadata)
    except Exception as e:
        logger.error(f"DB Insert failed: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    # Embed & Index
    batch_size = 64
    total_vectors = []
    
    for i in range(0, len(chunk_texts), batch_size):
        batch = chunk_texts[i : i+batch_size]
        try:
            embs = get_embeddings_internal(batch)
            if embs is not None:
                total_vectors.append(embs)
            else:
                logger.error("Embedding batch returned None")
        except Exception as e:
            logger.error(f"Embedding batch exception: {e}")
            
    if total_vectors:
        all_vectors = np.vstack(total_vectors)
        logger.info(f"Generated {len(all_vectors)} vectors.")
        
        # Add to FAISS
        # Truncate to align with IDs if some chunks failed embedding (simplified)
        count = min(len(all_vectors), len(ids))
        if count > 0:
            try:
                faiss_index.add_vectors(all_vectors[:count], np.array(ids[:count]))
                logger.info(f"Indexed {count} vectors.")
            except Exception as e:
                logger.error(f"FAISS add failed: {e}")
                raise HTTPException(status_code=500, detail="Indexing error")

    return IngestResponse(
        ok=True, 
        doc_id=doc_id, 
        filename=filename, 
        pages=len(pages), 
        chunks_indexed=len(ids)
    )

@app.post("/query", response_model=QueryResponse)
async def query_index(request: ChatQueryRequest):
    query = request.query
    k = request.k
    doc_id = request.doc_id
    
    logger.info(f"Querying: {query} (filter doc_id={doc_id})")

    # Embed
    q_vec = get_embeddings_internal([query])
    if q_vec is None or len(q_vec) == 0:
         raise HTTPException(status_code=500, detail="Embedding failed")
    q_vec = q_vec[0]

    # Search
    scores, ids = faiss_index.search(q_vec, k=k*5)
    
    valid = [(ids[i], scores[i]) for i in range(len(ids)) if ids[i] != -1]
    
    if not valid:
        logger.info("No matches found in FAISS.")
        return QueryResponse(results=[])

    valid_ids = [int(v[0]) for v in valid]
    valid_scores = [float(v[1]) for v in valid]
    
    logger.info(f"Faiss returned IDs: {valid_ids}")

    # Retrieve
    chunks = sqlite_store.get_chunks(valid_ids)
    chunk_map = {c.id: c for c in chunks}
    
    logger.info(f"SQLite returned {len(chunk_map)} chunks for IDs: {list(chunk_map.keys())}")
    
    results = []
    for chunk_id, score in zip(valid_ids, valid_scores):
        if chunk_id in chunk_map:
            c = chunk_map[chunk_id]
            if doc_id and c.doc_id != doc_id:
                continue
            
            results.append(SearchResult(
                score=float(score),
                doc_id=c.doc_id,
                source=c.source_name,
                page=c.page,
                chunk_index=c.chunk_index,
                text=c.text
            ))
            if len(results) >= k:
                break
    
    logger.info(f"Found {len(results)} relevant chunks.")
    return QueryResponse(results=results)

@app.post("/answer")
async def answer_question(request: ChatQueryRequest):
    # 1. Retrieve
    q_resp = await query_index(request)
    context_chunks = [r.text for r in q_resp.results]
    
    # 2. Generate
    logger.info("Generating answer with LLM...")
    answer = generate_rag_answer(request.query, context_chunks)
    logger.info(f"Answer generated: {answer[:50]}...")
    
    return {
        "ok": True,
        "answer": answer,
        "sources": q_resp.results
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


import os
import shutil
import logging
import json
import requests
from typing import List, Optional
import numpy as np
import uuid
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer

# Internal modules
from processing.file_extract import FileExtractor
from processing.chunking import TextChunker
from storage.sqlite_store import SQLiteStore
from storage.faiss_index import FaissIndex
from models import (
    ChunkMetadata, IngestResponse, QueryResponse, SearchResult, ChatQueryRequest, ChatResponse
)
from llm import init_models, chat, is_chat_model_loaded

# Configuration
# Users can override these via environment variables or hardcoded defaults
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
LLAMA_CPP_ENDPOINT = os.getenv("LLAMA_CPP_ENDPOINT", "http://127.0.0.1:8080/v1/chat/completions")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 100))
TOP_K = int(os.getenv("TOP_K", 3))

# Setup Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("IntelliFile")

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
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Components
sqlite_store = SQLiteStore()
# Initialize FAISS index
# We load dimension dynamically or default to 384 for MiniLM
embedding_model = None
faiss_index = None

@app.on_event("startup")
async def startup_event():
    global embedding_model, faiss_index
    
    # Initialize LLM models in background to avoid blocking startup
    import asyncio
    loop = asyncio.get_running_loop()
    # Run heavy initialization in executor 
    loop.run_in_executor(None, init_models)
    logger.info("LLM initialization started in background.")

    logger.info(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
    try:
        # Try loading locally first
        embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME, local_files_only=True)
        # Determine dimension
        dummy_vec = embedding_model.encode(["test"], convert_to_numpy=True)
        dim = dummy_vec.shape[1]
        logger.info(f"Embedding Model loaded locally. Dimension: {dim}")
        
        # Initialize FAISS
        faiss_index = FaissIndex(dim=dim)
        logger.info(f"FAISS Index initialized with {faiss_index.index.ntotal} vectors.")
        
    except Exception as e:
        logger.warning(f"Model not found locally or error loading: {e}. Waiting for manual download.")
        embedding_model = None
        faiss_index = None

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "embedding_model": "loaded" if embedding_model else "not_loaded",
        "chat_model": "loaded" if is_chat_model_loaded() else "not_loaded",
        "faiss_index_size": faiss_index.index.ntotal if faiss_index else 0,
        "llm_endpoint": LLAMA_CPP_ENDPOINT
    }

@app.post("/download_model")
async def download_model():
    global embedding_model, faiss_index
    try:
        logger.info(f"Downloading/Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME) # This will download if not in cache
        
        dummy_vec = embedding_model.encode(["test"], convert_to_numpy=True)
        dim = dummy_vec.shape[1]
        logger.info(f"Embedding Model downloaded and loaded. Dimension: {dim}")
        
        faiss_index = FaissIndex(dim=dim)
        logger.info(f"FAISS Index initialized with {faiss_index.index.ntotal} vectors.")
        
        return {"status": "success", "message": "Model downloaded and loaded"}
    except Exception as e:
        logger.error(f"Failed to download model: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/refresh_index")
async def refresh_index():
    global faiss_index
    if not embedding_model:
        raise HTTPException(status_code=503, detail="Model not loaded")
        
    try:
        if faiss_index:
            # We re-initialize to reload from disk
            dummy_vec = embedding_model.encode(["test"], convert_to_numpy=True)
            dim = dummy_vec.shape[1]
            faiss_index = FaissIndex(dim=dim)
        else:
            # First time init if somehow missed
            dummy_vec = embedding_model.encode(["test"], convert_to_numpy=True)
            dim = dummy_vec.shape[1]
            faiss_index = FaissIndex(dim=dim) 
        
        logger.info(f"Index refreshed. New size: {faiss_index.index.ntotal}")
        return {"ok": True, "size": faiss_index.index.ntotal}
    except Exception as e:
        logger.error(f"Failed to refresh index: {e}")
        raise HTTPException(status_code=500, detail=str(e))

        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reset")
async def reset_index():
    global faiss_index
    if not sqlite_store or not faiss_index:
        raise HTTPException(status_code=503, detail="System not initialized")
        
    try:
        sqlite_store.clear()
        faiss_index.clear()
        logger.info("Index and database cleared.")
        return {"status": "success", "message": "Knowledge base cleared."}
    except Exception as e:
        logger.error(f"Failed to reset index: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload", response_model=IngestResponse)
async def upload_document(file: UploadFile = File(...), clear_previous: bool = Form(False)):
    if not embedding_model or not faiss_index:
        raise HTTPException(status_code=503, detail="System not initialized")

    doc_id = str(uuid.uuid4())
    filename = file.filename
    safe_filename = "".join([c for c in filename if c.isalnum() or c in "._- "])
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_filename}")
    
    logger.info(f"Receiving file: {filename}")

    if clear_previous:
        try:
            sqlite_store.clear()
            faiss_index.clear()
            logger.info("Cleared previous data before upload.")
        except Exception as e:
            logger.error(f"Failed to clear previous data: {e}")
            raise HTTPException(status_code=500, detail="Failed to clear previous data")

    # 1. Save File
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # 2. Extract Text
    try:
        pages = FileExtractor.extract(file_path)
        logger.info(f"Extracted {len(pages)} sections/pages from {filename}")
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to extract text: {e}")

    if not pages:
        return IngestResponse(ok=True, doc_id=doc_id, filename=filename, pages=0, chunks_indexed=0)

    # 3. Chunk
    chunk_texts = []
    chunk_metas = []
    
    for page_num, text in pages:
        chunks = TextChunker.chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
        for i, chunk_text in enumerate(chunks):
            chunk_texts.append(chunk_text)
            chunk_metas.append(ChunkMetadata(
                doc_id=doc_id,
                source_name=filename,
                page=page_num,
                chunk_index=i,
                text=chunk_text,
                created_at=datetime.utcnow().isoformat()
            ))

    if not chunk_texts:
        return IngestResponse(ok=True, doc_id=doc_id, filename=filename, pages=len(pages), chunks_indexed=0)
    
    logger.info(f"Created {len(chunk_texts)} chunks.")

    # 4. Embed
    try:
        embeddings = embedding_model.encode(chunk_texts, convert_to_numpy=True, normalize_embeddings=True, batch_size=64)
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        raise HTTPException(status_code=500, detail=f"Embedding error: {e}")

    # 5. Store Metadata (SQLite) & Vectors (FAISS)
    try:
        ids = sqlite_store.insert_chunks(chunk_metas)
        faiss_index.add_vectors(embeddings, np.array(ids))
        logger.info(f"Indexed {len(ids)} chunks for {filename}")
    except Exception as e:
        logger.error(f"Indexing failed: {e}")
        raise HTTPException(status_code=500, detail="Database/Index error")

    return IngestResponse(
        ok=True,
        doc_id=doc_id,
        filename=filename,
        pages=len(pages),
        chunks_indexed=len(ids)
    )

@app.post("/ask", response_model=ChatResponse)
async def ask_question(request: ChatQueryRequest):
    if not embedding_model or not faiss_index:
        raise HTTPException(status_code=503, detail="System not initialized")

    query = request.query
    k = request.top_k
    
    logger.info(f"Question: {query}")

    is_summary = "summar" in query.lower() or "overview" in query.lower()

    # 1. Embed Query
    try:
        q_vec = embedding_model.encode([query], convert_to_numpy=True, normalize_embeddings=True)[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding error: {e}")

    # 2. Retrieve (Search)
    # Fetch more for summarization to get broader context
    search_k = 10 if is_summary else k * 2
    
    dists, ids = faiss_index.search(q_vec, k=search_k)
    
    # Filter invalid IDs (-1)
    valid_indices = [i for i, id_val in enumerate(ids) if id_val != -1]
    valid_ids = [ids[i] for i in valid_indices]
    valid_scores = [dists[i] for i in valid_indices]
    
    if not valid_ids:
        return ChatResponse(ok=True, answer="I couldn't find any relevant information in the uploaded documents.", sources=[])

    # 3. Fetch Metadata
    chunks = sqlite_store.get_chunks([int(i) for i in valid_ids])
    chunk_map = {c.id: c for c in chunks}
    
    # 4. Rerank / Filter
    results = []
    seen_texts = set()
    
    target_k = 5 if is_summary else k

    for i, cid in enumerate(valid_ids):
        if cid not in chunk_map:
            continue
        
        c = chunk_map[cid]
        # De-duplication based on text prefix
        signature = c.text[:50]
        if signature in seen_texts:
            continue
        seen_texts.add(signature)
        
        results.append(SearchResult(
            score=float(valid_scores[i]),
            doc_id=c.doc_id,
            source=c.source_name,
            page=c.page,
            chunk_index=c.chunk_index,
            text=c.text
        ))
        
        if len(results) >= target_k:
            break
            
    # 5. Construct Prompt
    context_str = ""
    citations = []
    for i, r in enumerate(results):
        context_str += f"[Source {i+1}]: {r.text}\n[Citation]: {r.source}, Page {r.page}\n\n"
        citations.append(r)
        
    if is_summary:
        system_prompt = (
            "You are an intelligent assistant. Your task is to generate a comprehensive summary based on the provided context.\n"
            "Synthesize the information from the sources into a structured response (e.g., Key Points, Conclusion).\n"
            "If the context is partial, summarize what is available. Do strictly refuse to answer unless the context is completely irrelevant.\n"
            "Cite your sources using [Source X]."
        )
    else:
        system_prompt = (
            "You are a helpful AI assistant. Your task is to answer the user's question using ONLY the provided context.\n"
            "If you cannot find the answer in the context, say 'I couldn't find this in the uploaded document(s).'\n"
            "Do not use outside knowledge. Keep answers concise unless asked to summarize.\n"
            "Always cite your sources using [Source X] notation where appropriate."
        )
    
    user_prompt = f"Context:\n{context_str}\n\nQuestion: {query}"
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    # 6. Call LLM
    try:
        # We expect a local OpenAI-compatible server
        resp = requests.post(
            LLAMA_CPP_ENDPOINT,
            json={
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 400 if is_summary else 300,
                "top_p": 0.9,
                "stream": False 
            },
            timeout=120 # Timeout for long generation
        )
        
        if resp.status_code == 200:
            llm_output = resp.json()
            answer = llm_output['choices'][0]['message']['content']
        else:
            logger.error(f"LLM Error {resp.status_code}: {resp.text}")
            answer = "Error: Could not retrieve answer from LLM server."
            
    except Exception as e:
        logger.error(f"LLM connection failure: {e}")
        answer = "Error: LLM server is unreachable. Please ensure llama.cpp server is running."

    return ChatResponse(
        ok=True,
        answer=answer,
        sources=citations
    )

@app.post("/chat")
async def chat_endpoint(request: ChatQueryRequest):
    query = request.query
    relevant_chunks = None

    if embedding_model and faiss_index and faiss_index.index.ntotal > 0:
        try:
            # 1. Embed Query
            q_vec = embedding_model.encode([query], convert_to_numpy=True, normalize_embeddings=True)[0]
            
            # Determine K based on query type
            is_summary = "summar" in query.lower() or "overview" in query.lower()
            search_k = 6 if is_summary else 3

            # 2. Search Index via FaissIndex wrapper
            dists, ids = faiss_index.search(q_vec, k=search_k)
            
            # 3. Filter invalid IDs
            valid_indices = [i for i, id_val in enumerate(ids) if id_val != -1]
            valid_ids = [ids[i] for i in valid_indices]
            valid_dists = [dists[i] for i in valid_indices]
            
            if valid_ids:
                # 4. Fetch Text from SQLite
                chunks = sqlite_store.get_chunks([int(i) for i in valid_ids])
                chunk_map = {c.id: c.text for c in chunks}
                
                relevant_chunks = []
                # Preserve order from FAISS search (best match first)
                for i, cid in enumerate(valid_ids):
                    if cid in chunk_map:
                        relevant_chunks.append((chunk_map[cid], float(valid_dists[i])))
                
                logger.info(f"Retrieved {len(relevant_chunks)} chunks from in-memory index for chat.")
        except Exception as e:
            logger.error(f"Retrieval error in chat: {e}")

    return StreamingResponse(chat(query, chunks=relevant_chunks, stream=True), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

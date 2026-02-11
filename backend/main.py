
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import os
import logging

from model import ChatEngine
from processor import Processor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Allow CORS for Electron app (usually localhost or file://)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development allowing all is usually fine, specific origin is better for prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Core Components
# Note: These are singletons where appropriate (FAISSManager, EmbeddingModel, QwenLLM)
try:
    processor = Processor()
    chat_engine = ChatEngine()
    logger.info("Backend initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize backend: {e}")
    # We don't exit here to allow debugging, but endpoints might fail

# Pydantic Models
class IngestRequest(BaseModel):
    file_path: str

class ChatRequest(BaseModel):
    query: str

class ChatResponse(BaseModel):
    response: str
    context: List[str]

@app.get("/")
def health_check():
    return {"status": "ok", "message": "IntelliFile Backend is running"}

@app.post("/ingest")
async def ingest_document(request: IngestRequest):
    """
    Ingest a PDF file from a local path.
    """
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=400, detail=f"File not found: {request.file_path}")
    
    try:
        # Check if it's a PDF
        if not request.file_path.lower().endswith('.pdf'):
             raise HTTPException(status_code=400, detail="Only PDF files are supported currently.")

        logger.info(f"Received ingest request for: {request.file_path}")
        num_chunks = processor.process_pdf(request.file_path)
        
        return {
            "status": "success", 
            "message": f"Successfully processed {os.path.basename(request.file_path)}",
            "chunks_count": num_chunks
        }
    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat with the ingested documents.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    try:
        logger.info(f"Received chat query: {request.query}")
        
        # Define retrieval callback
        def retrieve_context(ids: List[int]) -> List[str]:
            return processor.get_chunks_by_ids(ids)
            
        result = chat_engine.query(request.query, retrieve_context)
        
        return ChatResponse(
            response=result["response"],
            context=result["context"]
        )
    except Exception as e:
        logger.error(f"Chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # Host on 127.0.0.1 to be accessible by Electron
    uvicorn.run(app, host="127.0.0.1", port=8000)

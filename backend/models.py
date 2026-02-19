
from pydantic import BaseModel, Field
from typing import List, Optional, Any

class ChunkMetadata(BaseModel):
    id: Optional[int] = None
    doc_id: str
    source_name: str
    page: int
    chunk_index: int
    text: str
    created_at: str

class IngestResponse(BaseModel):
    ok: bool
    doc_id: str
    filename: str
    pages: int
    chunks_indexed: int

class SearchResult(BaseModel):
    score: float
    doc_id: str
    source: str
    page: int
    chunk_index: int
    text: str

class QueryResponse(BaseModel):
    results: List[SearchResult]

class ChatQueryRequest(BaseModel):
    query: str
    top_k: int = 5
    doc_id: Optional[str] = None # Filter by doc_id if needed
    rerank: bool = True

class ChatResponse(BaseModel):
    ok: bool
    answer: str
    sources: List[SearchResult]

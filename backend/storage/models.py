
from pydantic import BaseModel, Field
from typing import List, Optional, Any

class ChunkMetadata(BaseModel):
    id: Optional[int] = None
    doc_id: str
    source_name: str
    page: int
    chunk_index: int
    text: str
    created_at: str  # ISO format

class IngestResponse(BaseModel):
    ok: bool = True
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
    ok: bool = True
    results: List[SearchResult]

class AnswerResponse(BaseModel):
    ok: bool = True
    answer: str
    sources: List[SearchResult]

class EmbeddingRequest(BaseModel):
    input: List[str]
    model: str = "default"

class EmbeddingResponseData(BaseModel):
    embedding: List[float]
    index: int
    object: str = "embedding"

class EmbeddingResponse(BaseModel):
    data: List[EmbeddingResponseData]
    model: str
    object: str = "list"
    usage: Any = {}
    
class ChatQueryRequest(BaseModel):
    query: str
    k: int = 5
    doc_id: Optional[str] = None

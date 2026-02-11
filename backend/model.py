
import os
import json
import logging
import numpy as np
import faiss
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
from llama_cpp import Llama

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(os.path.dirname(BASE_DIR), "models")  # Assuming models are in ../models relative to backend
INDEX_FILE = os.path.join(BASE_DIR, "faiss_index.bin")

# Ensure models directory exists
if not os.path.exists(MODELS_DIR):
    os.makedirs(MODELS_DIR, exist_ok=True)

class EmbeddingModel:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingModel, cls).__new__(cls)
            logger.info("Loading Embedding Model...")
            # Using all-MiniLM-L6-v2 as requested for speed
            cls._instance.model = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("Embedding Model loaded.")
        return cls._instance

    def encode(self, texts: List[str]) -> np.ndarray:
        return self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)

class QwenLLM:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(QwenLLM, cls).__new__(cls)
            model_path = os.path.join(MODELS_DIR, "qwen2.5-3b-instruct-q4_k_m.gguf")
            
            if not os.path.exists(model_path):
                logger.warning(f"Model file not found at {model_path}. Please download it.")
                # We can't proceed without the model, but we'll let the constructor finish so the app doesn't crash immediately 
                # (though it will fail on generation).
                cls._instance.llm = None
                return cls._instance

            logger.info(f"Loading LLM from {model_path}...")
            # n_gpu_layers=-1 attempts to offload all layers to GPU (cublas/metal)
            # n_ctx=4096 is a reasonable context window for RAG
            cls._instance.llm = Llama(
                model_path=model_path,
                n_gpu_layers=0, 
                n_ctx=2048,
                verbose=True
            )
            logger.info("LLM loaded.")
        return cls._instance

    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        if not self.llm:
            return "Error: LLM model file not found."
            
        output = self.llm(
            prompt,
            max_tokens=max_tokens,
            stop=["<|im_end|>"],
            echo=False,
            temperature=0.7
        )
        return output['choices'][0]['text']

class FAISSManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FAISSManager, cls).__new__(cls)
            cls._instance.index = None
            cls._instance.dimension = 384  # Dimension for all-MiniLM-L6-v2
            cls._instance.load_index()
        return cls._instance

    def load_index(self):
        if os.path.exists(INDEX_FILE):
            try:
                self.index = faiss.read_index(INDEX_FILE)
                logger.info(f"Loaded FAISS index from {INDEX_FILE}. Size: {self.index.ntotal}")
            except Exception as e:
                logger.error(f"Failed to load FAISS index: {e}")
                self._create_new_index()
        else:
            self._create_new_index()

    def _create_new_index(self):
        logger.info("Creating new FAISS index.")
        # IndexFlatIP for cosine similarity (inner product on normalized vectors)
        quantizer = faiss.IndexFlatIP(self.dimension)
        # IndexIDMap to map vectors to arbitrary IDs (our SQLite row IDs)
        self.index = faiss.IndexIDMap(quantizer)

    def save_index(self):
        if self.index:
            faiss.write_index(self.index, INDEX_FILE)
            logger.info(f"Saved FAISS index to {INDEX_FILE}")

    def add_vectors(self, vectors: np.ndarray, ids: np.ndarray):
        if self.index is None:
            self._create_new_index()
        
        # FAISS expects float32
        vectors = vectors.astype('float32')
        ids = ids.astype('int64')
        
        self.index.add_with_ids(vectors, ids)
        self.save_index()

    def search(self, query_vector: np.ndarray, k: int = 5):
        if not self.index or self.index.ntotal == 0:
            return [], []
        
        query_vector = query_vector.astype('float32').reshape(1, -1)
        distances, indices = self.index.search(query_vector, k)
        return distances[0], indices[0]

class ChatEngine:
    def __init__(self):
        self.llm = QwenLLM()
        self.embedder = EmbeddingModel()
        self.faiss_manager = FAISSManager()
        # We need access to the database to retrieve text, but avoiding circular import.
        # We'll expect the caller or a helper to fetch text by ID.
        # But for strictly following "Chat Engine... retrieves... from SQLite", we might need a DB helper here.
        # I will inject a `user_context_retriever` function or pass it in `query`.
    
    def construct_prompt(self, query: str, context_chunks: List[str]) -> str:
        # Qwen 2.5 format: <|im_start|>system...<|im_end|><|im_start|>user...<|im_end|>
        
        system_msg = (
            "You are a helpful and precise assistant. "
            "Use the provided Context to answer the User's question. "
            "If the answer is not found in the context, state that you don't know."
        )
        
        context_str = "\n\n".join([f"Context {i+1}:\n{chunk}" for i, chunk in enumerate(context_chunks)])
        
        user_msg = (
            f"Context:\n{context_str}\n\n"
            f"Question: {query}"
        )
        
        prompt = (
            f"<|im_start|>system\n{system_msg}<|im_end|>\n"
            f"<|im_start|>user\n{user_msg}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )
        return prompt

    def query(self, user_query: str, text_retriever_func) -> Dict[str, Any]:
        """
        text_retriever_func: function(ids: List[int]) -> List[str]
        """
        # 1. Embed query
        query_vec = self.embedder.encode([user_query])[0]
        
        # 2. Search FAISS
        distances, indices = self.faiss_manager.search(query_vec, k=5)
        
        valid_indices = [idx for idx in indices if idx != -1]
        
        # 3. Retrieve Text
        context_chunks = text_retriever_func(valid_indices) if valid_indices else []
        
        # 4. Generate Response
        if not context_chunks:
            return {
                "response": "I couldn't find any relevant information in the documents.",
                "context": []
            }
            
        prompt = self.construct_prompt(user_query, context_chunks)
        response_text = self.llm.generate(prompt)
        
        return {
            "response": response_text.strip(),
            "context": context_chunks
        }

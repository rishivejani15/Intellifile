
import os
import requests
import numpy as np
import logging
from typing import List, Optional

class EmbeddingsClient:
    def __init__(self):
        self.url = os.getenv("EMBEDDINGS_URL", "http://127.0.0.1:8001/embeddings")
        self.model_name = os.getenv("EMBEDDINGS_MODEL", "qwen2.5-3b-instruct-q4_k_m.gguf")
        self.timeout = int(os.getenv("EMBEDDINGS_TIMEOUT", "30"))
        
        # We need to know vector dimension. We can fetch once or cache it.
        # For now, default 384 for MiniLM.
        self.dimension = 384 

    def get_dimension(self) -> int:
        """
        Only runs once to determine dimension if possible.
        """
        try:
            vec = self.embed(["hello world"])
            if vec is not None and len(vec) > 0:
                self.dimension = vec.shape[1]
                return self.dimension
        except Exception as e:
            logging.warning(f"Could not determine embedding dimension: {e}")
        return self.dimension

    def embed(self, texts: List[str]) -> Optional[np.ndarray]:
        """
        Returns normalized embeddings as numpy array (N, dim).
        """
        if not texts:
            return None

        payload = {
            "input": texts,
            "model": self.model_name
        }
        
        try:
            resp = requests.post(self.url, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            
            # OpenAI format: { "data": [ { "embedding": [...] }, ... ] }
            embeddings = [item["embedding"] for item in data["data"]]
            
            arr = np.array(embeddings, dtype="float32")
            
            # Normalize to unit length for cosine similarity
            faiss.normalize_L2(arr)
            
            return arr
            
        except Exception as e:
            logging.error(f"Embedding request failed: {e}")
            raise e

import faiss # lazy usage for normalization

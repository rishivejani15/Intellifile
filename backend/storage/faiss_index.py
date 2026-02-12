
import faiss
import numpy as np
import os
import threading
import pickle
import logging

class FaissIndex:
    def __init__(self, index_path: str = "data/vectors.faiss", dim: int = 384):
        self.index_path = index_path
        self.dim = dim
        self.index = None
        self.lock = threading.Lock()
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(os.path.abspath(index_path)), exist_ok=True)
        self.load_or_create()

    def load_or_create(self):
        with self.lock:
            if os.path.exists(self.index_path):
                try:
                    self.index = faiss.read_index(self.index_path)
                    print(f"Loaded FAISS index from {self.index_path}, size={self.index.ntotal}")
                except Exception as e:
                    logging.error(f"Failed to load index: {e}, creating new one.")
                    self._create_new()
            else:
                self._create_new()

    def _create_new(self):
        # IndexIDMap2 wrapping IndexHNSWFlat
        # HNSWFlat is fast and accurate, supports add_with_ids via IDMap
        # Using inner product (METRIC_INNER_PRODUCT) for cosine similarity on normalized vectors
        
        # HNSW parameters: M=32
        base_index = faiss.IndexHNSWFlat(self.dim, 32, faiss.METRIC_INNER_PRODUCT)
        
        # Explicit ID mapping
        self.index = faiss.IndexIDMap2(base_index)

    def add_vectors(self, vectors: np.ndarray, ids: np.ndarray):
        """
        vectors: (N, dim) float32 array, normalized
        ids: (N,) int64 array
        """
        if len(vectors) == 0:
            return
            
        with self.lock:
            # Vectors must be float32
            vectors = np.ascontiguousarray(vectors, dtype='float32')
            ids = np.ascontiguousarray(ids, dtype='int64')

            if vectors.shape[1] != self.dim:
                raise ValueError(f"Vector dim {vectors.shape[1]} != index dim {self.dim}")
            
            self.index.add_with_ids(vectors, ids)
            self._save()

    def search(self, query_vector: np.ndarray, k: int = 5):
        """
        Returns (distances, ids)
        """
        with self.lock:
            if self.index.ntotal == 0:
                return [], []
            
            query = np.ascontiguousarray(query_vector.reshape(1, -1), dtype='float32')
            # Assuming query is already normalized by caller
            
            dists, ids = self.index.search(query, k)
            return dists[0], ids[0]

    def _save(self):
        try:
            faiss.write_index(self.index, self.index_path)
        except Exception as e:
            logging.error(f"Failed to save index: {e}")

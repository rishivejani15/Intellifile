"""
Shared singleton for the SentenceTransformer model.
Import `MODEL` from here instead of creating new instances.
"""

import os
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
MODEL = SentenceTransformer(MODEL_NAME)

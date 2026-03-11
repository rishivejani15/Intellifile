import sys
import os

_BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, os.path.normpath(_BACKEND_DIR))

from core.embedder import build_faiss

build_faiss()
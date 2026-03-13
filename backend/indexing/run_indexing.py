import sys
import os

# Ensure backend/ is on sys.path so core.* imports resolve
_BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, os.path.normpath(_BACKEND_DIR))

from indexing.index_files import index_files_incremental
from indexing.update_faiss import update_faiss


def run():
    affected_chunk_ids = index_files_incremental()
    update_faiss(affected_chunk_ids)


if __name__ == "__main__":
    run()

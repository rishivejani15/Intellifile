from backend.indexing.index_files import index_files_incremental
from backend.indexing.update_faiss import update_faiss

def run():
    affected_chunk_ids = index_files_incremental("test_files")
    update_faiss(affected_chunk_ids)

if __name__ == "__main__":
    run()

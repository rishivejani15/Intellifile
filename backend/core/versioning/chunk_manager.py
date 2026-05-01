import os
import hashlib

# Project paths
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))
CHUNK_STORE_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "chunks")

# 512KB chunks are ideal for Word/Excel metadata changes
CHUNK_SIZE = 512 * 1024 

def ensure_chunk_store():
    if not os.path.exists(CHUNK_STORE_PATH):
        os.makedirs(CHUNK_STORE_PATH, exist_ok=True)

def save_file_as_chunks(file_path: str) -> list:
    """
    Splits a file into fixed-size chunks, stores them by hash,
    and returns the list of hashes (the 'recipe').
    """
    ensure_chunk_store()
    chunk_hashes = []
    
    with open(file_path, "rb") as f:
        while True:
            data = f.read(CHUNK_SIZE)
            if not data:
                break
            
            # Generate hash for this chunk
            chunk_hash = hashlib.sha256(data).hexdigest()
            chunk_hashes.append(chunk_hash)
            
            # Store chunk if it doesn't exist
            chunk_path = os.path.join(CHUNK_STORE_PATH, chunk_hash)
            if not os.path.exists(chunk_path):
                with open(chunk_path, "wb") as cf:
                    cf.write(data)
                    
    return chunk_hashes

def rebuild_file_from_chunks(chunk_hashes: list, output_path: str):
    """
    Rebuilds a file from a list of chunk hashes.
    """
    ensure_chunk_store()
    with open(output_path, "wb") as f:
        for ch in chunk_hashes:
            chunk_path = os.path.join(CHUNK_STORE_PATH, ch)
            if not os.path.exists(chunk_path):
                raise FileNotFoundError(f"Missing chunk: {ch}. Cannot rebuild file.")
            
            with open(chunk_path, "rb") as cf:
                f.write(cf.read())

def get_chunk_storage_stats():
    """Returns total size of all chunks in MB."""
    if not os.path.exists(CHUNK_STORE_PATH):
        return 0
    total_bytes = sum(os.path.getsize(os.path.join(CHUNK_STORE_PATH, f)) for f in os.listdir(CHUNK_STORE_PATH))
    return round(total_bytes / (1024 * 1024), 2)

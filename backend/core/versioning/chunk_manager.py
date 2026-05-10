import os
import hashlib

from core.paths import get_storage_dir

CHUNK_STORE_PATH = os.path.join(get_storage_dir(), "chunks")

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

def clean_orphaned_chunks():
    """
    Scans all version metadata across all files to find which chunks are still used.
    Deletes any chunks that are no longer referenced.
    """
    from core.versioning.snapshot_manager import BASE_VERSION_PATH
    import json
    
    used_chunks = set()
    
    # 1. Scan all folders in versions/
    if os.path.exists(BASE_VERSION_PATH):
        for file_id in os.listdir(BASE_VERSION_PATH):
            file_dir = os.path.join(BASE_VERSION_PATH, file_id)
            if not os.path.isdir(file_dir): continue
            
            # 2. Scan all .json files in each folder
            for f in os.listdir(file_dir):
                if f.endswith(".json") and not f.endswith(".structure.json"):
                    try:
                        with open(os.path.join(file_dir, f), "r", encoding="utf-8") as meta_f:
                            data = json.load(meta_f)
                            chunks = data.get("chunk_hashes", [])
                            for ch in chunks:
                                used_chunks.add(ch)
                    except: continue

    # 3. Delete chunks that are not used
    deleted_count = 0
    freed_bytes = 0
    if os.path.exists(CHUNK_STORE_PATH):
        for ch_file in os.listdir(CHUNK_STORE_PATH):
            if ch_file not in used_chunks:
                try:
                    ch_path = os.path.join(CHUNK_STORE_PATH, ch_file)
                    freed_bytes += os.path.getsize(ch_path)
                    os.remove(ch_path)
                    deleted_count += 1
                except: continue
                
    return deleted_count, freed_bytes
import os
import hashlib
import sys

def generate_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()

def get_file_id(file_path: str) -> str:
    # This matches the logic in snapshot_manager.py
    norm_path = os.path.normpath(os.path.realpath(file_path)).lower()
    norm_path = norm_path.rstrip(os.sep)
    return generate_sha256(norm_path)

if __name__ == "__main__":
    print("-" * 50)
    print("INTELLIFILE VAULT INSPECTOR")
    print("-" * 50)
    
    if len(sys.argv) > 1:
        target = sys.argv[1]
    else:
        target = input("Enter the full path of a file to inspect: ").strip()
    
    if os.path.exists(target):
        fid = get_file_id(target)
        storage_path = os.path.join("backend", "data", "storage", "versions", fid)
        
        print(f"\n[TARGET FILE]: {target}")
        print(f"[NORMALIZED PATH]: {os.path.normpath(os.path.realpath(target)).lower()}")
        print(f"\n[!] YOUR VAULT ID: {fid}")
        print(f"[!] STORAGE FOLDER: {storage_path}")
        
        if os.path.exists(storage_path):
            versions = [f for f in os.listdir(storage_path) if f.endswith(".json") and not f.endswith(".structure.json")]
            print(f"\n[STATUS]: Found {len(versions)} versions in history.")
        else:
            print("\n[STATUS]: This file hasn't been versioned yet (no folder found).")
    else:
        print(f"\n[ERROR]: File not found: {target}")

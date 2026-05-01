import os
import json
from utils.file_hash import generate_sha256

# Get project root dynamically
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))

BASE_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")

def restore_version(file_path: str, version_timestamp: str) -> dict:
    """
    Restores file safely with integrity check.
    """

    # Robust path normalization
    from core.versioning.snapshot_manager import get_file_id
    file_identifier = get_file_id(file_path)
    file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

    meta_file = os.path.join(file_dir, f"{version_timestamp}.json")
    if not os.path.exists(meta_file):
        return {"success": False, "error": f"Metadata not found for version: {version_timestamp}"}

    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        # Get the correct extension and physical file timestamp
        ext = metadata.get("ext", ".txt")
        actual_ts = metadata.get("reused_snapshot", version_timestamp)
        version_file = os.path.join(file_dir, f"{actual_ts}{ext}")

        if not os.path.exists(version_file):
            # Shield: If it's a Chunked file, we need to rebuild it
            if "chunk_hashes" in metadata:
                from core.versioning.chunk_manager import rebuild_file_from_chunks
                print(f"[Rollback] Rebuilding {version_timestamp} from {len(metadata['chunk_hashes'])} chunks...")
                rebuild_file_from_chunks(metadata["chunk_hashes"], version_file)
            else:
                return {"success": False, "error": f"Version snapshot file not found: {version_file}"}

        # Verify integrity
        is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]
        
        if is_binary:
            from core.versioning.snapshot_manager import compute_file_hash
            current_hash = compute_file_hash(version_file, True)
        else:
            with open(version_file, "r", encoding="utf-8", newline='') as f:
                content = f.read()
            current_hash = generate_sha256(content)

        if current_hash != metadata.get("file_hash"):
            return {"success": False, "error": "Snapshot integrity failed"}

        # Create safety backup before overwrite
        if os.path.exists(file_path):
            import shutil
            backup_path = file_path + ".backup"
            
            # Shield: If a hidden backup already exists, we must unhide it to overwrite it
            if os.path.exists(backup_path):
                try:
                    import subprocess
                    subprocess.run(['attrib', '-h', backup_path], capture_output=True, check=False)
                    os.remove(backup_path) # Remove old one to be safe
                except Exception: pass

            try:
                shutil.copy2(file_path, backup_path)
                # Optimization: Hide the backup file on Windows so it doesn't clutter the UI
                import subprocess
                subprocess.run(['attrib', '+h', backup_path], capture_output=True, check=False)
            except Exception:
                pass

        # Restore
        print(f"[Rollback] Restoring {version_timestamp} to {file_path}")
        if "chunk_hashes" in metadata:
            from core.versioning.chunk_manager import rebuild_file_from_chunks
            rebuild_file_from_chunks(metadata["chunk_hashes"], file_path)
        else:
            import shutil
            shutil.copy2(version_file, file_path)

        restored_size = os.path.getsize(file_path)
        return {"success": True, "message": "Rollback successful", "restored_length": restored_size}
    except PermissionError:
        return {
            "success": False, 
            "error": "Access Denied: The file is currently open in another program (Word, Excel, etc.). Please close the file and try the rollback again."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

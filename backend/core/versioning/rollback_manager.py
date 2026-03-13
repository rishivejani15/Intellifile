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
    norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
    file_identifier = generate_sha256(norm_path)
    file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

    meta_file = os.path.join(file_dir, f"{version_timestamp}.json")

    if not os.path.exists(meta_file):
        return {"success": False, "error": f"Metadata not found: {meta_file}"}

    with open(meta_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    ext = metadata.get("ext", ".txt")
    version_file = os.path.join(file_dir, f"{version_timestamp}{ext}")

    if not os.path.exists(version_file):
        for name in os.listdir(file_dir):
            if name.startswith(version_timestamp) and not name.endswith(".json"):
                version_file = os.path.join(file_dir, name)
                break

    if not os.path.exists(version_file):
        return {"success": False, "error": f"Version file not found: {version_file}"}

    # Verify integrity
    try:
        is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]

        if is_binary:
            with open(version_file, "rb") as f:
                raw = f.read()
            content = raw.decode("latin-1", errors="ignore")
            if generate_sha256(content) != metadata.get("file_hash"):
                return {"success": False, "error": "Snapshot integrity failed"}
        else:
            # Read with newline='' to keep normalized line endings as stored.
            with open(version_file, "r", encoding="utf-8", newline='') as f:
                content = f.read()
            if generate_sha256(content) != metadata.get("file_hash"):
                return {"success": False, "error": "Snapshot integrity failed"}

        # Create safety backup before overwrite
        if os.path.exists(file_path):
            backup_path = file_path + ".backup"
            if is_binary:
                with open(file_path, "rb") as src, open(backup_path, "wb") as dst:
                    dst.write(src.read())
            else:
                with open(file_path, "r", encoding="utf-8") as f:
                    current_content = f.read()
                with open(backup_path, "w", encoding="utf-8") as f:
                    f.write(current_content)

        # Restore - typically on Windows you might want native line endings,
        # but for text files IntelliFile manages, keeping them \n for consistency is safer.
        if is_binary:
            print(f"[Rollback] Restoring binary snapshot to {file_path}")
            with open(version_file, "rb") as src, open(file_path, "wb") as dst:
                dst.write(src.read())
                dst.flush()
                os.fsync(dst.fileno())
            return {"success": True, "message": "Rollback successful", "restored_length": os.path.getsize(file_path)}

        print(f"[Rollback] Restoring {len(content)} chars to {file_path}")
        with open(file_path, "w", encoding="utf-8", newline='') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno()) # Force write to disk

        return {"success": True, "message": "Rollback successful", "restored_length": len(content)}
    except Exception as e:
        print(f"[Rollback] Error: {str(e)}")
        return {"success": False, "error": str(e)}

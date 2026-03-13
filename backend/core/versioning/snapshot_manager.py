import os
import json
from datetime import datetime, timezone
from utils.file_hash import generate_sha256
from core.versioning.text_diff_engine import generate_diff


# Get project root dynamically
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))

BASE_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")

def ensure_directory(path):
    os.makedirs(path, exist_ok=True)

def save_snapshot(file_path: str, content_or_path: any, metadata: dict):
    """
    Stores snapshot + metadata safely. 
    content_or_path: Can be string (text) or path to binary file.
    """

    # Robust path normalization
    norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
    file_identifier = generate_sha256(norm_path)
    file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

    ensure_directory(file_dir)

    import random
    import string
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f") + f"_{suffix}"
    ext = os.path.splitext(file_path)[1].lower()
    
    is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]
    version_file = os.path.join(file_dir, f"{timestamp}{ext}")
    meta_file = os.path.join(file_dir, f"{timestamp}.json")
    struct_file = os.path.join(file_dir, f"{timestamp}.structure.json")

    if is_binary:
        import shutil
        if os.path.exists(content_or_path):
            shutil.copy2(content_or_path, version_file)
            # Generate hash of binary file
            with open(version_file, "rb") as f:
                file_hash = generate_sha256(f.read().decode('latin-1', errors='ignore')) # Simple hash approach
        else:
            # If content is already in memory (unlikely for binary but possible)
            with open(version_file, "wb") as f:
                f.write(content_or_path if isinstance(content_or_path, bytes) else b"")
            file_hash = generate_sha256(str(content_or_path))
    else:
        # Normalize all line endings to \n for consistent hashing
        content = content_or_path.replace("\r\n", "\n")
        with open(version_file, "w", encoding="utf-8", newline='') as f:
            f.write(content)
        file_hash = generate_sha256(content)

    metadata["file_hash"] = file_hash
    metadata["timestamp"] = timestamp
    metadata["ext"] = ext

    # Save structured data if present in metadata (from Word/Excel engines)
    if "structured_data" in metadata:
        with open(struct_file, "w", encoding="utf-8") as f:
            json.dump(metadata.pop("structured_data"), f, indent=4)

    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4)

    return timestamp

# ===============================
# LIST VERSIONS
# ===============================

def list_versions(file_path: str):
    """
    Returns list of version metadata sorted by newest first.
    """

    # Robust path normalization
    norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
    file_identifier = generate_sha256(norm_path)
    file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

    if not os.path.exists(file_dir):
        return []

    versions = []

    for filename in os.listdir(file_dir):
        if not filename.endswith(".json") or filename.endswith(".structure.json"):
            continue

        meta_path = os.path.join(file_dir, filename)

        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

                versions.append({
                    "version_id": metadata.get("timestamp"),
                    "summary": metadata.get("summary"),
                    "intent": metadata.get("intent"),
                    "risk_level": metadata.get("risk_level"),
                    "stability_score": metadata.get("stability_score"),
                    "semantic": metadata.get("semantic")
                })

        except Exception:
            # Skip corrupted metadata
            continue

    versions.sort(
        key=lambda x: x.get("version_id", ""),
        reverse=True
    )

    return versions

# ===============================
# GET VERSION CONTENT
# ===============================

def get_version_content(file_path: str, version_id: str):
    """
    Returns content of specific version snapshot.
    Smartly detects extension from metadata or filesystem.
    """
    # Robust path normalization
    norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
    file_identifier = generate_sha256(norm_path)
    file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

    # First try to find the extension from metadata (.json)
    meta_path = os.path.join(file_dir, f"{version_id}.json")
    ext = ".txt" # Default fallback
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
            ext = metadata.get("ext", ".txt")
    
    version_file = os.path.join(file_dir, f"{version_id}{ext}")

    if not os.path.exists(version_file):
        # Final fallback: search for ANY file with this version_id that isn't .json or .structure.json
        for f in os.listdir(file_dir):
            if f.startswith(version_id) and not f.endswith(".json"):
                version_file = os.path.join(file_dir, f)
                break
        else:
            raise FileNotFoundError(f"Version file not found for {version_id}")

    # For binary files, return the path so the engine can parse it
    if ext in [".docx", ".xlsx"]:
        return version_file

    with open(version_file, "r", encoding="utf-8") as f:
        return f.read()


# ===============================
# COMPARE TWO VERSIONS
# ===============================

def compare_versions(file_path: str, version_a: str, version_b: str):
    """
    Returns diff between two stored versions.
    Supports both standard text diffs and structured JSON diffs.
    """
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext in [".docx", ".xlsx"]:
        # Use local import to avoid circular dependency
        from core.versioning.version_engine import VersionEngine
        engine = VersionEngine()
        
        path_a = get_version_content(file_path, version_a)
        path_b = get_version_content(file_path, version_b)
        
        # If we got dicts (structures), process_version handles them.
        # If we got strings (paths), it parses them.
        result = engine.process_version(file_path, path_a, path_b)
        return {
            "version_a": version_a,
            "version_b": version_b,
            "diff": result["diff"]
        }
    else:
        # Standard Text Diff
        content_a = get_version_content(file_path, version_a)
        content_b = get_version_content(file_path, version_b)
        diff = generate_diff(content_a, content_b)

        return {
            "version_a": version_a,
            "version_b": version_b,
            "diff": diff
        }
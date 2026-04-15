import os
import json
from typing import Any
from datetime import datetime, timezone
from utils.file_hash import generate_sha256
from core.versioning.text_diff_engine import generate_diff


# Get project root dynamically
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))

BASE_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")
INDEX_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "version_index")

def get_file_id(file_path: str) -> str:
    norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
    return generate_sha256(norm_path)

def compute_file_hash(content_or_path: Any, is_binary: bool = False) -> str:
    if is_binary:
        if os.path.exists(content_or_path):
            with open(content_or_path, "rb") as f:
                return generate_sha256(f.read().decode('latin-1', errors='ignore'))
        else:
            return generate_sha256(str(content_or_path))
    else:
        content = content_or_path.replace("\r\n", "\n") if isinstance(content_or_path, str) else str(content_or_path).replace("\r\n", "\n")
        return generate_sha256(content)

def get_version_index_path(file_path: str) -> str:
    file_id = get_file_id(file_path)
    ensure_directory(INDEX_VERSION_PATH)
    return os.path.join(INDEX_VERSION_PATH, f"{file_id}.json")

def update_version_index(file_path: str, version_data: dict, add_version=True):
    index_path = get_version_index_path(file_path)
    file_id = get_file_id(file_path)
    
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {"file_id": file_id, "versions": []}
    else:
        data = {"file_id": file_id, "versions": []}
        
    if add_version:
        data["versions"].append(version_data)
    
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

def get_versions(file_path: str):
    """
    Returns list of version metadata sorted by newest first.
    First checks the central version index. If missing, falls back to legacy directory scanning.
    """
    index_path = get_version_index_path(file_path)
    versions = []
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                versions = data.get("versions", [])
        except Exception:
            pass
            
    # Ensure backward compatibility by merging legacy ones
    legacy = list_versions_legacy(file_path)
    existing_ids = {v.get("version_id") for v in versions}
    for lv in legacy:
        if lv.get("version_id") not in existing_ids:
            lv["version"] = 0
            lv["storage_type"] = "full"
            lv["file_hash"] = None
            lv["parent"] = None
            lv["diff_path"] = None
            versions.append(lv)
            
    return sorted(versions, key=lambda x: str(x.get("version_id", "")), reverse=True)

def list_versions(file_path: str):
    return get_versions(file_path)

def get_last_version(file_path: str):
    versions = get_versions(file_path)
    if versions:
        return versions[0]
    return None

def get_version_by_number(file_path: str, version: int):
    versions = get_versions(file_path)
    for v in versions:
        if v.get("version") == version:
            return v
    return None

def create_version(file_path: str, content_or_path: Any, metadata: dict):
    ext = os.path.splitext(file_path)[1].lower()
    is_binary = ext in [".docx", ".xlsx", ".pdf", ".zip"]
    
    current_hash = compute_file_hash(content_or_path, is_binary)
    last_version = get_last_version(file_path)
    
    if last_version and last_version.get("file_hash") == current_hash:
        return last_version.get("version_id") # Hash match: do not create new version
        
    version_num = 1
    parent = None
    
    if last_version:
        version_num = last_version.get("version", 0) + 1
        parent = last_version.get("version")
        
    storage_type = "full"
    # First version -> full. Every 3 versions -> full. Otherwise -> diff.
    if version_num > 1 and version_num % 3 != 1:
        storage_type = "diff"
        
    timestamp = save_snapshot(file_path, content_or_path, metadata)
    
    version_entry = {
        "version": version_num,
        "version_id": timestamp,
        "parent": parent,
        "storage_type": storage_type,
        "file_hash": metadata.get("file_hash", current_hash),
        "timestamp": timestamp,
        "snapshot_path": os.path.join(BASE_VERSION_PATH, get_file_id(file_path), f"{timestamp}{ext}"),
        "diff_path": None,
        "summary": metadata.get("summary", ""),
        "intent": metadata.get("intent", ""),
        "semantic": metadata.get("semantic", {}),
        "risk_level": metadata.get("risk_level", ""),
        "stability_score": metadata.get("stability_score", 0)
    }
    
    update_version_index(file_path, version_entry, add_version=True)
    return timestamp

def ensure_directory(path):
    os.makedirs(path, exist_ok=True)

def save_snapshot(file_path: str, content_or_path: Any, metadata: dict):
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

def list_versions_legacy(file_path: str):
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
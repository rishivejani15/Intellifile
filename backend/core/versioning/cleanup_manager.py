import os
import json
from datetime import datetime, timezone
from core.versioning.snapshot_manager import list_versions, get_version_index_path, get_file_id

# Get project root dynamically
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))
BASE_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")

def run_smart_cleanup(file_path: str) -> dict:
    """
    Keeps only the current/latest version and removes the rest.
    """
    try:
        file_identifier = get_file_id(file_path)
        file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

        if not os.path.exists(file_dir):
            return {"success": False, "error": "No version history found."}

        versions = list_versions(file_path)
        if not versions:
            return {"success": False, "error": "No version history found."}

        latest_version = versions[0]
        latest_version_id = latest_version.get("version_id")
        latest_timestamp = latest_version.get("timestamp", latest_version_id)
        latest_reused_snapshot = latest_version.get("reused_snapshot")

        keep_files = {f"{latest_version_id}.json"}
        delete_files = set()

        for filename in os.listdir(file_dir):
            if not filename.endswith(".json") or filename.endswith(".structure.json"):
                continue
            if filename not in keep_files:
                delete_files.add(filename)

        # Keep the physical snapshot referenced by the latest version.
        reused_phys_files = {latest_reused_snapshot or latest_timestamp}

        deleted_count = 0
        freed_bytes = 0

        # Perform deletion of metadata and orphaned physical files
        for df in delete_files:
            meta_path = os.path.join(file_dir, df)
            if not os.path.exists(meta_path):
                continue
            
            # Check if we can delete the associated physical file
            with open(meta_path, "r", encoding="utf-8") as f:
                d = json.load(f)
                ts = d.get("timestamp")
                if ts not in reused_phys_files:
                    # Search for physical file with this timestamp
                    ext = d.get("ext", ".txt")
                    phys_path = os.path.join(file_dir, f"{ts}{ext}")
                    if os.path.exists(phys_path):
                        freed_bytes += os.path.getsize(phys_path)
                        os.remove(phys_path)
                    
                    # Also delete structure if exists
                    struct_path = os.path.join(file_dir, f"{ts}.structure.json")
                    if os.path.exists(struct_path):
                        os.remove(struct_path)

            os.remove(meta_path)
            deleted_count += 1

        # Remove stale index entries and keep only the latest version in the index.
        index_path = get_version_index_path(file_path)
        if os.path.exists(index_path):
            try:
                with open(index_path, "r", encoding="utf-8") as f:
                    index_data = json.load(f)
            except Exception:
                index_data = {"file_id": file_identifier, "versions": []}

            index_data["versions"] = [latest_version]
            with open(index_path, "w", encoding="utf-8") as f:
                json.dump(index_data, f, indent=4)

        return {
            "success": True, 
            "deleted_versions": deleted_count, 
            "freed_mb": round(freed_bytes / (1024*1024), 2)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
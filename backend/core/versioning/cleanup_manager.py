import os
import json
from datetime import datetime, timedelta, timezone
from utils.file_hash import generate_sha256

# Get project root dynamically
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../../"))
BASE_VERSION_PATH = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")

def run_smart_cleanup(file_path: str) -> dict:
    """
    Applies the retention policy:
    1. Keep all versions for 7 days.
    2. Keep only 1 version per day after 30 days.
    3. Delete everything older than 1 year.
    """
    try:
        norm_path = os.path.normpath(os.path.abspath(file_path)).lower()
        file_identifier = generate_sha256(norm_path)
        file_dir = os.path.join(BASE_VERSION_PATH, file_identifier)

        if not os.path.exists(file_dir):
            return {"success": False, "error": "No version history found."}

        now = datetime.now(timezone.utc)
        
        # 1. Collect all versions
        meta_files = [f for f in os.listdir(file_dir) if f.endswith(".json") and not f.endswith(".structure.json")]
        versions = []
        
        for mf in meta_files:
            try:
                with open(os.path.join(file_dir, mf), "r", encoding="utf-8") as f:
                    data = json.load(f)
                    ts_str = data.get("timestamp", mf.split(".")[0].split("_")[0])
                    # Parse timestamp (YYYYMMDDHHMMSSf)
                    dt = datetime.strptime(ts_str[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    versions.append({
                        "file": mf,
                        "data": data,
                        "dt": dt,
                        "ts": data.get("timestamp")
                    })
            except Exception:
                continue

        # Sort by date (newest first)
        versions.sort(key=lambda x: x["dt"], reverse=True)

        keep_files = set()
        delete_files = set()
        
        day_buckets = {} # For 30-day thinning

        for v in versions:
            age_days = (now - v["dt"]).days
            
            # Policy 1: Keep all versions for 7 days
            if age_days <= 7:
                keep_files.add(v["file"])
                continue
                
            # Policy 3: Delete everything older than 1 year
            if age_days > 365:
                delete_files.add(v["file"])
                continue
            
            # Policy 2: Keep only 1 version per day after 30 days
            if age_days > 30:
                day_key = v["dt"].strftime("%Y-%m-%d")
                if day_key not in day_buckets:
                    day_buckets[day_key] = v["file"]
                    keep_files.add(v["file"])
                else:
                    delete_files.add(v["file"])
                continue
            
            # For 7 to 30 days: Keep all (Can be refined in future)
            keep_files.add(v["file"])

        # Dependency Check: Don't delete a physical file if a KEPT version reuses it
        reused_phys_files = set()
        for kf in keep_files:
            with open(os.path.join(file_dir, kf), "r", encoding="utf-8") as f:
                d = json.load(f)
                reused_phys_files.add(d.get("reused_snapshot", d.get("timestamp")))

        deleted_count = 0
        freed_bytes = 0

        # Perform deletion of metadata and orphaned physical files
        for df in delete_files:
            meta_path = os.path.join(file_dir, df)
            
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

        # Optimization: Clear the transient cache folder
        cache_dir = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "cache")
        if os.path.exists(cache_dir):
            for f in os.listdir(cache_dir):
                try:
                    fpath = os.path.join(cache_dir, f)
                    freed_bytes += os.path.getsize(fpath)
                    os.remove(fpath)
                except: pass

        # CRITICAL: Trigger Chunk Garbage Collection to free real MB
        from core.versioning.chunk_manager import clean_orphaned_chunks
        _, chunk_freed = clean_orphaned_chunks()
        freed_bytes += chunk_freed

        return {
            "success": True, 
            "deleted_versions": deleted_count, 
            "freed_mb": round(freed_bytes / (1024*1024), 2)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
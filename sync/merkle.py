# pc/sync/merkle.py

import hashlib
import os
import sqlite3
import time

try:
    from sync.checksum import file_checksum
except ModuleNotFoundError:
    from checksum import file_checksum


def build_merkle_tree(folder: str) -> dict:
    """
    Walk folder and compute MD5 per file.
    Returns {relative_path: checksum, '__root__': root_hash}
    Root hash changes if ANY file changes — O(1) check.
    """
    tree = {}
    for root, _, files in os.walk(folder):
        for fname in sorted(files):
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, folder)
            # normalize path separators (Windows vs Linux)
            rel_path = rel_path.replace("\\", "/")
            tree[rel_path] = file_checksum(abs_path)

    # root = hash of all (path+checksum) pairs sorted
    combined = "".join(
        f"{k}:{v}" for k, v in sorted(tree.items())
    )
    tree["__root__"] = hashlib.md5(combined.encode()).hexdigest()
    return tree


def find_changed_files(local_tree: dict, remote_tree: dict) -> dict:
    """
    Compare two Merkle trees.
    Returns {filepath: change_type}
    change_type: 'modified' | 'added' | 'deleted'
    """
    if local_tree.get("__root__") == remote_tree.get("__root__"):
        return {}  # roots match — nothing to sync, done instantly

    changed = {}

    all_paths = set(local_tree) | set(remote_tree)
    all_paths.discard("__root__")

    for path in all_paths:
        local_cs  = local_tree.get(path)
        remote_cs = remote_tree.get(path)

        if local_cs == remote_cs:
            continue
        elif local_cs and remote_cs:
            changed[path] = "modified"
        elif remote_cs and not local_cs:
            changed[path] = "added"     # exists on remote, not local
        else:
            changed[path] = "deleted"   # exists locally, deleted on remote

    return changed


# ─── Merkle cache (SQLite) ─────────────────────────────────────────────────────

def init_merkle_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS merkle_cache (
            filepath    TEXT PRIMARY KEY,
            checksum    TEXT NOT NULL,
            updated_at  REAL NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def save_merkle_cache(db_path: str, tree: dict):
    conn = sqlite3.connect(db_path)
    ts = time.time()
    for path, checksum in tree.items():
        conn.execute("""
            INSERT INTO merkle_cache (filepath, checksum, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(filepath) DO UPDATE SET
                checksum   = excluded.checksum,
                updated_at = excluded.updated_at
        """, (path, checksum, ts))
    conn.commit()
    conn.close()


def load_merkle_cache(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT filepath, checksum FROM merkle_cache"
    ).fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}
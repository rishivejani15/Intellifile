# pc/sync/merkle.py

import hashlib
import logging
import os
import sqlite3
import time

try:
    from sync.checksum import file_checksum
except ModuleNotFoundError:
    from checksum import file_checksum

log = logging.getLogger("intellifil.merkle")

_IGNORE_FILES = {"desktop.ini", "thumbs.db", ".ds_store"}


def _get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except sqlite3.Error as exc:
        log.warning("SQLite PRAGMA failed: %s", exc)
    return conn


def build_merkle_tree(folder: str) -> dict:
    """
    Walk folder and compute MD5 per file.
    Returns {relative_path: checksum, '__root__': root_hash}
    Root hash changes if ANY file changes — O(1) check.
    """
    tree = {}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in sorted(files):
            if fname.startswith("."):
                log.debug("[merkle] skipping %s", os.path.join(root, fname))
                continue
            if fname.lower().endswith(".tmp"):
                log.debug("[merkle] skipping %s", os.path.join(root, fname))
                continue
            if fname.lower() in _IGNORE_FILES:
                log.debug("[merkle] skipping %s", os.path.join(root, fname))
                continue
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
    conn = _get_conn(db_path)
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
    conn = _get_conn(db_path)
    ts = time.time()

    # Upsert all current entries
    for path, checksum in tree.items():
        conn.execute("""
            INSERT INTO merkle_cache (filepath, checksum, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(filepath) DO UPDATE SET
                checksum   = excluded.checksum,
                updated_at = excluded.updated_at
        """, (path, checksum, ts))

    # Delete rows whose paths are no longer in the tree (i.e. file was removed)
    existing = {row[0] for row in conn.execute(
        "SELECT filepath FROM merkle_cache"
    ).fetchall()}
    stale = existing - set(tree.keys())
    for path in stale:
        conn.execute("DELETE FROM merkle_cache WHERE filepath = ?", (path,))

    conn.commit()
    conn.close()


def load_merkle_cache(db_path: str) -> dict:
    conn = _get_conn(db_path)
    rows = conn.execute(
        "SELECT filepath, checksum FROM merkle_cache"
    ).fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}
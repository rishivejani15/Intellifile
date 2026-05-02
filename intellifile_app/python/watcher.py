# python/watcher.py

import hashlib
import json
import os
import sqlite3

DB_PATH    = "intellifil_mobile.db"
BLOCK_SIZE = 128 * 1024


def get_state(sync_folder: str) -> str:
    """
    Called by Flutter on startup.
    Returns local Merkle tree + all vector clocks as JSON.
    """
    tree   = _build_tree(sync_folder)
    clocks = _load_all_clocks()
    return json.dumps({'tree': tree, 'clocks': clocks})


def _build_tree(folder: str) -> dict:
    import hashlib
    tree = {}
    for root, _, files in os.walk(folder):
        for fname in sorted(files):
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, folder).replace("\\", "/")
            h = hashlib.md5()
            with open(abs_path, 'rb') as f:
                while chunk := f.read(BLOCK_SIZE):
                    h.update(chunk)
            tree[rel_path] = h.hexdigest()

    combined  = "".join(f"{k}:{v}" for k, v in sorted(tree.items()))
    tree["__root__"] = hashlib.md5(combined.encode()).hexdigest()
    return tree


def _load_all_clocks() -> dict:
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT filepath, clock_json FROM vector_clocks"
        ).fetchall()
        conn.close()
        return {row[0]: json.loads(row[1]) for row in rows}
    except Exception:
        return {}
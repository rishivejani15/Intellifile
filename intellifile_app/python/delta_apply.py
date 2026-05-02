# python/delta_apply.py

import hashlib
import json
import os
import sqlite3
import time

BLOCK_SIZE = 128 * 1024  # 128KB
DB_PATH    = "intellifil_mobile.db"
DEVICE_ID  = "mobile"


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS vector_clocks (
            filepath   TEXT PRIMARY KEY,
            clock_json TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
    """)
    conn.commit()
    conn.close()


# ── Block checksums ────────────────────────────────────────────────────────────

def get_block_checksums(filepath: str) -> dict:
    checksums = {}
    if not os.path.exists(filepath):
        return checksums
    with open(filepath, 'rb') as f:
        i = 0
        while chunk := f.read(BLOCK_SIZE):
            checksums[i] = hashlib.md5(chunk).hexdigest()
            i += 1
    return checksums


def get_all_block_checksums(sync_folder: str) -> dict:
    """Returns block checksums for every file in sync folder."""
    result = {}
    for root, _, files in os.walk(sync_folder):
        for fname in files:
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, sync_folder).replace("\\", "/")
            result[rel_path] = get_block_checksums(abs_path)
    return json.dumps(result)


def compute_delta(filepath: str, remote_checksums_json: str) -> str:
    remote_checksums = json.loads(remote_checksums_json)
    deltas = []
    if not os.path.exists(filepath):
        return json.dumps(deltas)
    with open(filepath, 'rb') as f:
        i = 0
        while chunk := f.read(BLOCK_SIZE):
            checksum = hashlib.md5(chunk).hexdigest()
            if remote_checksums.get(str(i)) != checksum:
                deltas.append({
                    'block':    i,
                    'checksum': checksum,
                    'data':     chunk.hex(),
                })
            i += 1
    return json.dumps(deltas)


def apply_delta(filepath: str, deltas_json: str):
    deltas = json.loads(deltas_json)
    blocks = {}

    if os.path.exists(filepath):
        with open(filepath, 'rb') as f:
            i = 0
            while chunk := f.read(BLOCK_SIZE):
                blocks[i] = chunk
                i += 1

    for delta in deltas:
        blocks[delta['block']] = bytes.fromhex(delta['data'])

    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'wb') as f:
        for i in sorted(blocks.keys()):
            f.write(blocks[i])


# ── Vector clock ───────────────────────────────────────────────────────────────

def get_clock(filepath: str) -> str:
    _init_db()
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT clock_json FROM vector_clocks WHERE filepath=?",
        (filepath,)
    ).fetchone()
    conn.close()
    return row[0] if row else json.dumps({})


def merge_clock(filepath: str, remote_clock_json: str):
    _init_db()
    remote_clock = json.loads(remote_clock_json)
    local_clock  = json.loads(get_clock(filepath))

    merged = {
        **local_clock,
        **{k: max(local_clock.get(k, 0), v)
           for k, v in remote_clock.items()}
    }

    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO vector_clocks (filepath, clock_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(filepath) DO UPDATE SET
            clock_json = excluded.clock_json,
            updated_at = excluded.updated_at
    """, (filepath, json.dumps(merged), time.time()))
    conn.commit()
    conn.close()
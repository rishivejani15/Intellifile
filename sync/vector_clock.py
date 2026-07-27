# pc/sync/vector_clock.py

import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field


DEVICE_ID = "pc"  # change to "mobile" on mobile side

log = logging.getLogger("intellifil.vector_clock")


def _to_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except sqlite3.Error as exc:
        log.warning("SQLite PRAGMA failed: %s", exc)
    return conn


@dataclass
class VectorClock:
    device_id: str
    clock: dict = field(default_factory=dict)

    def tick(self):
        """Call this every time the local device edits a file."""
        self.clock[self.device_id] = _to_int(self.clock.get(self.device_id, 0)) + 1

    def merge(self, other: dict):
        """Merge a remote clock into this one — take max per device."""
        for device, ts in other.items():
            self.clock[device] = max(_to_int(self.clock.get(device, 0)), _to_int(ts))

    def compare(self, other: dict) -> str:
        """
        Compare this clock against a remote clock.
        Returns one of: 'local_wins' | 'remote_wins' | 'identical' | 'conflict'
        """
        local_newer = any(
            _to_int(self.clock.get(d, 0)) > _to_int(other.get(d, 0))
            for d in set(self.clock) | set(other)
        )
        remote_newer = any(
            _to_int(other.get(d, 0)) > _to_int(self.clock.get(d, 0))
            for d in set(self.clock) | set(other)
        )

        if local_newer and not remote_newer:
            return "local_wins"
        elif remote_newer and not local_newer:
            return "remote_wins"
        elif not local_newer and not remote_newer:
            return "identical"
        else:
            return "conflict"  # both edited since last sync

    def to_json(self) -> str:
        return json.dumps(self.clock)

    @staticmethod
    def from_json(device_id: str, data: str) -> "VectorClock":
        vc = VectorClock(device_id)
        vc.clock = json.loads(data)
        return vc


# ─── Persistence (SQLite) ──────────────────────────────────────────────────────

def init_clock_db(db_path: str):
    """Create the vector_clocks table if it doesn't exist."""
    conn = _get_conn(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS vector_clocks (
            filepath    TEXT PRIMARY KEY,
            clock_json  TEXT NOT NULL,
            updated_at  REAL NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def save_clock(db_path: str, filepath: str, vc: VectorClock):
    conn = _get_conn(db_path)
    conn.execute("""
        INSERT INTO vector_clocks (filepath, clock_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(filepath) DO UPDATE SET
            clock_json = excluded.clock_json,
            updated_at = excluded.updated_at
    """, (filepath, vc.to_json(), time.time()))
    conn.commit()
    conn.close()


def load_clock(db_path: str, filepath: str) -> VectorClock:
    """Load clock for a file. Returns a fresh clock if not found."""
    conn = _get_conn(db_path)
    row = conn.execute(
        "SELECT clock_json FROM vector_clocks WHERE filepath=?",
        (filepath,)
    ).fetchone()
    conn.close()

    if row:
        return VectorClock.from_json(DEVICE_ID, row[0])
    return VectorClock(DEVICE_ID)  # new file, fresh clock


def load_all_clocks(db_path: str) -> dict:
    """Load all clocks — sent to remote device during sync handshake."""
    conn = _get_conn(db_path)
    rows = conn.execute(
        "SELECT filepath, clock_json FROM vector_clocks"
    ).fetchall()
    conn.close()
    return {row[0]: json.loads(row[1]) for row in rows}
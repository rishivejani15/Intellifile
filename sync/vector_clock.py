# pc/sync/vector_clock.py

import time
import json
import sqlite3
from dataclasses import dataclass, field


DEVICE_ID = "pc"  # change to "mobile" on mobile side


@dataclass
class VectorClock:
    device_id: str
    clock: dict = field(default_factory=dict)

    def tick(self):
        """Call this every time the local device edits a file."""
        self.clock[self.device_id] = time.time()

    def merge(self, other: dict):
        """Merge a remote clock into this one — take max per device."""
        for device, ts in other.items():
            self.clock[device] = max(self.clock.get(device, 0), ts)

    def compare(self, other: dict) -> str:
        """
        Compare this clock against a remote clock.
        Returns one of: 'local_wins' | 'remote_wins' | 'identical' | 'conflict'
        """
        local_newer = any(
            self.clock.get(d, 0) > other.get(d, 0)
            for d in set(self.clock) | set(other)
        )
        remote_newer = any(
            other.get(d, 0) > self.clock.get(d, 0)
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
    conn = sqlite3.connect(db_path)
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
    conn = sqlite3.connect(db_path)
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
    conn = sqlite3.connect(db_path)
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
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT filepath, clock_json FROM vector_clocks"
    ).fetchall()
    conn.close()
    return {row[0]: json.loads(row[1]) for row in rows}
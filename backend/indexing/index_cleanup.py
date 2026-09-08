"""One-time removal of files that are no longer eligible for indexing.

This module only removes rows, text chunks, and vector IDs from IntelliFile's
local search index.  It never touches the user's files on disk.
"""

from core.db import get_connection, rebuild_fts
from core.scanner import is_indexable_document


EXCLUSION_POLICY_VERSION = "v1"


def purge_excluded_index_records():
    """Delete stale machine/project artefacts from the search database.

    The returned chunk IDs let the caller remove their matching FAISS vectors
    without rebuilding any embeddings.  The policy marker makes the database
    walk a one-time migration; future scans use the same eligibility check.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT value FROM settings WHERE key = ?",
            ("index_exclusion_policy_version",),
        )
        version = cur.fetchone()
        if version and version[0] == EXCLUSION_POLICY_VERSION:
            return []

        cur.execute("SELECT id, path FROM files")
        excluded_file_ids = [
            file_id for file_id, path in cur.fetchall()
            if not is_indexable_document(path)
        ]
        removed_chunk_ids = []
        for start in range(0, len(excluded_file_ids), 500):
            batch = excluded_file_ids[start:start + 500]
            placeholders = ",".join("?" * len(batch))
            cur.execute(f"SELECT id FROM chunks WHERE file_id IN ({placeholders})", batch)
            removed_chunk_ids.extend(row[0] for row in cur.fetchall())
            cur.execute(f"DELETE FROM chunks WHERE file_id IN ({placeholders})", batch)
            cur.execute(f"DELETE FROM files WHERE id IN ({placeholders})", batch)

        cur.execute(
            """INSERT INTO settings(key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            ("index_exclusion_policy_version", EXCLUSION_POLICY_VERSION),
        )
        conn.commit()
    finally:
        conn.close()

    if removed_chunk_ids:
        rebuild_fts()
    return removed_chunk_ids

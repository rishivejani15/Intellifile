"""
Automated Integration Test for Dual-Database FAISS Index Model Migration Framework.
"""

import os
import sys
import unittest
import numpy as np

# Ensure backend root is on sys.path
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import init_db, get_connection, set_setting, get_setting
from core.faiss_manager import load_index, save_index, invalidate_cache, INDEX_PATH
from indexing.migration_manager import upgrade_model_embeddings, get_staging_index_path


class TestModelMigrationFramework(unittest.TestCase):

    def setUp(self):
        init_db()
        # Seed test files and chunks into SQLite
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM chunks")
        cur.execute("DELETE FROM files")
        
        cur.execute(
            "INSERT INTO files (path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            ("C:\\Test\\doc1.txt", "doc1.txt", 1000, 1000)
        )
        file_id = cur.lastrowid
        
        test_texts = [
            "IntelliFile AI semantic search model upgrade architecture test.",
            "Fast text cache reuse from SQLite database skipping heavy disk I/O.",
            "Dual database migration keeps search active while building new vectors."
        ]
        
        for idx, txt in enumerate(test_texts):
            cur.execute(
                "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                (file_id, idx, txt)
            )
        
        conn.commit()
        conn.close()

    def test_database_version_tracking(self):
        set_setting("auto_model_upgrade", "true")
        set_setting("active_model_version", "v1.0.0")
        set_setting("active_index_version", "v1.0.0")

        self.assertEqual(get_setting("auto_model_upgrade"), "true")
        self.assertEqual(get_setting("active_model_version"), "v1.0.0")

    def test_dual_database_migration_execution(self):
        progress_events = []

        def _progress_cb(phase, detail, pct):
            progress_events.append({"phase": phase, "detail": detail, "pct": pct})

        res = upgrade_model_embeddings(target_version="v2.0.0", progress_cb=_progress_cb)

        self.assertTrue(res["success"])
        self.assertEqual(res["count"], 3)
        self.assertEqual(res["target_version"], "v2.0.0")

        # Verify DB version settings updated to v2.0.0
        self.assertEqual(get_setting("active_index_version"), "v2.0.0")
        self.assertEqual(get_setting("active_model_version"), "v2.0.0")

        # Verify index loaded in memory is non-empty
        index = load_index(force_reload=True)
        self.assertIsNotNone(index)
        self.assertEqual(index.ntotal, 3)

        # Verify progress events emitted
        phases = [p["phase"] for p in progress_events]
        self.assertIn("reindexing", phases)
        self.assertIn("done", phases)


if __name__ == "__main__":
    unittest.main()

"""Regression coverage for index-only project artefact exclusions."""

import os
import shutil
import sys
import tempfile
import unittest

_DATA_DIR = tempfile.mkdtemp(prefix="intellifile-index-exclusion-test-")
os.environ["IF_DATA_DIR"] = _DATA_DIR

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import get_connection, init_db  # noqa: E402
from core.scanner import is_indexable_document  # noqa: E402
from indexing.index_cleanup import purge_excluded_index_records  # noqa: E402


class IndexExclusionTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_DATA_DIR, ignore_errors=True)

    def setUp(self):
        init_db()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM chunks")
        cur.execute("DELETE FROM files")
        cur.execute("DELETE FROM settings WHERE key = 'index_exclusion_policy_version'")
        conn.commit()
        conn.close()

    def test_project_noise_is_not_indexable(self):
        self.assertFalse(is_indexable_document(r"E:\Android Studio\license\power_assert_license.txt"))
        self.assertFalse(is_indexable_document(r"E:\Need for Speed\Support\readme\Ctimme.txt"))
        self.assertFalse(is_indexable_document(r"C:\ProjectVaayu\requirements_hf.txt"))
        self.assertTrue(is_indexable_document(r"C:\Documents\different laws.txt"))

    def test_cleanup_removes_only_excluded_records_from_search_index(self):
        stale_path = r"E:\Android Studio\license\power_assert_license.txt"
        keep_path = r"C:\Documents\different laws.txt"
        conn = get_connection()
        cur = conn.cursor()
        for path in (stale_path, keep_path):
            cur.execute(
                "INSERT INTO files(path, filename, modified_time, created_time) VALUES (?, ?, 1, 1)",
                (path, path.rsplit("\\", 1)[-1]),
            )
            cur.execute("INSERT INTO chunks(file_id, chunk_index, text) VALUES (?, 0, 'text')", (cur.lastrowid,))
        conn.commit()
        conn.close()

        removed_chunk_ids = purge_excluded_index_records()
        self.assertEqual(len(removed_chunk_ids), 1)

        conn = get_connection()
        rows = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
        conn.close()
        self.assertEqual(rows, [(keep_path,)])


if __name__ == "__main__":
    unittest.main()

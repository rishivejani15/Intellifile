"""Regression tests for deterministic folder result listings."""

import os
import shutil
import sys
import tempfile
import time
import unittest
from datetime import datetime

_DATA_DIR = tempfile.mkdtemp(prefix="intellifile-folder-test-")
os.environ["IF_DATA_DIR"] = _DATA_DIR

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import folder_metadata, get_connection, init_db, upsert_folder_catalog  # noqa: E402
from core.search import folder_search  # noqa: E402


def timestamp(year, month, day):
    return int(time.mktime(datetime(year, month, day).timetuple()))


class FolderSearchTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_DATA_DIR, ignore_errors=True)

    def setUp(self):
        init_db()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM files")
        for path, date in (
            (r"C:\docs\Statistical Analysis\tables.pdf", timestamp(2026, 8, 1)),
            (r"C:\docs\Statistical Analysis\module 1\practice.csv", timestamp(2026, 8, 2)),
            (r"C:\other\Statistical Analysis\summary.docx", timestamp(2026, 8, 3)),
            (r"C:\docs\Statistical Analyses\different.pdf", timestamp(2026, 8, 4)),
        ):
            folder_path, folder_name = folder_metadata(path)
            cur.execute(
                """INSERT INTO files(
                    path, filename, modified_time, created_time, folder_path, folder_name
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (path, os.path.basename(path), date, date, folder_path, folder_name),
            )
        conn.commit()
        upsert_folder_catalog(cur, [
            r"C:\docs\Statistical Analysis\tables.pdf",
            r"C:\docs\Statistical Analysis\module 1\practice.csv",
            r"C:\other\Statistical Analysis\summary.docx",
            r"C:\docs\Statistical Analyses\different.pdf",
        ])
        conn.commit()
        conn.close()

    def test_exact_folder_name_returns_files_and_descendants_without_top_k(self):
        results = folder_search("statistical analysis")
        paths = {row["path"] for row in results}
        self.assertEqual(len(results), 3)
        self.assertIn(r"C:\docs\Statistical Analysis\tables.pdf", paths)
        self.assertIn(r"C:\docs\Statistical Analysis\module 1\practice.csv", paths)
        self.assertIn(r"C:\other\Statistical Analysis\summary.docx", paths)
        self.assertNotIn(r"C:\docs\Statistical Analyses\different.pdf", paths)
        self.assertTrue(all(row["methods"] == ["folder"] for row in results))

    def test_missing_folder_returns_no_results(self):
        self.assertEqual(folder_search("not a real folder"), [])

    def test_partial_and_compact_folder_names_match_separator_variants(self):
        conn = get_connection()
        cur = conn.cursor()
        path = r"C:\docs\Project_Archive\final_report.pdf"
        folder_path, folder_name = folder_metadata(path)
        cur.execute(
            """INSERT INTO files(
                path, filename, modified_time, created_time, folder_path, folder_name
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (path, "final_report.pdf", 1, 1, folder_path, folder_name),
        )
        upsert_folder_catalog(cur, [path])
        conn.commit()
        conn.close()

        expected = {path}
        self.assertEqual({row["path"] for row in folder_search("project")}, expected)
        self.assertEqual({row["path"] for row in folder_search("project archive")}, expected)
        self.assertEqual({row["path"] for row in folder_search("projectarchive")}, expected)
        self.assertEqual({row["path"] for row in folder_search("proj arch")}, expected)

    def test_ancestor_folder_returns_files_from_child_folders(self):
        """A folder with only subfolders must still be searchable by name."""
        paths = (
            r"C:\Users\rudra\Downloads\Sem5\Batch of 2027\Computer Networks\Experiments\experiment.pdf",
            r"C:\Users\rudra\Downloads\Sem5\Batch of 2027\Computer Networks\Study Material\notes.pptx",
        )
        conn = get_connection()
        cur = conn.cursor()
        for path in paths:
            folder_path, folder_name = folder_metadata(path)
            cur.execute(
                """INSERT INTO files(
                    path, filename, modified_time, created_time, folder_path, folder_name
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (path, os.path.basename(path), 1, 1, folder_path, folder_name),
            )
        upsert_folder_catalog(cur, paths)
        conn.commit()
        conn.close()

        results = folder_search("Computer Networks")
        self.assertEqual({row["path"] for row in results}, set(paths))

    def test_init_db_backfills_existing_paths_without_reindexing(self):
        conn = get_connection()
        conn.execute(
            "UPDATE files SET folder_path = NULL, folder_name = NULL WHERE path = ?",
            (r"C:\docs\Statistical Analysis\tables.pdf",),
        )
        conn.commit()
        conn.close()

        init_db()

        conn = get_connection()
        row = conn.execute(
            "SELECT folder_path, folder_name FROM files WHERE path = ?",
            (r"C:\docs\Statistical Analysis\tables.pdf",),
        ).fetchone()
        conn.close()
        self.assertEqual(row, (r"C:\docs\Statistical Analysis", "Statistical Analysis"))


if __name__ == "__main__":
    unittest.main()

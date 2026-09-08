"""Regression tests for metadata routing and high-precision file retrieval."""

import os
import shutil
import sys
import tempfile
import time
import unittest
from datetime import datetime
from unittest.mock import patch

_DATA_DIR = tempfile.mkdtemp(prefix="intellifile-search-test-")
os.environ["IF_DATA_DIR"] = _DATA_DIR

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import get_connection, init_db, rebuild_fts  # noqa: E402
from core.search import _date_range_search, _fts5_search, semantic_search  # noqa: E402


def timestamp(year, month, day):
    return int(time.mktime(datetime(year, month, day).timetuple()))


class SearchRegressionTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_DATA_DIR, ignore_errors=True)

    def setUp(self):
        init_db()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM chunks")
        cur.execute("DELETE FROM files")
        try:
            cur.execute("DELETE FROM chunks_fts")
        except Exception:
            pass

        self.files = {}
        self._add_file(
            cur,
            "C:/docs/Attention-Is-All-You-Need.pdf",
            timestamp(2026, 8, 3),
            "Attention Is All You Need presents the Transformer architecture based only on attention.",
        )
        self._add_file(
            cur,
            "C:/docs/AI Module 1.pdf",
            timestamp(2026, 6, 30),
            "Episodic versus sequential environments describe how an agent's actions affect later states.",
        )
        self._add_file(
            cur,
            "C:/docs/June notes.txt",
            timestamp(2026, 6, 15),
            "design architecture notes",
        )
        self._add_file(
            cur,
            "C:/docs/July notes.txt",
            timestamp(2026, 7, 15),
            "design architecture notes",
        )
        self._add_file(
            cur,
            "C:/docs/August design.txt",
            timestamp(2026, 8, 15),
            "design architecture notes",
        )
        self._add_file(
            cur,
            "C:/docs/Proctoring project.docx",
            timestamp(2026, 6, 20),
            "A real-time proctoring system detects suspicious examination behaviour.",
        )
        self._add_file(
            cur,
            "C:/docs/Student handbook.txt",
            timestamp(2026, 6, 20),
            "The student information system stores course registration details.",
        )
        for index in range(22):
            self._add_file(
                cur,
                f"C:/docs/August-{index}.txt",
                timestamp(2026, 8, 20),
                f"metadata fixture {index}",
            )
        conn.commit()
        conn.close()
        rebuild_fts()

    def _add_file(self, cur, path, created_time, text):
        filename = os.path.basename(path)
        cur.execute(
            "INSERT INTO files(path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            (path, filename, created_time, created_time),
        )
        file_id = cur.lastrowid
        cur.execute(
            "INSERT INTO chunks(file_id, chunk_index, text) VALUES (?, ?, ?)",
            (file_id, 0, text),
        )
        self.files[filename] = cur.lastrowid

    def test_date_only_returns_every_match_not_semantic_top_k(self):
        august = timestamp(2026, 8, 1)
        results = semantic_search("", top_k=1, date_from=august)
        self.assertEqual(len(results), 24)
        self.assertTrue(all(row["created_time"] >= august for row in results))
        self.assertTrue(all(row["methods"] == ["date"] for row in results))

    def test_exclusive_month_boundaries(self):
        july = timestamp(2026, 7, 1)
        august = timestamp(2026, 8, 1)

        before = _date_range_search(None, date_to=july)
        after = _date_range_search(None, date_from=august)
        during = _date_range_search(None, date_from=july, date_to=august)

        self.assertNotIn("July notes.txt", {os.path.basename(row["path"]) for row in before})
        self.assertNotIn("July notes.txt", {os.path.basename(row["path"]) for row in after})
        self.assertEqual({os.path.basename(row["path"]) for row in during}, {"July notes.txt"})

    @patch("core.search._faiss_search", return_value=[])
    def test_exact_title_outranks_partial_keyword_matches(self, _mock_faiss):
        results = semantic_search("Attention Is All You Need", top_k=5)
        self.assertEqual(os.path.basename(results[0]["path"]), "Attention-Is-All-You-Need.pdf")
        self.assertIn("filename", results[0]["methods"])
        self.assertIn("keyword", results[0]["methods"])

    @patch("core.search._faiss_search", return_value=[])
    def test_mixed_query_filters_metadata_before_keyword_ranking(self, _mock_faiss):
        august = timestamp(2026, 8, 1)
        results = semantic_search("design architecture", top_k=10, date_from=august)
        names = {os.path.basename(row["path"]) for row in results}
        self.assertIn("August design.txt", names)
        self.assertNotIn("June notes.txt", names)
        self.assertNotIn("July notes.txt", names)
        self.assertTrue(all(row["created_time"] >= august for row in results))

    @patch("core.search._faiss_search", return_value=[])
    def test_no_evidence_returns_no_results(self, _mock_faiss):
        self.assertEqual(semantic_search("qxzvnonexistenttoken", top_k=10), [])

    def test_adjacent_terms_are_fts_phrases_not_joined_tokens(self):
        hits = _fts5_search("student proctoring system", top_k=10)
        hit_ids = {chunk_id for chunk_id, _score in hits}
        self.assertIn(self.files["Proctoring project.docx"], hit_ids)
        self.assertNotIn(self.files["Student handbook.txt"], hit_ids)


if __name__ == "__main__":
    unittest.main()

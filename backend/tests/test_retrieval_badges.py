"""
Unit tests for search retrieval method badges.
Verifies that search results correctly include the methods used:
'filename', 'keyword', 'semantic', 'ocr', and 'date'.
"""

import os
import sys
import unittest
from unittest.mock import patch
import numpy as np

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import init_db, get_connection, rebuild_fts
from core.search import fuzzy_filename_search, semantic_search, _date_range_search


class TestRetrievalMethodBadges(unittest.TestCase):

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

        # 1. Standard text document
        cur.execute(
            "INSERT INTO files (path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            (r"C:\Documents\quarterly_financial_report.pdf", "quarterly_financial_report.pdf", 1700000000, 1700000000)
        )
        self.fid1 = cur.lastrowid
        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
            (self.fid1, 0, "quarterly financial report revenue growth statement")
        )
        self.cid1 = cur.lastrowid

        # 2. Image document (receipt scanned via OCR)
        cur.execute(
            "INSERT INTO files (path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            (r"C:\Receipts\grocery_store_scan.png", "grocery_store_scan.png", 1700000100, 1700000100)
        )
        self.fid2 = cur.lastrowid
        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
            (self.fid2, 0, "supermarket total amount paid cash receipt")
        )
        self.cid2 = cur.lastrowid

        # 3. File matched by filename only
        cur.execute(
            "INSERT INTO files (path, filename, modified_time, created_time) VALUES (?, ?, ?, ?)",
            (r"C:\Projects\quantum_algorithm_notes.docx", "quantum_algorithm_notes.docx", 1700000200, 1700000200)
        )
        self.fid3 = cur.lastrowid
        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
            (self.fid3, 0, "unrelated text content about cooking recipes")
        )
        self.cid3 = cur.lastrowid

        conn.commit()
        conn.close()
        rebuild_fts()

    def test_date_range_search_includes_date_method(self):
        results = _date_range_search(top_k=5, date_from=1699999999, date_to=1700000300)
        self.assertGreater(len(results), 0)
        for r in results:
            self.assertIn("methods", r)
            self.assertIn("date", r["methods"])

    @patch("core.search._faiss_search", return_value=[])
    def test_filename_match_includes_filename_method(self, mock_faiss):
        results = semantic_search("quantum", top_k=5)
        self.assertGreater(len(results), 0)
        matched = [r for r in results if "quantum_algorithm_notes" in r["path"]]
        self.assertTrue(len(matched) > 0, "Expected to find quantum_algorithm_notes")
        self.assertIn("filename", matched[0]["methods"])

    @patch("core.search._faiss_search", return_value=[])
    def test_image_ocr_text_match_includes_ocr_or_keyword_method(self, mock_faiss):
        results = semantic_search("supermarket", top_k=5)
        self.assertGreater(len(results), 0)
        matched = [r for r in results if "grocery_store_scan.png" in r["path"]]
        self.assertTrue(len(matched) > 0, "Expected to find grocery_store_scan.png")
        self.assertTrue("keyword" in matched[0]["methods"] or "ocr" in matched[0]["methods"])

    @patch("core.search._faiss_search", return_value=[])
    def test_keyword_match_includes_keyword_method(self, mock_faiss):
        results = semantic_search("revenue growth", top_k=5)
        self.assertGreater(len(results), 0)
        matched = [r for r in results if "quarterly_financial_report" in r["path"]]
        self.assertTrue(len(matched) > 0, "Expected to find quarterly_financial_report")
        self.assertIn("keyword", matched[0]["methods"])

    def test_semantic_signal_generates_semantic_badge(self):
        with patch("core.search._faiss_search", return_value=[(self.cid1, 0.85)]):
            with patch("core.search._fts5_search", return_value=[]):
                with patch("core.search._filename_search", return_value=[]):
                    results = semantic_search("concept query", top_k=5)
                    self.assertGreater(len(results), 0)
                    self.assertIn("semantic", results[0]["methods"])

    @patch("core.search._faiss_search", return_value=[(9999, 0.22)])
    def test_gibberish_noise_is_rejected(self, mock_faiss):
        results = semantic_search("gdgdgegnwgwegfwrgczw", top_k=5)
        self.assertEqual(len(results), 0, "Gibberish should return no results")

    @patch("core.search._faiss_search", return_value=[(9999, 0.85)])
    def test_consonant_heavy_gibberish_does_not_call_dense_fallback(self, mock_faiss):
        results = semantic_search("ffgggkggikhggh", top_k=5)
        self.assertEqual(results, [])
        mock_faiss.assert_not_called()

    def test_fuzzy_filename_is_a_separate_strict_fallback(self):
        results = fuzzy_filename_search("quaterly")
        self.assertTrue(results)
        self.assertTrue(any("quarterly_financial_report" in r["path"] for r in results))
        self.assertTrue(all(r["methods"] == ["fuzzy"] for r in results))

    @patch("core.search._faiss_search", return_value=[])
    def test_all_results_have_valid_methods_list(self, mock_faiss):
        results = semantic_search("report", top_k=10)
        for r in results:
            self.assertIn("methods", r)
            self.assertIsInstance(r["methods"], list)
            self.assertGreater(len(r["methods"]), 0)


if __name__ == "__main__":
    unittest.main()


import unittest
import os
import sys
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parsers.word_parser import extract_word_structure
from core.versioning.version_engine import VersionEngine
from core.versioning.snapshot_manager import compare_versions, save_snapshot, get_version_content

class DocVersioningTests(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.doc_path_a = os.path.join(self.test_dir, "test1.doc")
        self.doc_path_b = os.path.join(self.test_dir, "test2.doc")

        # Create mock binary .doc files containing typical OLE2 / Word text chunks
        content_a = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1bjbj\x00\x00\x00\x00ESTIMATE\r\nItem 1: 100\r\nItem 2: 200\r\nTotal: 300"
        content_b = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1bjbj\x00\x00\x00\x00ESTIMATE\r\nItem 1: 150\r\nItem 2: 200\r\nTotal: 350"

        with open(self.doc_path_a, "wb") as f:
            f.write(content_a)
        with open(self.doc_path_b, "wb") as f:
            f.write(content_b)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_doc_format_detected_as_word(self):
        ve = VersionEngine()
        self.assertEqual(ve.detect_format("document.doc"), "word")
        self.assertEqual(ve.detect_format("document.docx"), "word")

    def test_doc_structure_extraction(self):
        struct = extract_word_structure(self.doc_path_a)
        self.assertIn("paragraphs", struct)
        self.assertIn("headings", struct)
        self.assertFalse(struct.get("has_macros", True))
        paras = struct["paragraphs"]
        self.assertTrue(any("ESTIMATE" in p for p in paras))
        self.assertTrue(any("Item 1: 100" in p for p in paras))

    def test_doc_version_engine_diff(self):
        ve = VersionEngine()
        res = ve.process_version(self.doc_path_a, self.doc_path_a, self.doc_path_b)
        self.assertEqual(res["format"], "word")
        diff = res["diff"]
        self.assertTrue(diff.get("is_structured"))
        self.assertEqual(diff.get("format"), "word")
        para_diff = diff.get("para_diff", [])
        self.assertTrue(len(para_diff) > 0)
        # Verify it has modified items
        has_modified_or_added = any(p["type"] in ["modified", "added", "removed"] for p in para_diff)
        self.assertTrue(has_modified_or_added)

if __name__ == "__main__":
    unittest.main()

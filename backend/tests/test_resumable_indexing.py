"""Unit tests for the Resumable Indexing Feature."""

import os
import shutil
import sys
import tempfile
import unittest

# Set up isolated data directory before importing backend modules
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="intellifile-resumable-test-")
os.environ["IF_DATA_DIR"] = _TEST_DATA_DIR

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from core.db import get_connection, init_db, _FAISS_PATH
from core.faiss_manager import load_index, save_index, invalidate_cache
from indexing.update_faiss import update_faiss


class ResumableIndexingTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)

    def setUp(self):
        init_db()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM chunks")
        cur.execute("DELETE FROM files")
        conn.commit()
        conn.close()
        invalidate_cache()

    def test_schema_and_index_created(self):
        """Verify embedded column and idx_chunks_embedded index exist."""
        conn = get_connection()
        cur = conn.cursor()
        
        # Check table info for chunks
        cur.execute("PRAGMA table_info(chunks)")
        columns = {row[1]: row for row in cur.fetchall()}
        self.assertIn("embedded", columns)
        # Default value should be 0
        self.assertEqual(str(columns["embedded"][4]), "0")

        # Check index exists
        cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chunks_embedded'")
        idx_row = cur.fetchone()
        self.assertIsNotNone(idx_row)
        conn.close()

    def test_batched_file_inserts_with_null_chunk_count(self):
        """Verify inserted file rows have chunk_count IS NULL until extracted."""
        conn = get_connection()
        cur = conn.cursor()

        # Insert 3 test files as done in index_files.py step 3
        test_files = [
            (r"C:\test\file1.txt", "file1.txt", "file1txt", 1000, 1000, r"C:\test", "test"),
            (r"C:\test\file2.txt", "file2.txt", "file2txt", 1000, 1000, r"C:\test", "test"),
            (r"C:\test\file3.txt", "file3.txt", "file3txt", 1000, 1000, r"C:\test", "test"),
        ]
        cur.executemany(
            """INSERT INTO files(path, filename, filename_key, modified_time, created_time, folder_path, folder_name)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            test_files,
        )
        conn.commit()

        # Query files needing extraction (self-healing query)
        cur.execute("SELECT path FROM files WHERE chunk_count IS NULL")
        rows = [r[0] for r in cur.fetchall()]
        self.assertEqual(len(rows), 3)
        self.assertIn(r"C:\test\file1.txt", rows)
        conn.close()

    def test_chunk_insertion_defaults_to_unembedded(self):
        """Verify newly inserted chunks default to embedded = 0."""
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO files (path, filename) VALUES ('C:\\test\\a.txt', 'a.txt')")
        file_id = cur.lastrowid

        cur.execute("INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, 0, 'sample text')", (file_id,))
        chunk_id = cur.lastrowid
        conn.commit()

        cur.execute("SELECT embedded FROM chunks WHERE id = ?", (chunk_id,))
        embedded = cur.fetchone()[0]
        self.assertEqual(embedded, 0)
        conn.close()

    def test_faiss_incremental_checkpoint_and_embedded_flag(self):
        """Verify update_faiss embeds chunks and marks them embedded = 1."""
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO files (path, filename) VALUES ('C:\\test\\doc.txt', 'doc.txt')")
        file_id = cur.lastrowid

        cur.execute(
            "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, 0, 'Resumable indexing test sentence.')",
            (file_id,),
        )
        chunk_id = cur.lastrowid
        conn.commit()
        conn.close()

        # Update FAISS
        update_faiss([chunk_id])

        # Verify chunk is now marked embedded = 1
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT embedded FROM chunks WHERE id = ?", (chunk_id,))
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()

        # Verify index was saved to disk
        self.assertTrue(os.path.exists(_FAISS_PATH))
        self.assertGreater(os.path.getsize(_FAISS_PATH), 0)

    def test_update_faiss_resume_none(self):
        """Verify calling update_faiss(None) picks up all chunks with embedded = 0."""
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO files (path, filename) VALUES ('C:\\test\\doc2.txt', 'doc2.txt')")
        file_id = cur.lastrowid

        # Insert 1 already embedded chunk, and 2 un-embedded chunks
        cur.execute("INSERT INTO chunks (file_id, chunk_index, text, embedded) VALUES (?, 0, 'already embedded', 1)", (file_id,))
        cur.execute("INSERT INTO chunks (file_id, chunk_index, text, embedded) VALUES (?, 1, 'needs embedding A', 0)", (file_id,))
        cur.execute("INSERT INTO chunks (file_id, chunk_index, text, embedded) VALUES (?, 2, 'needs embedding B', 0)", (file_id,))
        conn.commit()

        cur.execute("SELECT COUNT(*) FROM chunks WHERE embedded = 0")
        self.assertEqual(cur.fetchone()[0], 2)
        conn.close()

        # Call with None (resumption mode)
        update_faiss(None)

        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM chunks WHERE embedded = 0")
        self.assertEqual(cur.fetchone()[0], 0)

        cur.execute("SELECT COUNT(*) FROM chunks WHERE embedded = 1")
        self.assertEqual(cur.fetchone()[0], 3)
        conn.close()

    def test_startup_resume_query_detection(self):
        """Verify SQL queries correctly identify incomplete indexing states."""
        conn = get_connection()
        cur = conn.cursor()

        # Case 1: Clean state
        cur.execute("SELECT COUNT(*) FROM files WHERE chunk_count IS NULL")
        self.assertEqual(cur.fetchone()[0], 0)
        cur.execute("SELECT COUNT(*) FROM chunks WHERE embedded = 0")
        self.assertEqual(cur.fetchone()[0], 0)

        # Case 2: Unextracted file
        cur.execute("INSERT INTO files (path, filename, chunk_count) VALUES ('C:\\test\\unextracted.txt', 'unextracted.txt', NULL)")
        conn.commit()
        cur.execute("SELECT COUNT(*) FROM files WHERE chunk_count IS NULL")
        self.assertEqual(cur.fetchone()[0], 1)

        # Complete extraction for file
        cur.execute("UPDATE files SET chunk_count = 1 WHERE path = 'C:\\test\\unextracted.txt'")
        file_id = cur.lastrowid
        cur.execute("INSERT INTO chunks (file_id, chunk_index, text, embedded) VALUES (?, 0, 'text', 0)", (file_id,))
        conn.commit()

        # Case 3: Extraction complete, but un-embedded chunk
        cur.execute("SELECT COUNT(*) FROM files WHERE chunk_count IS NULL")
        self.assertEqual(cur.fetchone()[0], 0)
        cur.execute("SELECT COUNT(*) FROM chunks WHERE embedded = 0")
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()

    def test_partial_extraction_resumes_only_remaining_files(self):
        """Verify that when 5 of 10 files are extracted before exit, only the remaining 5 are processed on resume."""
        conn = get_connection()
        cur = conn.cursor()

        # Step 1: 10 files exist on disk and were inserted with chunk_count = NULL
        test_files = {}
        for i in range(1, 11):
            p = f"C:\\test\\file_{i}.txt"
            test_files[p] = (1000, 1000)
            cur.execute(
                "INSERT INTO files (path, filename, modified_time, created_time, chunk_count) VALUES (?, ?, 1000, 1000, NULL)",
                (p, f"file_{i}.txt")
            )
        conn.commit()

        # Step 2: Extraction ran for the first 5 files and committed
        for i in range(1, 6):
            p = f"C:\\test\\file_{i}.txt"
            cur.execute("SELECT id FROM files WHERE path = ?", (p,))
            fid = cur.fetchone()[0]
            cur.execute("INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, 0, ?)", (fid, f"Content of file {i}"))
            cur.execute("UPDATE files SET chunk_count = 1 WHERE id = ?", (fid,))
        conn.commit()

        # App quits abruptly. Next launch occurs:
        # Load DB states and incomplete files as done in index_files_incremental
        cur.execute("SELECT path, modified_time, id FROM files")
        db_states = {row[0]: (row[2], row[1]) for row in cur.fetchall()}

        cur.execute("SELECT files.path FROM files WHERE chunk_count IS NULL")
        files_with_no_chunks = {row[0] for row in cur.fetchall()}

        unchanged_files = 0
        files_to_process = []

        for path, (modified_time, created_time) in test_files.items():
            if path in db_states:
                file_id, old_mtime = db_states[path]
                if old_mtime == modified_time and path not in files_with_no_chunks:
                    unchanged_files += 1
                    continue
                files_to_process.append((path, modified_time, file_id))

        conn.close()

        # Files 1..5 were committed, so they MUST be skipped (unchanged)
        self.assertEqual(unchanged_files, 5)
        # Only files 6..10 MUST be in files_to_process
        self.assertEqual(len(files_to_process), 5)
        processed_paths = [p for p, _, _ in files_to_process]
        for i in range(1, 6):
            self.assertNotIn(f"C:\\test\\file_{i}.txt", processed_paths)
        for i in range(6, 11):
            self.assertIn(f"C:\\test\\file_{i}.txt", processed_paths)


if __name__ == "__main__":
    unittest.main()

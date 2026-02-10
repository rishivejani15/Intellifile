import os
from backend.core.scanner import scan_folder
from backend.core.extractor import extract_text
from backend.core.chunker import chunk_text
from backend.core.db import init_db, get_connection
from backend.core.crypto_utils import encrypt_text
from backend.core.file_state import get_file_state
from tqdm import tqdm

def index_files_incremental(root_folder="test_files"):
    init_db()

    files = scan_folder(root_folder)

    conn = get_connection()
    cur = conn.cursor()

    affected_chunk_ids = []

    for path in files:
        filename = os.path.basename(path)
        modified_time = int(os.path.getmtime(path))

        state, file_id = get_file_state(path)

        if state == "unchanged":
            continue

        if state == "new":
            cur.execute(
                "INSERT INTO files(path, filename, modified_time) VALUES (?, ?, ?)",
                (path, filename, modified_time)
            )
            cur.execute("SELECT id FROM files WHERE path=?", (path,))
            file_id = cur.fetchone()[0]

        elif state == "modified":
            cur.execute("SELECT id FROM chunks WHERE file_id=?", (file_id,))
            old_chunk_ids = [r[0] for r in cur.fetchall()]
            affected_chunk_ids.extend(old_chunk_ids)

            cur.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
            cur.execute(
                "UPDATE files SET modified_time=? WHERE id=?",
                (modified_time, file_id)
            )

        text = extract_text(path)
        if len(text.strip()) < 50:
            continue

        chunks = chunk_text(text)

        for idx, chunk in enumerate(chunks):
            cur.execute(
                "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                (file_id, idx, encrypt_text(chunk))
            )
            affected_chunk_ids.append(cur.lastrowid)

    # Handle deleted files
    cur.execute("SELECT id, path FROM files")
    for file_id, path in cur.fetchall():
        if not os.path.exists(path):
            cur.execute("SELECT id FROM chunks WHERE file_id=?", (file_id,))
            old_chunk_ids = [r[0] for r in cur.fetchall()]
            affected_chunk_ids.extend(old_chunk_ids)

            cur.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
            cur.execute("DELETE FROM files WHERE id=?", (file_id,))

    conn.commit()
    conn.close()
    print("Indexing completed")
    return affected_chunk_ids

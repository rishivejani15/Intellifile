import os
from core.scanner import scan_folder
from core.extractor import extract_text
from core.chunker import chunk_text
from core.db import init_db, get_connection
from core.file_state import get_file_state


def index_files_incremental(root_folder):
    """
    Scan *root_folder*, extract text, chunk, and store in SQLite.
    Returns a list of chunk IDs that were added or modified
    (to be passed to update_faiss).
    """
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
                (path, filename, modified_time),
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
                (modified_time, file_id),
            )

        text = extract_text(path)
        if len(text.strip()) < 50:
            continue

        chunks = chunk_text(text)

        for idx, chunk in enumerate(chunks):
            cur.execute(
                "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)",
                (file_id, idx, chunk),
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
    print(f"Indexing completed — {len(affected_chunk_ids)} chunks affected.")
    return affected_chunk_ids

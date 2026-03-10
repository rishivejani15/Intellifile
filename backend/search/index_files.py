import os
import sys
import time
import uuid
from datetime import datetime
from .scanner import scan_folder
from .extractor import extract_text
from .chunker import chunk_text
from .db import init_db,get_connection
from tqdm import tqdm

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python index_files.py <folder_or_file>")
        sys.exit(1)
    path = sys.argv[1]

    init_db()

    if os.path.isfile(path):
        files = [path]
    else:
        files = scan_folder(path)

    conn = get_connection()
    curr = conn.cursor()

    for path in tqdm(files):
        filename = os.path.basename(path)
        doc_id = str(uuid.uuid4())
        modified_time = int(os.path.getmtime(path))
        
        text = extract_text(path)
        if len(text.strip()) < 50:
            continue
        
        chunks = chunk_text(text)
        
        for idx, chunk_text_data in enumerate(chunks):
            curr.execute(
                "INSERT INTO chunks (doc_id, source_name, page, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", 
                (doc_id, filename, 0, idx, chunk_text_data, datetime.utcnow().isoformat())
            )

    conn.commit()
    conn.close()

    print("Files and chunks indexed successfully!")
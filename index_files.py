import os
import time
from scanner import scan_folder
from extractor import extract_text
from chunker import chunk_text
from db import init_db,get_connection
from tqdm import tqdm

init_db()

files = scan_folder("test_files")

conn = get_connection()
curr = conn.cursor()

for path in tqdm(files):
    filename = os.path.basename(path)
    modified_time = int(os.path.getmtime(path))
    
    curr.execute(
        "INSERT OR IGNORE INTO files(path,filename,modified_time) VALUES(?,?,?)",(path,filename,modified_time)       
    )
    
    curr.execute("SELECT id FROM files WHERE path = ?", (path,))
    file_id = curr.fetchone()[0]
    
    text = extract_text(path)
    if len(text.strip()) < 50:
        continue
    
    chunks = chunk_text(text)
    
    for idx,_ in enumerate(chunks):
        curr.execute(
            "INSERT INTO chunks (file_id, chunk_index) VALUES (?, ?)", (file_id, idx)
        )

conn.commit()
conn.close()

print("Files and chunks indexed successfully!")
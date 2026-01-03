from scanner import scan_folder
from extractor import extract_text
from db import init_db,get_connection
from tqdm import tqdm

init_db()

files = scan_folder("test_files")

conn = get_connection()
curr = conn.cursor()

for path in tqdm(files):
    text = extract_text(path)
    if len(text.strip()) < 50:
        continue
    
    curr.execute(
        "INSERT OR IGNORE INTO files (path, content) VALUES (?, ?)", (path, text)
    )

conn.commit()
conn.close()

print("Files indexed successfully!")
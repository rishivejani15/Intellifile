import sqlite3
import os

def get_connection():
    db_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "chunks.db")
    return sqlite3.connect(db_path)

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    cur.execute('''
                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    doc_id TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    page INTEGER NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                ''')
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)")
    
    conn.commit()
    conn.close()
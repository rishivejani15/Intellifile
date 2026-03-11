import os
import sqlite3

# Resolve data directory relative to this file's location
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(_BACKEND_DIR, 'data', 'files.db')

def get_connection():
    return sqlite3.connect(_DB_PATH)

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    cur.execute('''
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT UNIQUE,
                    filename TEXT,
                    modified_time INTEGER
                );
                ''')
    cur.execute('''
                CREATE TABLE IF NOT EXISTS chunks(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER,
                    chunk_index INTEGER,
                    text TEXT,
                    FOREIGN KEY(file_id) REFERENCES files(id)
                )
                ''')
    
    conn.commit()
    conn.close()
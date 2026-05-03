import os
import sqlite3

# Resolve data directory relative to this file's location
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(_BACKEND_DIR, 'data', 'files.db')

def get_connection():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")   # 64 MB page cache
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    cur.execute('''
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT UNIQUE,
                    filename TEXT,
                    modified_time INTEGER,
                    created_time INTEGER
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

    # Safe migration: add created_time if upgrading from older schema
    try:
        cur.execute("ALTER TABLE files ADD COLUMN created_time INTEGER")
    except Exception:
        pass  # Column already exists

    # Indexes for fast lookups during incremental indexing
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_time)')

    # FTS5 full-text search index (content-synced with chunks table)
    try:
        cur.execute('''
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(text, content=chunks, content_rowid=id)
        ''')
    except Exception:
        pass  # SQLite build without FTS5 — keyword search will be skipped

    conn.commit()
    conn.close()


def rebuild_fts():
    """Rebuild the FTS5 index from the chunks table."""
    conn = get_connection()
    try:
        conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
        conn.commit()
    except Exception:
        pass  # FTS5 not available
    finally:
        conn.close()
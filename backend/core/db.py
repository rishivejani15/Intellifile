import json
import os
import sqlite3


DEFAULT_SETTINGS = {
    "auto_sort_enabled": "false",
    "watched_folders": '["Downloads", "Desktop"]',
    "sort_root": "Sorted",
    "autosort_last_processed_ts": "0",
}

# Resolve data directory relative to this file's location
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(os.getenv("IF_DATA_DIR", os.path.join(_BACKEND_DIR, 'data')), 'files.db')

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

    cur.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                ''')

    cur.execute('''
                CREATE TABLE IF NOT EXISTS sort_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_path TEXT NOT NULL,
                    new_path TEXT NOT NULL,
                    category TEXT,
                    tags TEXT,
                    timestamp REAL,
                    undone INTEGER DEFAULT 0
                )
                ''')

    cur.execute('''
                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                )
                ''')

    cur.execute('''
                CREATE TABLE IF NOT EXISTS file_tags (
                    file_id INTEGER NOT NULL,
                    tag_id INTEGER NOT NULL,
                    PRIMARY KEY (file_id, tag_id),
                    FOREIGN KEY (file_id) REFERENCES files(id),
                    FOREIGN KEY (tag_id) REFERENCES tags(id)
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
    cur.execute('CREATE INDEX IF NOT EXISTS idx_sort_log_timestamp ON sort_log(timestamp)')

    for key, value in DEFAULT_SETTINGS.items():
        cur.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )

    # FTS5 full-text search index with porter stemmer for word-form matching
    # (e.g., "documents" matches "document", "invoices" matches "invoice")
    try:
        # Check if existing FTS table uses porter tokenizer
        cur.execute("SELECT sql FROM sqlite_master WHERE name='chunks_fts'")
        fts_row = cur.fetchone()
        if fts_row and 'porter' not in (fts_row[0] or '').lower():
            # Old FTS table without stemming — drop and recreate
            cur.execute('DROP TABLE IF EXISTS chunks_fts')

        cur.execute('''
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(text, content=chunks, content_rowid=id, tokenize='porter unicode61')
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


def get_setting(key, default=None):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cur.fetchone()
        if not row:
            return default
        return row[0]
    finally:
        conn.close()


def get_setting_bool(key, default=False):
    value = get_setting(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def get_setting_json(key, default=None):
    raw = get_setting(key)
    if raw in (None, ""):
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def set_setting(key, value):
    if isinstance(value, bool):
        serialized = "true" if value else "false"
    elif isinstance(value, (list, dict)):
        serialized = json.dumps(value)
    else:
        serialized = str(value)

    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, serialized),
        )
        conn.commit()
    finally:
        conn.close()
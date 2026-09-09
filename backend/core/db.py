import json
import ntpath
import os
import re
import sqlite3
import unicodedata


DEFAULT_SETTINGS = {
    "auto_sort_enabled": "false",
    "watched_folders": '["Downloads", "Desktop"]',
    "sort_root": "Sorted",
    "autosort_last_processed_ts": "0",
    "index_enabled": "true",
    "telemetry_enabled": "false",
    "auto_update_wifi": "false",
    "auto_model_upgrade": "true",
    "active_model_version": "v1.0.0",
    "active_index_version": "v1.0.0",
    "theme": "system",
}

# Resolve data directory relative to this file's location
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(os.getenv("IF_DATA_DIR", os.path.join(_BACKEND_DIR, 'data')), 'files.db')
_FOLDER_CATALOG_VERSION = "v3"


def normalized_search_key(value):
    """Return a case- and separator-insensitive key for titles and folders."""
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return re.sub(r"[^a-z0-9]+", "", text)


def search_tokens(value):
    """Split a search title into lowercase terms, including CamelCase words."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    return re.findall(r"[a-z0-9]+", text.casefold())


def folder_metadata(path):
    """Return the immediate parent folder metadata for a Windows file path."""
    normalized = str(path or "").rstrip("\\/")
    folder_path = ntpath.dirname(normalized)
    folder_name = ntpath.basename(folder_path.rstrip("\\/")) or folder_path
    return folder_path, folder_name


def folder_ancestors(path):
    """Return every named ancestor of a Windows-style file path.

    ``files.folder_name`` intentionally stores only the immediate parent for
    display and simple filtering.  Folder queries also need the higher-level
    ancestors (for example, ``Computer Networks`` when a file is in
    ``Computer Networks\\Study Material``), so those are kept separately.
    """
    current = ntpath.dirname(str(path or "").rstrip("\\/"))
    ancestors = []
    while current:
        trimmed = current.rstrip("\\/")
        parent = ntpath.dirname(trimmed)
        name = ntpath.basename(trimmed)
        # Stop at a drive root; it has no useful folder name to search.
        if not name or parent == trimmed:
            break
        ancestors.append((trimmed, name, parent.rstrip("\\/")))
        if parent == current:
            break
        current = parent
    return ancestors


def upsert_folder_catalog(cur, paths):
    """Register all ancestors for paths that were added to the file index."""
    rows = []
    seen = set()
    for path in paths:
        for folder_path, folder_name, parent_path in folder_ancestors(path):
            key = folder_path.lower()
            if key not in seen:
                seen.add(key)
                rows.append(
                    (folder_path, folder_name, normalized_search_key(folder_name), parent_path)
                )
    if rows:
        cur.executemany(
            """INSERT INTO indexed_folders(folder_path, folder_name, folder_key, parent_path)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(folder_path) DO UPDATE SET
                 folder_name = excluded.folder_name,
                 folder_key = excluded.folder_key,
                 parent_path = excluded.parent_path""",
            rows,
        )

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
                    created_time INTEGER,
                    chunk_count INTEGER DEFAULT NULL,
                    folder_path TEXT,
                    folder_name TEXT,
                    filename_key TEXT
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
                CREATE TABLE IF NOT EXISTS indexed_folders (
                    folder_path TEXT PRIMARY KEY,
                    folder_name TEXT NOT NULL,
                    folder_key TEXT,
                    parent_path TEXT
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

    cur.execute('''
                CREATE TABLE IF NOT EXISTS analytics_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    event_data TEXT,
                    timestamp REAL NOT NULL
                )
                ''')

    # Safe migration: add created_time if upgrading from older schema
    try:
        cur.execute("ALTER TABLE files ADD COLUMN created_time INTEGER")
    except Exception:
        pass  # Column already exists

    # Safe migration: add chunk_count for self-healing indexing state
    try:
        cur.execute("ALTER TABLE files ADD COLUMN chunk_count INTEGER DEFAULT NULL")
    except Exception:
        pass  # Column already exists

    # Folder metadata enables deterministic folder listings without invoking text or
    # vector retrieval.  It is derived only from the already-indexed path, so
    # this migration does not extract text or recreate embeddings.
    for column in ("folder_path", "folder_name", "filename_key"):
        try:
            cur.execute(f"ALTER TABLE files ADD COLUMN {column} TEXT")
        except Exception:
            pass  # Column already exists

    cur.execute(
        "SELECT id, path FROM files WHERE folder_path IS NULL OR folder_name IS NULL"
    )
    missing_folder_rows = cur.fetchall()
    if missing_folder_rows:
        cur.executemany(
            "UPDATE files SET folder_path = ?, folder_name = ? WHERE id = ?",
            [(*folder_metadata(path), file_id) for file_id, path in missing_folder_rows],
        )

    # This metadata-only migration enables compact filename matching without
    # recreating chunks or embeddings.
    cur.execute("SELECT id, filename FROM files WHERE filename_key IS NULL")
    missing_filename_keys = cur.fetchall()
    if missing_filename_keys:
        cur.executemany(
            "UPDATE files SET filename_key = ? WHERE id = ?",
            [(normalized_search_key(filename), file_id) for file_id, filename in missing_filename_keys],
        )

    try:
        cur.execute("ALTER TABLE indexed_folders ADD COLUMN folder_key TEXT")
    except Exception:
        pass  # Column already exists

    # Indexes for fast lookups during incremental indexing
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_time)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_chunk_count ON files(chunk_count)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_name COLLATE NOCASE)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_filename_key ON files(filename_key)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_files_folder_path ON files(folder_path)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_indexed_folders_name ON indexed_folders(folder_name COLLATE NOCASE)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_indexed_folders_key ON indexed_folders(folder_key)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_sort_log_timestamp ON sort_log(timestamp)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp)')

    for key, value in DEFAULT_SETTINGS.items():
        cur.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )

    # One metadata-only migration fills ancestor folders for files indexed by
    # earlier app versions.  It neither reads document content nor creates
    # embeddings, so existing retrieval scores remain untouched.
    cur.execute("SELECT value FROM settings WHERE key = ?", ("folder_catalog_version",))
    catalog_version = cur.fetchone()
    if not catalog_version or catalog_version[0] != _FOLDER_CATALOG_VERSION:
        cur.execute("SELECT path FROM files")
        upsert_folder_catalog(cur, [row[0] for row in cur.fetchall()])
        cur.execute(
            """INSERT INTO settings(key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            ("folder_catalog_version", _FOLDER_CATALOG_VERSION),
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
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, serialized),
        )
        conn.commit()
    finally:
        conn.close()


def log_analytics_event(event_type: str, event_data: dict = None) -> bool:
    """Log an offline analytics event if telemetry_enabled is set to true."""
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key='telemetry_enabled'")
        row = cur.fetchone()
        telemetry_enabled = row and str(row[0]).strip().lower() in ("true", "1", "yes")
        if not telemetry_enabled:
            conn.close()
            return False

        import time
        data_str = json.dumps(event_data) if event_data else None
        cur.execute(
            "INSERT INTO analytics_events (event_type, event_data, timestamp) VALUES (?, ?, ?)",
            (event_type, data_str, time.time())
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        import sys
        sys.stderr.write(f"[db] log_analytics_event error: {e}\n")
        return False


def get_analytics_summary() -> dict:
    """Return offline analytics summary counts and recent event logs."""
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT event_type, COUNT(*) FROM analytics_events GROUP BY event_type")
        counts = dict(cur.fetchall())

        cur.execute("SELECT event_type, event_data, timestamp FROM analytics_events ORDER BY id DESC LIMIT 20")
        recent = []
        for r in cur.fetchall():
            recent.append({
                "event_type": r[0],
                "event_data": json.loads(r[1]) if r[1] else None,
                "timestamp": r[2]
            })
        conn.close()
        return {"success": True, "counts": counts, "recent": recent}
    except Exception as e:
        return {"success": False, "error": str(e), "counts": {}, "recent": []}


def clear_analytics_events() -> dict:
    """Purge all analytics events from database."""
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM analytics_events")
        conn.commit()
        conn.close()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

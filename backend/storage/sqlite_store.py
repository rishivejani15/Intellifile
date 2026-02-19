
import sqlite3
import os
import logging
from typing import List, Optional, Tuple
from models import ChunkMetadata

class SQLiteStore:
    def __init__(self, db_path: str = "data/chunks.db"):
        self.db_path = db_path
        self._ensure_db()

    def _ensure_db(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL,
                source_name TEXT NOT NULL,
                page INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)")
        conn.commit()
        conn.close()

    def _get_conn(self):
        return sqlite3.connect(self.db_path)

    def insert_chunks(self, chunks: List[ChunkMetadata]) -> List[int]:
        """
        Inserts chunks and returns their auto-incremented IDs.
        """
        conn = self._get_conn()
        cursor = conn.cursor()
        ids = []
        try:
            for chunk in chunks:
                cursor.execute("""
                    INSERT INTO chunks (doc_id, source_name, page, chunk_index, text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    chunk.doc_id, 
                    chunk.source_name, 
                    chunk.page, 
                    chunk.chunk_index, 
                    chunk.text, 
                    chunk.created_at
                ))
                ids.append(cursor.lastrowid)
            conn.commit()
        except Exception as e:
            conn.rollback()
            logging.error(f"Failed to insert chunks: {e}")
            raise
        finally:
            conn.close()
        return ids

    def get_chunks(self, ids: List[int]) -> List[ChunkMetadata]:
        if not ids:
            return []
        
        chunk_map = {}
        placeholders = ','.join(['?'] * len(ids))
        conn = self._get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute(f"SELECT * FROM chunks WHERE id IN ({placeholders})", ids)
            rows = cursor.fetchall()
            for row in rows:
                c = ChunkMetadata(
                    id=row['id'],
                    doc_id=row['doc_id'],
                    source_name=row['source_name'],
                    page=row['page'],
                    chunk_index=row['chunk_index'],
                    text=row['text'],
                    created_at=row['created_at']
                )
                chunk_map[c.id] = c
        finally:
            conn.close()
            
        # Return in same order as requested ids, filtering missing
        return [chunk_map[i] for i in ids if i in chunk_map]

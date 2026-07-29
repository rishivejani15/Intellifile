"""
Local storage for files with version control
"""

import os
import json
import shutil
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime
import sqlite3


class LocalStore:
    """Local file storage with version control"""
    
    def __init__(self, base_path: str):
        """
        Initialize local store
        
        Args:
            base_path: Base directory for storage
        """
        self.base_path = base_path
        self.versions_path = os.path.join(base_path, '.versions')
        self.metadata_path = os.path.join(base_path, '.metadata')
        self.db_path = os.path.join(base_path, '.store.db')
        
        self._init_storage()
        self._init_database()
    
    def _init_storage(self):
        """Initialize storage directories"""
        os.makedirs(self.versions_path, exist_ok=True)
        os.makedirs(self.metadata_path, exist_ok=True)
    
    def _init_database(self):
        """Initialize SQLite database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS files (
                file_id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP,
                modified_at TIMESTAMP,
                size INTEGER,
                hash TEXT
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS versions (
                version_id TEXT PRIMARY KEY,
                file_id TEXT,
                version_number INTEGER,
                content_hash TEXT,
                created_at TIMESTAMP,
                author TEXT,
                message TEXT,
                FOREIGN KEY (file_id) REFERENCES files(file_id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS metadata (
                file_id TEXT,
                key TEXT,
                value TEXT,
                PRIMARY KEY (file_id, key),
                FOREIGN KEY (file_id) REFERENCES files(file_id)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def save_file(self, relative_path: str, content: str, author: str = "system",
                  message: str = "") -> Dict[str, Any]:
        """
        Save file with version control
        
        Args:
            relative_path: Relative path within storage
            content: File content
            author: Author of changes
            message: Commit message
            
        Returns:
            File info dict
        """
        full_path = os.path.join(self.base_path, relative_path)
        file_id = self._get_file_id(relative_path)
        
        # Create directories if needed
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # Calculate hash
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        
        # Save current version
        version_number = self._get_next_version_number(file_id)
        version_id = f"{file_id}_v{version_number}"
        
        version_path = os.path.join(self.versions_path, version_id)
        with open(version_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Save to actual file location
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Update database
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Update or insert file record
        cursor.execute('''
            INSERT OR REPLACE INTO files (file_id, path, created_at, modified_at, size, hash)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (file_id, relative_path, datetime.now(), datetime.now(), len(content), content_hash))
        
        # Insert version record
        cursor.execute('''
            INSERT INTO versions (version_id, file_id, version_number, content_hash, created_at, author, message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (version_id, file_id, version_number, content_hash, datetime.now(), author, message))
        
        conn.commit()
        conn.close()
        
        return {
            'file_id': file_id,
            'path': relative_path,
            'version': version_number,
            'hash': content_hash
        }
    
    def load_file(self, relative_path: str) -> Optional[str]:
        """
        Load file content as UTF-8 text if possible, else return None for binary files.
        Args:
            relative_path: Relative path within storage
        Returns:
            File content or None
        """
        full_path = os.path.join(self.base_path, relative_path)
        if not os.path.exists(full_path):
            return None
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # Not a text file
            return None
    
    def load_version(self, relative_path: str, version_number: int) -> Optional[str]:
        """
        Load specific version of a file
        
        Args:
            relative_path: Relative path within storage
            version_number: Version number to load
            
        Returns:
            File content or None
        """
        file_id = self._get_file_id(relative_path)
        version_id = f"{file_id}_v{version_number}"
        version_path = os.path.join(self.versions_path, version_id)
        
        if not os.path.exists(version_path):
            return None
        
        with open(version_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    def get_file_info(self, relative_path: str) -> Optional[Dict[str, Any]]:
        """Get file information"""
        file_id = self._get_file_id(relative_path)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM files WHERE file_id = ?', (file_id,))
        row = cursor.fetchone()
        
        conn.close()
        
        if not row:
            return None
        
        return {
            'file_id': row[0],
            'path': row[1],
            'created_at': row[2],
            'modified_at': row[3],
            'size': row[4],
            'hash': row[5]
        }
    
    def get_versions(self, relative_path: str) -> List[Dict[str, Any]]:
        """Get all versions of a file"""
        file_id = self._get_file_id(relative_path)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT version_id, version_number, content_hash, created_at, author, message
            FROM versions
            WHERE file_id = ?
            ORDER BY version_number DESC
        ''', (file_id,))
        
        versions = []
        for row in cursor.fetchall():
            versions.append({
                'version_id': row[0],
                'version_number': row[1],
                'content_hash': row[2],
                'created_at': row[3],
                'author': row[4],
                'message': row[5]
            })
        
        conn.close()
        return versions
    
    def set_metadata(self, relative_path: str, key: str, value: str):
        """Set metadata for a file"""
        file_id = self._get_file_id(relative_path)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO metadata (file_id, key, value)
            VALUES (?, ?, ?)
        ''', (file_id, key, value))
        
        conn.commit()
        conn.close()
    
    def get_metadata(self, relative_path: str, key: str = None) -> Any:
        """Get metadata for a file"""
        file_id = self._get_file_id(relative_path)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if key:
            cursor.execute('SELECT value FROM metadata WHERE file_id = ? AND key = ?', (file_id, key))
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else None
        else:
            cursor.execute('SELECT key, value FROM metadata WHERE file_id = ?', (file_id,))
            metadata = {row[0]: row[1] for row in cursor.fetchall()}
            conn.close()
            return metadata
    
    def list_files(self, pattern: str = None) -> List[str]:
        """List all files in storage"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if pattern:
            cursor.execute('SELECT path FROM files WHERE path LIKE ?', (f'%{pattern}%',))
        else:
            cursor.execute('SELECT path FROM files')
        
        files = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        return files
    
    def _get_file_id(self, relative_path: str) -> str:
        """Generate file ID from path"""
        return hashlib.md5(relative_path.encode()).hexdigest()
    
    def _get_next_version_number(self, file_id: str) -> int:
        """Get next version number for file"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT MAX(version_number) FROM versions WHERE file_id = ?', (file_id,))
        row = cursor.fetchone()
        
        conn.close()
        
        return (row[0] or 0) + 1


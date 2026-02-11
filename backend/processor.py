
import os
import sqlite3
import fitz  # PyMuPDF
import logging
from typing import List, Tuple
from model import EmbeddingModel, FAISSManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage.db")

class TextSplitter:
    def __init__(self, chunk_size=800, chunk_overlap=100):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> List[str]:
        final_chunks = []
        if self._length_function(text) <= self.chunk_size:
            return [text]
        
        self._split_text(text, self.separators, final_chunks)
        return final_chunks

    def _length_function(self, text: str) -> int:
        return len(text)

    def _split_text(self, text: str, separators: List[str], final_chunks: List[str]):
        """
        Recursively split text by separators until chunks are small enough.
        """
        # Find the best separator to use
        separator = separators[-1]
        for sep in separators:
            if sep == "":
                separator = ""
                break
            if sep in text:
                separator = sep
                break
        
        # Split
        if separator:
            splits = text.split(separator)
        else:
            splits = list(text) # Split by character

        # Merge splits into chunks
        current_chunk = []
        current_len = 0
        
        for split in splits:
            split_len = self._length_function(split)
            # If a single split is too large, recurse on it with next separator
            if split_len > self.chunk_size:
                # If we have accumulated content, flush it first
                if current_chunk:
                    final_chunks.append(separator.join(current_chunk))
                    current_chunk = []
                    current_len = 0
                
                # Recurse if we have more separators
                # Use next separator index
                next_sep_idx = separators.index(separator) + 1
                if next_sep_idx < len(separators):
                    self._split_text(split, separators[next_sep_idx:], final_chunks)
                else:
                    # Fallback (should ideally not happen if "" is last separator)
                    final_chunks.append(split[:self.chunk_size])
                continue

            # Add to current chunk if it fits
            # Add separator length if not the first item
            sep_len = len(separator) if current_chunk else 0
            if current_len + sep_len + split_len > self.chunk_size:
                final_chunks.append(separator.join(current_chunk))
                
                # Handle overlap - simplistic approach: keep last item? 
                # For simplicity here, we won't implement complex overlap logic 
                # unless strictly needed, usually recursive splitting is enough.
                # Starting new chunk with current split
                current_chunk = [split]
                current_len = split_len
            else:
                current_chunk.append(split)
                current_len += sep_len + split_len
        
        if current_chunk:
            final_chunks.append(separator.join(current_chunk))


class Processor:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._init_db()
        self.splitter = TextSplitter(chunk_size=800, chunk_overlap=100)
        self.embedder = EmbeddingModel()
        self.faiss_manager = FAISSManager()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT,
                chunk_index INTEGER,
                content TEXT
            )
        """)
        conn.commit()
        conn.close()

    def process_pdf(self, file_path: str):
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        logger.info(f"Processing PDF: {file_path}")
        
        doc = fitz.open(file_path)
        full_text = ""
        for page in doc:
            full_text += page.get_text() + "\n"
        
        if not full_text.strip():
            logger.warning(f"No text extracted from {file_path}")
            return

        chunks = self.splitter.split_text(full_text)
        logger.info(f"Generated {len(chunks)} chunks.")

        # Batch insert into SQLite to get IDs
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        chunk_ids = []
        for i, chunk in enumerate(chunks):
            cursor.execute(
                "INSERT INTO chunks (file_path, chunk_index, content) VALUES (?, ?, ?)",
                (file_path, i, chunk)
            )
            chunk_ids.append(cursor.lastrowid)
        
        conn.commit()
        conn.close()

        # Generate Embeddings
        logger.info("Generating embeddings...")
        embeddings = self.embedder.encode(chunks)
        
        # Add to FAISS
        logger.info("Adding to FAISS index...")
        self.faiss_manager.add_vectors(embeddings, chunk_ids)
        
        logger.info("Processing complete.")
        return len(chunks)

    def get_chunks_by_ids(self, ids: List[int]) -> List[str]:
        if not ids:
            return []
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Dynamically build query placeholder
        placeholders = ','.join(['?'] * len(ids))
        query = f"SELECT content FROM chunks WHERE id IN ({placeholders})"
        
        cursor.execute(query, ids)
        results = cursor.fetchall()
        
        conn.close()
        return [r[0] for r in results]

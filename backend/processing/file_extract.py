
import os
import logging
from typing import List, Tuple
from pypdf import PdfReader
import docx

class FileExtractor:
    @staticmethod
    def extract(file_path: str) -> List[Tuple[int, str]]:
        """
        Extracts content from a file (PDF, DOCX, TXT).
        Returns a list of (page_number_1-based, text).
        For TXT, page number is always 1.
        """
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext == ".pdf":
            return FileExtractor._extract_pdf(file_path)
        elif ext == ".docx":
            return FileExtractor._extract_docx(file_path)
        elif ext == ".txt":
            return FileExtractor._extract_txt(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")

    @staticmethod
    def _extract_pdf(file_path: str) -> List[Tuple[int, str]]:
        results = []
        try:
            reader = PdfReader(file_path)
            for i, page in enumerate(reader.pages):
                text = page.extract_text()
                if text:
                    results.append((i + 1, text))
        except Exception as e:
            logging.error(f"Failed to extract PDF {file_path}: {e}")
            raise
        return results

    @staticmethod
    def _extract_docx(file_path: str) -> List[Tuple[int, str]]:
        results = []
        try:
            doc = docx.Document(file_path)
            full_text = []
            for para in doc.paragraphs:
                full_text.append(para.text)
            
            text = "\n".join(full_text)
            if text:
                results.append((1, text))
        except Exception as e:
            logging.error(f"Failed to extract DOCX {file_path}: {e}")
            raise
        return results

    @staticmethod
    def _extract_txt(file_path: str) -> List[Tuple[int, str]]:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
                if text:
                    return [(1, text)]
        except Exception as e:
            logging.error(f"Failed to extract TXT {file_path}: {e}")
            raise
        return []

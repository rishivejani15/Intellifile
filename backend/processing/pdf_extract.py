
import logging
from pypdf import PdfReader
from typing import List, Tuple

class PDFExtractor:
    @staticmethod
    def extract_from_file(file_path: str) -> List[Tuple[int, str]]:
        """
        Extracts content from a PDF file.
        Returns a list of (page_number_1-based, text).
        """
        results = []
        try:
            reader = PdfReader(file_path)
            for i, page in enumerate(reader.pages):
                text = page.extract_text()
                if text:
                    results.append((i + 1, text))
        except Exception as e:
            logging.error(f"Failed to extract PDF: {file_path}, {e}")
            raise
        return results

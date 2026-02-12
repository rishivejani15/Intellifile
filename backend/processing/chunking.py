
from typing import List

class TextChunker:
    @staticmethod
    def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
        if not text:
            return []
        
        chunks = []
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = min(start + chunk_size, text_len)
            
            # If we're not at end, try to break at last whitespace
            if end < text_len:
                # Find last whitespace in overlap window
                space_found = False
                for i in range(end, end - overlap, -1):
                    if text[i].isspace():
                         end = i
                         space_found = True
                         break
                if not space_found:
                    # just hard break
                    pass
            
            chunk = text[start:end].strip()
            if len(chunk) >= 30: # Minimum useful length filter
                chunks.append(chunk)

            start += chunk_size - overlap
            
        return chunks

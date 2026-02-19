
import re
from typing import List

class TextChunker:
    @staticmethod
    def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
        """
        Robust text chunking preserving structure.
        """
        if not text:
            return []
        
        # Minimal cleaning: normalize whitespace but keep paragraph structure
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        chunks = []
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = min(start + chunk_size, text_len)
            
            if end < text_len:
                search_start = max(start + chunk_size//2, end - overlap)
                best_break = -1
                
                # Check for \n\n
                last_paragraph = text.rfind('\n\n', search_start, end)
                if last_paragraph != -1:
                    best_break = last_paragraph + 2
                else:
                    # Check for sentence ending
                    match = re.search(r'[.?!][\s\n]', text[search_start:end])
                    if match:
                         for i in range(end-1, search_start, -1):
                             if text[i] in '.?!' and (i+1 < len(text) and text[i+1].isspace()):
                                 best_break = i + 1
                                 break
                    
                    if best_break == -1:
                        last_space = text.rfind(' ', search_start, end)
                        if last_space != -1:
                            best_break = last_space + 1
            
                if best_break != -1:
                    end = best_break
            
            chunk = text[start:end].strip()
            if len(chunk) > 50:
                chunks.append(chunk)
            
            next_start = end - overlap
            if next_start <= start:
                next_start = start + chunk_size
                
            start = max(start + 1, next_start)
            
        return chunks

import zipfile
import re
import os
from docx import Document

def _extract_doc_binary_text(file_path):
    """
    Fallback extractor for legacy binary .doc files or corrupted documents.
    Extracts text runs from binary stream and cleans formatting artifacts.
    """
    try:
        with open(file_path, "rb") as f:
            data = f.read()

        lines = []
        pattern = re.compile(rb'[\x20-\x7E\r\n\t]{4,}')
        for match in pattern.finditer(data):
            raw = match.group()
            try:
                text = raw.decode("latin1").strip()
                if any(text.startswith(p) for p in ["bjbj", "Microsoft", "Times New", "Calibri", "Normal", "Default", "Table Grid"]):
                    continue
                if len(text) >= 2 and any(c.isalnum() for c in text):
                    lines.append(text)
            except Exception:
                pass

        cleaned = []
        seen = set()
        for l in lines:
            if l not in seen:
                seen.add(l)
                cleaned.append(l)

        headings = [l for l in cleaned if len(l) < 60 and (l.isupper() or l.startswith("Sub :"))]
        return {
            "paragraphs": cleaned,
            "headings": headings,
            "tables": [],
            "has_macros": False
        }
    except Exception as e:
        print(f"[WordParser] Binary fallback error: {e}")
        return {
            "paragraphs": [],
            "headings": [],
            "tables": [],
            "has_macros": False
        }

def extract_word_structure(file_path):
    """
    Extracts paragraphs, headings, and tables from .docx and .doc files.
    """
    if not file_path or not os.path.exists(file_path):
        return {
            "paragraphs": [],
            "headings": [],
            "tables": [],
            "has_macros": False
        }

    lower = file_path.lower()
    if lower.endswith(".doc") and not lower.endswith(".docx"):
        return _extract_doc_binary_text(file_path)

    has_macros = False
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            if 'word/vbaProject.bin' in z.namelist():
                has_macros = True
    except Exception:
        pass

    try:
        doc = Document(file_path)

        paragraphs = []
        headings = []
        tables = []

        # 1. Extract Normal Paragraphs
        for i, para in enumerate(doc.paragraphs):
            # Extract raw text first - THIS IS SACRED
            raw_text = para.text.strip()
            
            # Look for special objects (Images, Breaks)
            has_image = any('w:drawing' in r.element.xml or 'w:pict' in r.element.xml for r in para.runs)
            has_break = any('w:br' in r.element.xml or 'w:lastRenderedPageBreak' in r.element.xml for r in para.runs)
            
            final_text = raw_text
            
            # If there's no text but there is a graphic, tag it
            if not raw_text:
                if has_image:
                    final_text = "[IMAGE / GRAPHIC]"
                elif has_break:
                    final_text = "[PAGE BREAK / SECTION]"
                else:
                    # Truly empty line with no objects - skip to avoid clutter
                    continue
            else:
                # If there IS text AND an image in the same block, keep the text!
                if has_image:
                    final_text = f"{raw_text} [Graphic Attached]"

            # Track headings for the forensic summary
            if para.style.name.startswith("Heading"):
                headings.append(final_text)
            
            paragraphs.append(final_text)
        
        # 1.5. POST-EXTRACTION SANITIZATION (The 'Anti-Ghosting' Filter)
        while paragraphs and (not paragraphs[0] or paragraphs[0] in ["[IMAGE / GRAPHIC]", "[PAGE BREAK / SECTION]"]):
            if not paragraphs[0].strip():
                paragraphs.pop(0)
            else:
                break

        # 2. Extract Table Content (Crucial for bordered/tabular docs)
        for table in doc.tables:
            table_data = []
            for row in table.rows:
                row_cells = []
                for cell in row.cells:
                    cell_text = cell.text.strip()
                    if cell_text:
                        paragraphs.append(f"[TABLE CELL]: {cell_text}")
                        row_cells.append(cell_text)
                table_data.append(row_cells)
            tables.append(table_data)

        return {
            "paragraphs": paragraphs,
            "headings": headings,
            "tables": tables,
            "has_macros": has_macros
        }
    except Exception as e:
        print(f"[WordParser] Error: {str(e)} - falling back to binary text extraction")
        fallback = _extract_doc_binary_text(file_path)
        fallback["has_macros"] = has_macros
        return fallback
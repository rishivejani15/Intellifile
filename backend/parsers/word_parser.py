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

import hashlib
import base64

def extract_docx_images(file_path):
    """
    Extracts embedded images from a .docx file and returns a dict mapping:
    image_hash -> data_url
    and
    rel_id -> data_url
    Fast, safe, and storage-friendly (computed only on demand for diff viewer).
    """
    images = {}
    if not file_path or not os.path.exists(file_path):
        return images

    # 1. Try python-docx
    try:
        doc = Document(file_path)
        if hasattr(doc, 'part') and hasattr(doc.part, 'related_parts'):
            for rel_id, part in doc.part.related_parts.items():
                partname = str(getattr(part, 'partname', ''))
                blob = getattr(part, 'blob', None)
                if blob and len(blob) <= 15 * 1024 * 1024:
                    h = hashlib.sha256(blob).hexdigest()
                    ext = partname.split('.')[-1].lower() if '.' in partname else 'png'
                    mime = 'image/jpeg' if ext in ['jpg', 'jpeg'] else f'image/{ext}'
                    b64 = base64.b64encode(blob).decode('ascii')
                    data_url = f"data:{mime};base64,{b64}"
                    images[h] = data_url
                    images[rel_id] = data_url
    except Exception:
        pass

    # 2. Fallback: direct ZIP inspection for word/media/*
    try:
        if zipfile.is_zipfile(file_path):
            with zipfile.ZipFile(file_path, 'r') as z:
                for name in z.namelist():
                    if name.startswith('word/media/'):
                        data = z.read(name)
                        if data and len(data) <= 15 * 1024 * 1024:
                            h = hashlib.sha256(data).hexdigest()
                            if h not in images:
                                ext = name.split('.')[-1].lower() if '.' in name else 'png'
                                mime = 'image/jpeg' if ext in ['jpg', 'jpeg'] else f'image/{ext}'
                                b64 = base64.b64encode(data).decode('ascii')
                                images[h] = f"data:{mime};base64,{b64}"
    except Exception:
        pass

    return images


def _get_para_image_details(para, doc):
    relationship_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
    v_id_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    images = []
    try:
        for element in para._p.iter():
            tag = element.tag.rsplit("}", 1)[-1]
            rel_id = None
            if tag == "blip":
                rel_id = element.get(relationship_ns)
            elif tag == "imagedata":
                rel_id = element.get(v_id_ns)
            if rel_id and hasattr(doc, "part") and hasattr(doc.part, "related_parts"):
                part = doc.part.related_parts.get(rel_id)
                if part:
                    partname = str(getattr(part, 'partname', ''))
                    blob = getattr(part, 'blob', None)
                    if blob:
                        img_hash = hashlib.sha256(blob).hexdigest()
                        images.append({
                            "type": "image",
                            "element_type": "image",
                            "image_hash": img_hash,
                            "image_name": os.path.basename(partname) or "graphic.png",
                            "rel_id": rel_id,
                            "size_bytes": len(blob),
                            "text": "[IMAGE / GRAPHIC]"
                        })
    except Exception:
        pass
    return images


def extract_word_structure(file_path):
    """
    Extracts paragraphs, headings, tables, and image metadata from .docx and .doc files.
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
            
            img_details = _get_para_image_details(para, doc) if has_image else []
            final_text = raw_text
            
            # If there's no text but there is a graphic, tag it with image metadata
            if not raw_text:
                if img_details:
                    for img in img_details:
                        paragraphs.append(img)
                    continue
                elif has_image:
                    paragraphs.append({
                        "type": "image",
                        "element_type": "image",
                        "image_hash": "",
                        "image_name": "graphic.png",
                        "text": "[IMAGE / GRAPHIC]"
                    })
                    continue
                elif has_break:
                    final_text = "[PAGE BREAK / SECTION]"
                else:
                    # Truly empty line with no objects - skip to avoid clutter
                    continue
            else:
                # If there IS text AND an image in the same block, keep text and record image
                if has_image:
                    final_text = f"{raw_text} [Graphic Attached]"
                    paragraphs.append(final_text)
                    for img in img_details:
                        paragraphs.append(img)
                    if para.style.name.startswith("Heading"):
                        headings.append(final_text)
                    continue

            # Track headings for the forensic summary
            if para.style.name.startswith("Heading"):
                headings.append(final_text)
            
            paragraphs.append(final_text)
        
        # 1.5. POST-EXTRACTION SANITIZATION (The 'Anti-Ghosting' Filter)
        while paragraphs:
            p0 = paragraphs[0]
            if isinstance(p0, str) and not p0.strip():
                paragraphs.pop(0)
            elif isinstance(p0, str) and p0 in ["[IMAGE / GRAPHIC]", "[PAGE BREAK / SECTION]"]:
                break
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
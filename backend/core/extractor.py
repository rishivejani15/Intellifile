from pypdf import PdfReader
from docx import Document

from core.access_control import check_read_access, classify_access_error

# Cap extracted text to ~100K chars (~20K words) to avoid huge files
# dominating indexing time. The chunker will further limit chunks.
_MAX_TEXT_CHARS = 100_000


def _extract_xlsx(path):
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    parts = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None]
            if cells:
                parts.append(" ".join(cells))
    wb.close()
    return "\n".join(parts)


def _extract_pptx(path):
    from pptx import Presentation
    prs = Presentation(path)
    parts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    cells = [cell.text for cell in row.cells if cell.text.strip()]
                    if cells:
                        parts.append(" ".join(cells))
    return "\n".join(parts)

def _extract_image(path):
    try:
        from PIL import Image
        # Disable DecompressionBombWarning for large screenshots/scans
        Image.MAX_IMAGE_PIXELS = None
        
        from PIL.ExifTags import TAGS
        import winocr
        with Image.open(path) as img:
            # Check EXIF metadata for camera signatures
            try:
                exif_data = img._getexif()
                if exif_data:
                    for tag_id, value in exif_data.items():
                        tag = TAGS.get(tag_id, tag_id)
                        if tag in ('Make', 'Model', 'LensModel', 'Software'):
                            # Likely a camera photo or photo edited in Lightroom/Photoshop
                            # Skip OCR extraction
                            return ""
            except Exception:
                pass
            result = winocr.recognize_pil_sync(img)
            return result.get("text", "")
    except Exception as exc:
        import sys
        sys.stderr.write(f"[extractor] OCR failed for {path}: {exc}\n")
        sys.stderr.flush()
        return ""


import io
import re
from collections import Counter


def strip_headers_and_footers(pages_text: list[str]) -> list[str]:
    """
    Detects and removes recurring headers/footers across consecutive pages in multi-page documents.
    Only applies if there are at least 3 pages.
    """
    if len(pages_text) < 3:
        return pages_text

    page_lines_list = []
    for p in pages_text:
        lines = [line.strip() for line in p.splitlines() if line.strip()]
        page_lines_list.append(lines)

    valid_pages = [lines for lines in page_lines_list if lines]
    if len(valid_pages) < 3:
        return pages_text

    def normalize_header_footer(line: str) -> str:
        # Replace digits with '#' to catch 'Page 1 of 10', 'Page 2 of 10', etc.
        return re.sub(r'\d+', '#', line.strip().lower())

    top_patterns = Counter()
    bottom_patterns = Counter()
    for lines in valid_pages:
        if lines:
            top_patterns[normalize_header_footer(lines[0])] += 1
            bottom_patterns[normalize_header_footer(lines[-1])] += 1

    threshold = len(valid_pages) * 0.5

    recurring_headers = {pat for pat, count in top_patterns.items() if count >= threshold}
    recurring_footers = {pat for pat, count in bottom_patterns.items() if count >= threshold}

    if not recurring_headers and not recurring_footers:
        return pages_text

    result = []
    for lines in page_lines_list:
        if not lines:
            result.append("")
            continue
        start_idx = 0
        end_idx = len(lines)
        if lines and normalize_header_footer(lines[0]) in recurring_headers:
            start_idx = 1
        if lines and end_idx > start_idx and normalize_header_footer(lines[-1]) in recurring_footers:
            end_idx -= 1
        result.append("\n".join(lines[start_idx:end_idx]))

    return result


def fix_spaced_text(text: str) -> str:
    """
    Detects and repairs PDFs where characters have artificial tracking/spacing,
    e.g. 'J A I N I K A   C H H E D A' -> 'JAINIKA CHHEDA'.
    """
    if not text:
        return ""
    lines = text.split('\n')
    fixed_lines = []
    for line in lines:
        single_chars = re.findall(r'\b[A-Za-z0-9]\b', line)
        words = line.split()
        if len(words) > 4 and len(single_chars) / len(words) > 0.5:
            temp = re.sub(r'[ \t]{2,}', '\t', line)
            prev = None
            while prev != temp:
                prev = temp
                temp = re.sub(r'(?<=\b[A-Za-z0-9]) (?=[A-Za-z0-9]\b)', '', temp)
            temp = temp.replace('\t', ' ')
            fixed_lines.append(temp)
        else:
            fixed_lines.append(line)
    return '\n'.join(fixed_lines)


def _ocr_pdf_pages(reader, max_pages=10) -> list[str]:
    """Fallback OCR for scanned or image-based PDFs with little or no digital text."""
    try:
        import winocr
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None

        ocr_pages = []
        total_len = 0
        for page in reader.pages[:max_pages]:
            page_parts = []
            for img_file in getattr(page, "images", []):
                try:
                    pil_img = Image.open(io.BytesIO(img_file.data))
                    res = winocr.recognize_pil_sync(pil_img)
                    t = res.get("text", "")
                    if t and t.strip():
                        page_parts.append(t.strip())
                except Exception:
                    pass
            page_text = "\n".join(page_parts)
            ocr_pages.append(page_text)
            total_len += len(page_text)
            if total_len >= _MAX_TEXT_CHARS:
                break
        return ocr_pages
    except Exception as exc:
        import sys
        sys.stderr.write(f"[extractor] Scanned PDF OCR fallback failed: {exc}\n")
        sys.stderr.flush()
        return []


def _extract_pdf_pages(reader) -> str:
    """Extracts text page-by-page from a PdfReader, applying OCR fallback, header/footer stripping, and fix_spaced_text."""
    pages_text = []
    total_len = 0
    for page in reader.pages:
        t = page.extract_text() or ""
        pages_text.append(t)
        total_len += len(t)
        if total_len >= _MAX_TEXT_CHARS:
            break

    combined_raw = "".join(pages_text).strip()
    if len(combined_raw) < 50:
        # Scanned or image-only PDF: attempt native OCR on embedded page images
        ocr_pages = _ocr_pdf_pages(reader)
        if ocr_pages and any(p.strip() for p in ocr_pages):
            pages_text = ocr_pages

    # Strip recurring running headers and footers across pages
    pages_text = strip_headers_and_footers(pages_text)

    full_text = "\n".join(p for p in pages_text if p.strip())
    full_text = fix_spaced_text(full_text)
    return full_text[:_MAX_TEXT_CHARS]


def extract_text(path):
    try:
        lower_path = path.lower()
        if lower_path.endswith(".pdf"):
            reader = PdfReader(path)
            return _extract_pdf_pages(reader)
        elif lower_path.endswith(".docx"):
            doc = Document(path)
            text = " ".join(paragraph.text for paragraph in doc.paragraphs)
            return text[:_MAX_TEXT_CHARS]
        elif lower_path.endswith(".xlsx") or lower_path.endswith(".xls"):
            return _extract_xlsx(path)[:_MAX_TEXT_CHARS]
        elif lower_path.endswith(".csv"):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(_MAX_TEXT_CHARS)
        elif lower_path.endswith(".pptx"):
            return _extract_pptx(path)[:_MAX_TEXT_CHARS]
        elif lower_path.endswith((".png", ".jpg", ".jpeg")):
            return _extract_image(path)[:_MAX_TEXT_CHARS]        
        else:
            # Fallback for .txt, .md, .rtf, etc.
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(_MAX_TEXT_CHARS)
    except Exception:
        return ""            


def extract_text_with_status(path, allow_protected=False):
    if not allow_protected:
        readable, reason = check_read_access(path)
        if not readable:
            return "", reason

    try:
        lower_path = path.lower()
        if lower_path.endswith(".pdf"):
            reader = PdfReader(path)
            if getattr(reader, "is_encrypted", False):
                if not allow_protected:
                    return "", "password_protected"
                try:
                    reader.decrypt("")
                except Exception:
                    pass
            return _extract_pdf_pages(reader), None
        elif lower_path.endswith(".docx"):
            doc = Document(path)
            text = " ".join(paragraph.text for paragraph in doc.paragraphs)
            return text[:_MAX_TEXT_CHARS], None
        elif lower_path.endswith(".xlsx") or lower_path.endswith(".xls"):
            return _extract_xlsx(path)[:_MAX_TEXT_CHARS], None
        elif lower_path.endswith(".csv"):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(_MAX_TEXT_CHARS), None
        elif lower_path.endswith(".pptx"):
            return _extract_pptx(path)[:_MAX_TEXT_CHARS], None
        elif lower_path.endswith((".png", ".jpg", ".jpeg")):
            return _extract_image(path)[:_MAX_TEXT_CHARS], None
        else:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(_MAX_TEXT_CHARS), None
    except Exception as exc:
        reason = classify_access_error(exc)
        if reason:
            return "", reason
        message = str(exc).lower()
        if "password" in message or "encrypted" in message:
            return "", "password_protected"
        return "", "extract_error"
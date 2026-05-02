from pypdf import PdfReader
from docx import Document

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


def extract_text(path):
    try:
        lower_path = path.lower()
        if lower_path.endswith(".pdf"):
            reader = PdfReader(path)
            text = ""
            for page in reader.pages:
                text += (page.extract_text() or "") + " "
                if len(text) >= _MAX_TEXT_CHARS:
                    break
            return text[:_MAX_TEXT_CHARS]
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
        else:
            # Fallback for .txt, .md, .rtf, etc.
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(_MAX_TEXT_CHARS)
    except Exception:
        return ""            
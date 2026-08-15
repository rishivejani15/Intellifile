import os
import zipfile
import base64
import mimetypes


SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg"}

MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_OFFICE_FILE_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 10_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_ENTRY_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_RATIO = 200
MAX_CHARS = 20_000
MAX_PREVIEW_IMAGES = 20
MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024

MAX_PDF_PAGES = 10
MAX_DOCX_PARAGRAPHS = 1_000
MAX_DOCX_TABLES = 50
MAX_DOCX_TABLE_ROWS = 200
MAX_XLSX_SHEETS = 8
MAX_XLSX_ROWS_PER_SHEET = 80
MAX_XLSX_SCANNED_ROWS = 500
MAX_XLSX_SCANNED_COLUMNS = 100
MAX_PPTX_SLIDES = 20
MAX_PPTX_SHAPES_PER_SLIDE = 250


class DocumentPreviewError(Exception):
    pass


def _validate_file(file_path):
    if not isinstance(file_path, str) or not file_path:
        raise DocumentPreviewError("Missing file path")
    if not os.path.isfile(file_path):
        raise DocumentPreviewError("File not found")

    extension = os.path.splitext(file_path)[1].lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise DocumentPreviewError("Unsupported document type")

    file_size = os.path.getsize(file_path)
    max_size = MAX_OFFICE_FILE_BYTES if extension != ".pdf" else MAX_FILE_BYTES
    if file_size > max_size:
        raise DocumentPreviewError(
            f"Document is too large to preview safely ({file_size // (1024 * 1024)} MB)"
        )

    if extension in {".docx", ".xlsx", ".pptx"}:
        _validate_office_archive(file_path)

    return extension


def _validate_office_archive(file_path):
    if not zipfile.is_zipfile(file_path):
        raise DocumentPreviewError("Office document is invalid or corrupted")

    total_uncompressed = 0
    try:
        with zipfile.ZipFile(file_path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise DocumentPreviewError("Office document contains too many archive entries")

            for entry in entries:
                if entry.file_size > MAX_ARCHIVE_ENTRY_BYTES:
                    raise DocumentPreviewError("Office document contains an oversized embedded item")
                total_uncompressed += entry.file_size
                if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                    raise DocumentPreviewError("Office document expands beyond the safe preview limit")
                if entry.compress_size and entry.file_size / entry.compress_size > MAX_ARCHIVE_RATIO:
                    raise DocumentPreviewError("Office document has an unsafe compression ratio")
    except zipfile.BadZipFile as exc:
        raise DocumentPreviewError("Office document is invalid or corrupted") from exc


def _finalize(parts, kind, truncated=False, images=None, blocks=None):
    content = "\n\n".join(part for part in parts if part)
    was_truncated = truncated or len(content) > MAX_CHARS
    preview_blocks = blocks or []
    if was_truncated and preview_blocks:
        preview_blocks = preview_blocks + [{"type": "notice", "content": "Preview shortened for performance."}]
    return {
        "success": True,
        "content": content[:MAX_CHARS],
        "kind": kind,
        "truncated": was_truncated,
        "images": images or [],
        "blocks": preview_blocks,
    }


def _image_payload(name, data):
    """Return a bounded data URL payload for a safe, browser-displayable image."""
    if not data or len(data) > MAX_PREVIEW_IMAGE_BYTES:
        return None
    mime_type, _ = mimetypes.guess_type(name)
    if mime_type not in {"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml"}:
        return None
    return {
        "name": os.path.basename(name),
        "data_url": f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}",
    }


def _extract_archive_images(file_path, media_prefix):
    """Extract a small, safe set of embedded Office images for visual preview."""
    images = []
    with zipfile.ZipFile(file_path) as archive:
        for entry in archive.infolist():
            if not entry.filename.startswith(media_prefix) or entry.is_dir():
                continue
            payload = _image_payload(entry.filename, archive.read(entry))
            if payload:
                images.append(payload)
            if len(images) >= MAX_PREVIEW_IMAGES:
                break
    return images


def _docx_content_blocks(document):
    """Read Word body items in document order, retaining inline picture positions."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    blocks = []
    image_count = 0
    relationship_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"

    def append_text(value):
        if value:
            blocks.append({"type": "text", "content": value})

    def append_image(rel_id):
        nonlocal image_count
        if image_count >= MAX_PREVIEW_IMAGES or not rel_id:
            return
        image_part = document.part.related_parts.get(rel_id)
        if not image_part:
            return
        payload = _image_payload(str(image_part.partname), image_part.blob)
        if payload:
            blocks.append({"type": "image", **payload})
            image_count += 1

    for child in document.element.body.iterchildren():
        local_name = child.tag.rsplit("}", 1)[-1]
        if local_name == "p":
            paragraph = Paragraph(child, document._body)
            text_buffer = []
            for run in paragraph._p.iterchildren():
                if run.tag.rsplit("}", 1)[-1] != "r":
                    continue
                for element in run.iterchildren():
                    element_name = element.tag.rsplit("}", 1)[-1]
                    if element_name == "t":
                        text_buffer.append("".join(element.itertext()))
                    elif element_name == "tab":
                        text_buffer.append("\t")
                    elif element_name in {"br", "cr"}:
                        text_buffer.append("\n")
                    elif element_name in {"drawing", "pict"}:
                        append_text("".join(text_buffer).strip())
                        text_buffer = []
                        for blip in element.iter():
                            if blip.tag.rsplit("}", 1)[-1] == "blip":
                                append_image(blip.get(relationship_ns))
            append_text("".join(text_buffer).strip())
        elif local_name == "tbl":
            table = Table(child, document._body)
            rows = []
            for row in table.rows[:MAX_DOCX_TABLE_ROWS]:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
            append_text("\n".join(rows))

    return blocks


def _preview_pdf(file_path):
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    if getattr(reader, "is_encrypted", False):
        raise DocumentPreviewError("This PDF is password protected")

    parts = []
    blocks = []
    image_count = 0
    truncated = len(reader.pages) > MAX_PDF_PAGES
    for page_number, page in enumerate(reader.pages, start=1):
        if page_number > MAX_PDF_PAGES:
            break
        page_text = (page.extract_text() or "").strip()
        try:
            page_images = list(page.images)
        except Exception:
            page_images = []
        has_images = bool(page_images)

        if page_text:
            part = f"Page {page_number}\n{page_text}"
        elif has_images:
            part = f"Page {page_number}"
        else:
            part = f"Page {page_number}\n[No extractable text detected on this page]"
        parts.append(part)
        blocks.append({"type": "text", "content": part})

        for image in page_images:
            if image_count >= MAX_PREVIEW_IMAGES:
                truncated = True
                break
            try:
                payload = _image_payload(image.name, image.data)
            except Exception:
                payload = None
            if payload:
                blocks.append({"type": "image", **payload})
                image_count += 1

        if sum(len(item) for item in parts) >= MAX_CHARS:
            truncated = True
            break
    return _finalize(parts, "PDF", truncated, blocks=blocks)


def _preview_docx(file_path):
    from docx import Document

    document = Document(file_path)
    parts = []
    truncated = len(document.paragraphs) > MAX_DOCX_PARAGRAPHS or len(document.tables) > MAX_DOCX_TABLES

    for paragraph in document.paragraphs[:MAX_DOCX_PARAGRAPHS]:
        paragraph_text = paragraph.text.strip()
        if paragraph_text:
            parts.append(paragraph_text)

    for table in document.tables[:MAX_DOCX_TABLES]:
        if len(table.rows) > MAX_DOCX_TABLE_ROWS:
            truncated = True
        for row in table.rows[:MAX_DOCX_TABLE_ROWS]:
            cells = []
            for cell in row.cells:
                cell_text = cell.text.strip()
                if cell_text:
                    cells.append(cell_text)
            if cells:
                parts.append(" | ".join(cells))
    blocks = _docx_content_blocks(document)
    return _finalize(parts, "Word document", truncated, blocks=blocks)


def _preview_xlsx(file_path):
    from openpyxl import load_workbook

    workbook = load_workbook(file_path, read_only=False, data_only=False, keep_links=False)
    parts = []
    blocks = []
    image_count = 0
    truncated = len(workbook.worksheets) > MAX_XLSX_SHEETS
    try:
        for sheet in workbook.worksheets[:MAX_XLSX_SHEETS]:
            sheet_parts = [f"Sheet: {sheet.title}"]
            populated_rows = 0
            max_row = min(sheet.max_row or 1, MAX_XLSX_SCANNED_ROWS)
            max_column = min(sheet.max_column or 1, MAX_XLSX_SCANNED_COLUMNS)
            if (sheet.max_row or 1) > max_row or (sheet.max_column or 1) > max_column:
                truncated = True

            for row in sheet.iter_rows(max_row=max_row, max_col=max_column):
                cells = [f"{cell.coordinate}: {cell.value}" for cell in row if cell.value is not None]
                if cells:
                    sheet_parts.append(" | ".join(cells))
                    populated_rows += 1
                if populated_rows >= MAX_XLSX_ROWS_PER_SHEET:
                    sheet_parts.append("[Additional rows not shown]")
                    truncated = True
                    break

            merged_ranges = list(sheet.merged_cells.ranges)
            if merged_ranges:
                shown_ranges = merged_ranges[:100]
                merged = ", ".join(str(cell_range) for cell_range in shown_ranges)
                sheet_parts.append(f"[Merged cells: {merged}]")
                if len(merged_ranges) > len(shown_ranges):
                    truncated = True
            if getattr(sheet, "_images", None):
                sheet_parts.append(f"[Images / graphics: {len(sheet._images)}]")
            if getattr(sheet, "_charts", None):
                sheet_parts.append(f"[Charts: {len(sheet._charts)}]")
            if populated_rows == 0 and not getattr(sheet, "_images", None) and not getattr(sheet, "_charts", None):
                sheet_parts.append("[No populated cells detected]")

            sheet_text = "\n".join(sheet_parts)
            parts.append(sheet_text)
            blocks.append({"type": "text", "content": sheet_text})
            for image in getattr(sheet, "_images", []) or []:
                if image_count >= MAX_PREVIEW_IMAGES:
                    truncated = True
                    break
                try:
                    image_data = image._data()
                    image_name = getattr(getattr(image, "path", None), "name", None) or getattr(image, "path", None) or f"{sheet.title}.png"
                    payload = _image_payload(str(image_name), image_data)
                except Exception:
                    payload = None
                if payload:
                    blocks.append({"type": "image", **payload})
                    image_count += 1
            if sum(len(item) for item in parts) >= MAX_CHARS:
                truncated = True
                break
    finally:
        workbook.close()
    return _finalize(parts, "Excel workbook", truncated, blocks=blocks)


def _preview_pptx(file_path):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    presentation = Presentation(file_path)
    parts = []
    blocks = []
    image_count = 0
    truncated = len(presentation.slides) > MAX_PPTX_SLIDES
    for slide_number, slide in enumerate(presentation.slides, start=1):
        if slide_number > MAX_PPTX_SLIDES:
            break
        slide_parts = [f"Slide {slide_number}"]
        current_text = [f"Slide {slide_number}"]
        shapes = list(slide.shapes)
        if len(shapes) > MAX_PPTX_SHAPES_PER_SLIDE:
            truncated = True

        def flush_text():
            nonlocal current_text
            if current_text:
                blocks.append({"type": "text", "content": "\n".join(current_text)})
                current_text = []

        for shape in shapes[:MAX_PPTX_SHAPES_PER_SLIDE]:
            if getattr(shape, "has_text_frame", False):
                shape_text = shape.text.strip()
                if shape_text:
                    slide_parts.append(shape_text)
                    current_text.append(shape_text)

            if getattr(shape, "has_table", False):
                slide_parts.append("[Table]")
                current_text.append("[Table]")
                for row_number, row in enumerate(shape.table.rows, start=1):
                    if row_number > MAX_DOCX_TABLE_ROWS:
                        truncated = True
                        break
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        row_text = " | ".join(cells)
                        slide_parts.append(row_text)
                        current_text.append(row_text)

            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                if image_count >= MAX_PREVIEW_IMAGES:
                    truncated = True
                    continue
                flush_text()
                try:
                    payload = _image_payload(getattr(shape.image, "filename", "slide-image.png"), shape.image.blob)
                except Exception:
                    payload = None
                if payload:
                    blocks.append({"type": "image", **payload})
                    image_count += 1
                continue
            elif getattr(shape, "has_chart", False):
                slide_parts.append("[Chart]")
                current_text.append("[Chart]")
            elif shape.shape_type in (MSO_SHAPE_TYPE.GROUP, MSO_SHAPE_TYPE.MEDIA):
                slide_parts.append("[Graphic / media]")
                current_text.append("[Graphic / media]")

        if len(slide_parts) == 1:
            slide_parts.append("[No extractable slide content detected]")
            current_text.append("[No extractable slide content detected]")
        flush_text()
        parts.append("\n".join(slide_parts))
        if sum(len(item) for item in parts) >= MAX_CHARS:
            truncated = True
            break
    return _finalize(parts, "PowerPoint presentation", truncated, blocks=blocks)

def _preview_image(file_path):
    from core.extractor import extract_text
    text = extract_text(file_path)
    if text.strip():
        return _finalize([text], "Image (OCR)")
    else:
        return _finalize(["[No text detected in this image]"], "Image")


def build_document_preview(file_path):
    extension = _validate_file(file_path)
    try:
        if extension == ".pdf":
            return _preview_pdf(file_path)
        if extension == ".docx":
            return _preview_docx(file_path)
        if extension == ".xlsx":
            return _preview_xlsx(file_path)
        if extension in {".png", ".jpg", ".jpeg"}:
            return _preview_image(file_path)
        return _preview_pptx(file_path)
    except DocumentPreviewError:
        raise
    except Exception as exc:
        raise DocumentPreviewError(f"Could not preview document: {exc}") from exc
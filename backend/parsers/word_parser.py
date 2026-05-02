import zipfile
from docx import Document

def extract_word_structure(file_path):
    """
    Extracts paragraphs, headings, and tables from a .docx file.
    """
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
            text = para.text
            is_empty = not text.strip()
            
            if is_empty:
                # [Keeping the object-aware logic we added earlier]
                contains_image = any('w:drawing' in r.element.xml or 'w:pict' in r.element.xml for r in para.runs)
                contains_break = any('w:br' in r.element.xml or 'w:lastRenderedPageBreak' in r.element.xml for r in para.runs)
                
                if contains_image: 
                    text = "[IMAGE / GRAPHIC]"
                elif contains_break: 
                    text = "[PAGE BREAK / SECTION]"
                else:
                    # TRUE EMPTY LINE: Skip it to prevent cluttering the timeline
                    continue

            if para.style.name.startswith("Heading"):
                headings.append(text)
            paragraphs.append(text)

        # 2. Extract Table Content (Crucial for bordered/tabular docs)
        for table in doc.tables:
            table_data = []
            for row in table.rows:
                row_cells = []
                for cell in row.cells:
                    cell_text = cell.text.strip()
                    if cell_text:
                        # Add table text to main paragraphs so it's tracked in the diff!
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
        print(f"[WordParser] Error: {str(e)}")
        return {
            "paragraphs": [],
            "headings": [],
            "tables": [],
            "has_macros": has_macros
        }
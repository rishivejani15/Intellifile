from docx import Document

def extract_word_structure(file_path):
    """
    Extracts paragraphs, headings, and tables from a .docx file.
    """
    try:
        doc = Document(file_path)

        paragraphs = []
        headings = []
        tables = []

        for para in doc.paragraphs:
            if para.style.name.startswith("Heading"):
                headings.append(para.text)
            paragraphs.append(para.text)

        for table in doc.tables:
            table_data = []
            for row in table.rows:
                table_data.append([cell.text for cell in row.cells])
            tables.append(table_data)

        return {
            "paragraphs": paragraphs,
            "headings": headings,
            "tables": tables
        }
    except Exception as e:
        print(f"[WordParser] Error: {str(e)}")
        return {
            "paragraphs": [],
            "headings": [],
            "tables": []
        }

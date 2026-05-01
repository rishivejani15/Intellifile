import zipfile
from openpyxl import load_workbook

def extract_excel_structure(file_path):
    """
    Extracts sheets, cells, and formulas from a .xlsx file.
    Also detects hidden macros.
    """
    has_macros = False
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            if 'xl/vbaProject.bin' in z.namelist():
                has_macros = True
    except Exception:
        pass

    try:
        # data_only=False to get formulas
        wb = load_workbook(file_path, data_only=False)

        sheets_data = {}

        for sheet in wb.sheetnames:
            ws = wb[sheet]
            sheet_content = {}

            for row in ws.iter_rows(values_only=False):
                for cell in row:
                    if cell.value is not None:
                        sheet_content[cell.coordinate] = {
                            "value": str(cell.value),
                            "formula": cell.value if cell.data_type == "f" else None
                        }

            sheets_data[sheet] = sheet_content

        return {
            "sheets": sheets_data,
            "has_macros": has_macros
        }
    except Exception as e:
        print(f"[ExcelParser] Error: {str(e)}")
        return {"sheets": {}, "has_macros": has_macros}

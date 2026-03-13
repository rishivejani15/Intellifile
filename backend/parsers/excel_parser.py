from openpyxl import load_workbook

def extract_excel_structure(file_path):
    """
    Extracts sheets, cells, and formulas from a .xlsx file.
    """
    try:
        # data_only=False to get formulas
        wb = load_workbook(file_path, data_only=False)

        sheets_data = {}

        for sheet in wb.sheetnames:
            ws = wb[sheet]
            sheet_content = {}

            # We use iter_rows to avoid loading the entire sheet into memory if large, 
            # though for versioning we usually need the core data.
            for row in ws.iter_rows(values_only=False):
                for cell in row:
                    if cell.value is not None:
                        sheet_content[cell.coordinate] = {
                            "value": str(cell.value),
                            "formula": cell.value if cell.data_type == "f" else None
                        }

            sheets_data[sheet] = sheet_content

        return sheets_data
    except Exception as e:
        print(f"[ExcelParser] Error: {str(e)}")
        return {}

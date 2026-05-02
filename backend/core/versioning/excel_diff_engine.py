def compare_excel_structures(old_struct, new_struct):
    """
    Compares two Excel structures and returns a summary of changes.
    """
    removed_sheets = set(old_struct.keys()) - set(new_struct.keys())
    added_sheets = set(new_struct.keys()) - set(old_struct.keys())

    changed_cells = []
    formula_changes = 0

    for sheet in old_struct:
        if sheet in new_struct:
            old_sheet = old_struct[sheet]
            new_sheet = new_struct[sheet]
            
            # Check for changed or removed cells
            for coord, data in old_sheet.items():
                if coord in new_sheet:
                    if data["value"] != new_sheet[coord]["value"]:
                        changed_cells.append({
                            "sheet": sheet,
                            "cell": coord,
                            "old_value": data["value"],
                            "new_value": new_sheet[coord]["value"]
                        })
                    
                    if data["formula"] != new_sheet[coord]["formula"]:
                        formula_changes += 1
                else:
                    # Cell removed (cleared)
                    changed_cells.append({
                        "sheet": sheet,
                        "cell": coord,
                        "old_value": data["value"],
                        "new_value": None
                    })

            # Check for added cells
            for coord, data in new_sheet.items():
                if coord not in old_sheet:
                    changed_cells.append({
                        "sheet": sheet,
                        "cell": coord,
                        "old_value": None,
                        "new_value": data["value"]
                    })
        else:
            # Sheet was completely removed, log all its cells as removed
            old_sheet = old_struct[sheet]
            for coord, data in old_sheet.items():
                changed_cells.append({
                    "sheet": sheet,
                    "cell": coord,
                    "old_value": data["value"],
                    "new_value": None
                })
                
    # Check for cells in newly added sheets
    for sheet in added_sheets:
        new_sheet = new_struct[sheet]
        for coord, data in new_sheet.items():
            changed_cells.append({
                "sheet": sheet,
                "cell": coord,
                "old_value": None,
                "new_value": data["value"]
            })

    return {
        "removed_sheets": list(removed_sheets),
        "added_sheets": list(added_sheets),
        "changed_cells": changed_cells,
        "changed_cells_count": len(changed_cells),
        "formula_changes": formula_changes,
        "is_structured": True,
        "format": "excel"
    }

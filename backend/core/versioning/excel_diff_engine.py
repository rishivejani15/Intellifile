def compare_excel_structures(old_struct, new_struct):
    """
    Compares two Excel structures and returns a summary of changes.
    """
    # Support both old flat format and new nested format
    old_sheets = old_struct.get("sheets", old_struct) if isinstance(old_struct, dict) else {}
    new_sheets = new_struct.get("sheets", new_struct) if isinstance(new_struct, dict) else {}
    
    has_macros = new_struct.get("has_macros", False) if isinstance(new_struct, dict) else False
    macro_changed = has_macros != (old_struct.get("has_macros", False) if isinstance(old_struct, dict) else False)

    removed_sheets = set(old_sheets.keys()) - set(new_sheets.keys())
    added_sheets = set(new_sheets.keys()) - set(old_sheets.keys())

    changed_cells = []
    formula_changes = 0

    for sheet in old_sheets:
        if sheet in new_sheets:
            old_sheet = old_sheets[sheet]
            new_sheet = new_sheets[sheet]
            
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
            # Sheet was completely removed
            old_sheet = old_sheets[sheet]
            for coord, data in old_sheet.items():
                changed_cells.append({
                    "sheet": sheet,
                    "cell": coord,
                    "old_value": data["value"],
                    "new_value": None
                })
                
    # Check for cells in newly added sheets
    for sheet in added_sheets:
        new_sheet = new_sheets[sheet]
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
        "has_macros": has_macros,
        "macro_changed": macro_changed,
        "is_structured": True,
        "format": "excel"
    }

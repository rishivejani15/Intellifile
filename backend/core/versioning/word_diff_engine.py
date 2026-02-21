import difflib

def compare_word_structures(old_struct, new_struct):
    """
    Compares two Word structures and returns a granular diff of paragraphs and headings.
    Uses difflib for sequential matching to detect modifications better than set logic.
    """
    old_paras = old_struct.get("paragraphs", [])
    new_paras = new_struct.get("paragraphs", [])
    
    # Use SequenceMatcher for paragraphs
    sm = difflib.SequenceMatcher(None, old_paras, new_paras)
    para_diff = []
    
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for i in range(i1, i2):
                para_diff.append({"type": "equal", "text": old_paras[i]})
        elif tag == 'replace':
            for i in range(i1, i2):
                para_diff.append({"type": "removed", "text": old_paras[i]})
            for j in range(j1, j2):
                para_diff.append({"type": "added", "text": new_paras[j]})
        elif tag == 'delete':
            for i in range(i1, i2):
                para_diff.append({"type": "removed", "text": old_paras[i]})
        elif tag == 'insert':
            for j in range(j1, j2):
                para_diff.append({"type": "added", "text": new_paras[j]})

    # Simple comparison for headings and tables (can be expanded later if needed)
    removed_headings = [h for h in old_struct.get("headings", []) if h not in new_struct.get("headings", [])]
    added_headings = [h for h in new_struct.get("headings", []) if h not in old_struct.get("headings", [])]
    table_delta = len(new_struct.get("tables", [])) - len(old_struct.get("tables", []))

    return {
        "para_diff": para_diff,
        "removed_headings": removed_headings,
        "added_headings": added_headings,
        "table_delta": table_delta,
        "is_structured": True,
        "format": "word"
    }

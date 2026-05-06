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
            # Detect modifications (one-to-one) or block changes
            for i, j in zip(range(i1, i2), range(j1, j2)):
                old_text = old_paras[i]
                new_text = new_paras[j]
                
                # Word-level sub-diff for modification counts
                old_words = old_text.split()
                new_words = new_text.split()
                w_sm = difflib.SequenceMatcher(None, old_words, new_words)
                
                words_added = 0
                words_removed = 0
                for w_tag, wi1, wi2, wj1, wj2 in w_sm.get_opcodes():
                    if w_tag == 'replace':
                        words_removed += (wi2 - wi1)
                        words_added += (wj2 - wj1)
                    elif w_tag == 'delete':
                        words_removed += (wi2 - wi1)
                    elif w_tag == 'insert':
                        words_added += (wj2 - wj1)
                
                para_diff.append({
                    "type": "modified", 
                    "old_text": old_text, 
                    "new_text": new_text,
                    "words_added": words_added,
                    "words_removed": words_removed
                })
            
            # Handle trailing items in the replacement block
            if (i2 - i1) > (j2 - j1):
                for i in range(i1 + (j2 - j1), i2):
                    para_diff.append({"type": "removed", "text": old_paras[i]})
            elif (j2 - j1) > (i2 - i1):
                for j in range(j1 + (i2 - i1), j2):
                    para_diff.append({"type": "added", "text": new_paras[j]})
                    
        elif tag == 'delete':
            for i in range(i1, i2):
                para_diff.append({"type": "removed", "text": old_paras[i]})
        elif tag == 'insert':
            for j in range(j1, j2):
                para_diff.append({"type": "added", "text": new_paras[j]})

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
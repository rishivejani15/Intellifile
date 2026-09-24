import difflib

def _is_image_item(item):
    if isinstance(item, dict):
        return item.get("type") == "image" or item.get("element_type") == "image"
    if isinstance(item, str):
        return item in ["[IMAGE / GRAPHIC]", "[Graphic Attached]"]
    return False

def _item_key(item):
    if isinstance(item, dict):
        if item.get("type") == "image" or item.get("element_type") == "image":
            h = item.get("image_hash") or item.get("hash") or ""
            return f"__IMG_HASH__{h}"
        return item.get("text", "")
    return str(item)

def _item_text(item):
    if isinstance(item, dict):
        return item.get("text", "[IMAGE / GRAPHIC]")
    return str(item)

def _create_image_entry(type_name, item, images_dict=None):
    img_obj = item if isinstance(item, dict) else {"text": str(item), "element_type": "image"}
    h = img_obj.get("image_hash") or ""
    rel_id = img_obj.get("rel_id") or ""
    data_url = None
    if images_dict:
        data_url = images_dict.get(h) or (images_dict.get(rel_id) if rel_id else None)
    
    text_label = "[IMAGE]"
    if type_name == "added":
        text_label = "[IMAGE ADDED]"
    elif type_name == "removed":
        text_label = "[IMAGE REMOVED]"
        
    entry = {
        "type": type_name,
        "element_type": "image",
        "text": text_label,
        "image": {
            "image_hash": h,
            "image_name": img_obj.get("image_name", "graphic.png"),
            "data_url": data_url
        }
    }
    if data_url:
        entry["data_url"] = data_url
    return entry

def _create_image_modified_entry(old_item, new_item, images_a=None, images_b=None):
    old_obj = old_item if isinstance(old_item, dict) else {"text": str(old_item), "element_type": "image"}
    new_obj = new_item if isinstance(new_item, dict) else {"text": str(new_item), "element_type": "image"}
    
    h_old = old_obj.get("image_hash") or ""
    h_new = new_obj.get("image_hash") or ""
    rel_old = old_obj.get("rel_id") or ""
    rel_new = new_obj.get("rel_id") or ""
    
    data_url_old = None
    if images_a:
        data_url_old = images_a.get(h_old) or (images_a.get(rel_old) if rel_old else None)
        
    data_url_new = None
    if images_b:
        data_url_new = images_b.get(h_new) or (images_b.get(rel_new) if rel_new else None)
        
    return {
        "type": "modified",
        "element_type": "image",
        "text": "[IMAGE REPLACED]",
        "old_image": {
            "image_hash": h_old,
            "image_name": old_obj.get("image_name", "previous_image.png"),
            "data_url": data_url_old
        },
        "new_image": {
            "image_hash": h_new,
            "image_name": new_obj.get("image_name", "updated_image.png"),
            "data_url": data_url_new
        }
    }

def _create_image_equal_entry(item, images_a=None, images_b=None):
    img_obj = item if isinstance(item, dict) else {"text": str(item), "element_type": "image"}
    h = img_obj.get("image_hash") or ""
    rel_id = img_obj.get("rel_id") or ""
    data_url = None
    if images_b:
        data_url = images_b.get(h) or (images_b.get(rel_id) if rel_id else None)
    if not data_url and images_a:
        data_url = images_a.get(h) or (images_a.get(rel_id) if rel_id else None)
        
    entry = {
        "type": "equal",
        "element_type": "image",
        "text": "[IMAGE]",
        "image": {
            "image_hash": h,
            "image_name": img_obj.get("image_name", "graphic.png"),
            "data_url": data_url
        }
    }
    if data_url:
        entry["data_url"] = data_url
    return entry


def compare_word_structures(old_struct, new_struct, images_a=None, images_b=None):
    """
    Compares two Word structures and returns a granular diff of paragraphs, headings,
    and embedded images/infographics.
    Uses difflib for sequential matching to detect modifications better than set logic.
    """
    old_paras = old_struct.get("paragraphs", [])
    new_paras = new_struct.get("paragraphs", [])
    
    # Use SequenceMatcher with normalized keys
    sm = difflib.SequenceMatcher(None, [_item_key(p) for p in old_paras], [_item_key(p) for p in new_paras])
    para_diff = []
    
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for i in range(i1, i2):
                item = old_paras[i]
                if _is_image_item(item):
                    para_diff.append(_create_image_equal_entry(item, images_a, images_b))
                else:
                    para_diff.append({"type": "equal", "text": _item_text(item)})
        elif tag == 'replace':
            # Detect modifications (one-to-one) or block changes
            for i, j in zip(range(i1, i2), range(j1, j2)):
                old_item = old_paras[i]
                new_item = new_paras[j]
                
                if _is_image_item(old_item) and _is_image_item(new_item):
                    para_diff.append(_create_image_modified_entry(old_item, new_item, images_a, images_b))
                elif _is_image_item(old_item):
                    para_diff.append(_create_image_entry("removed", old_item, images_a))
                    para_diff.append({"type": "added", "text": _item_text(new_item)})
                elif _is_image_item(new_item):
                    para_diff.append({"type": "removed", "text": _item_text(old_item)})
                    para_diff.append(_create_image_entry("added", new_item, images_b))
                else:
                    old_text = _item_text(old_item)
                    new_text = _item_text(new_item)
                    
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
                    item = old_paras[i]
                    if _is_image_item(item):
                        para_diff.append(_create_image_entry("removed", item, images_a))
                    else:
                        para_diff.append({"type": "removed", "text": _item_text(item)})
            elif (j2 - j1) > (i2 - i1):
                for j in range(j1 + (i2 - i1), j2):
                    item = new_paras[j]
                    if _is_image_item(item):
                        para_diff.append(_create_image_entry("added", item, images_b))
                    else:
                        para_diff.append({"type": "added", "text": _item_text(item)})
                    
        elif tag == 'delete':
            for i in range(i1, i2):
                item = old_paras[i]
                if _is_image_item(item):
                    para_diff.append(_create_image_entry("removed", item, images_a))
                else:
                    para_diff.append({"type": "removed", "text": _item_text(item)})
        elif tag == 'insert':
            for j in range(j1, j2):
                item = new_paras[j]
                if _is_image_item(item):
                    para_diff.append(_create_image_entry("added", item, images_b))
                else:
                    para_diff.append({"type": "added", "text": _item_text(item)})

    removed_headings = [h for h in old_struct.get("headings", []) if h not in new_struct.get("headings", [])]
    added_headings = [h for h in new_struct.get("headings", []) if h not in old_struct.get("headings", [])]
    table_delta = len(new_struct.get("tables", [])) - len(old_struct.get("tables", []))

    images_added = len([p for p in para_diff if p.get("type") == "added" and p.get("element_type") == "image"])
    images_removed = len([p for p in para_diff if p.get("type") == "removed" and p.get("element_type") == "image"])
    images_modified = len([p for p in para_diff if p.get("type") == "modified" and p.get("element_type") == "image"])

    return {
        "para_diff": para_diff,
        "removed_headings": removed_headings,
        "added_headings": added_headings,
        "table_delta": table_delta,
        "image_stats": {
            "added": images_added,
            "removed": images_removed,
            "modified": images_modified
        },
        "is_structured": True,
        "format": "word"
    }
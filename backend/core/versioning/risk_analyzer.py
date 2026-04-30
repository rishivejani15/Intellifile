import re
import math
import difflib

def shannon_entropy(data: str) -> float:
    if not data:
        return 0.0
    entropy = 0.0
    length = len(data)
    frequencies = {}
    for char in data:
        frequencies[char] = frequencies.get(char, 0) + 1
    for count in frequencies.values():
        probability = count / length
        entropy -= probability * math.log2(probability)
    return entropy

def calculate_importance(line: str, avg_line_length: float) -> float:
    if not line:
        return 0.0
        
    len_score = len(line)
    
    # Token count (split by whitespace)
    tokens = line.split()
    token_score = len(tokens)
    
    # Non-alphanumeric symbol count
    symbols = re.sub(r'[a-zA-Z0-9\s]', '', line)
    symbol_score = len(symbols)
    
    entropy_score = shannon_entropy(line)
    
    importance = entropy_score + token_score + symbol_score + (len_score / max(avg_line_length, 1.0))
    return importance

def analyze_semantics(old_content: str, new_content: str, diff_text: str = "") -> dict:
    """
    IWSD v2 (Information Weighted Semantic Diff) implementation.
    Operates strictly on mathematical probabilities and statistics.
    Returns: {change_score, risk_score, intent, severity}
    """
    
    # Optional Optimization: Importance Cache
    importance_cache = {}
    
    def get_importance(line: str, avg_len: float) -> float:
        if line in importance_cache:
            return importance_cache[line]
        val = calculate_importance(line, avg_len)
        importance_cache[line] = val
        return val

    # Handle inputs
    old_str = old_content if isinstance(old_content, str) else str(old_content or "")
    new_str = new_content if isinstance(new_content, str) else str(new_content or "")
    
    old_lines = old_str.splitlines()
    new_lines = new_str.splitlines()
    
    total_lines = max(len(old_lines), len(new_lines), 1)
    
    all_lines = old_lines + new_lines
    combined_lines = len(all_lines)
    
    avg_line_length = 0.0
    if combined_lines > 0:
        avg_line_length = sum(len(line) for line in all_lines) / combined_lines
        
    added_lines_list: list[str] = []
    removed_lines_list: list[str] = []
    
    # Parse diff 
    if diff_text:
        diff_lines = diff_text.splitlines()
        for i, line in enumerate(diff_lines):
            # Skip universal unified diff headers
            if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
                continue
            if line.startswith("+"):
                added_lines_list.append(line[1:])
            elif line.startswith("-"):
                removed_lines_list.append(line[1:])
    else:
        # Fallback if no diff provided
        for line in new_lines:
            if line not in old_lines:
                 added_lines_list.append(line)
        for line in old_lines:
            if line not in new_lines:
                 removed_lines_list.append(line)
                 
    # CHANGE 1: Modification Scoring
    modify_score = 0.0
    add_score = 0.0
    delete_score = 0.0
    modified_lines_count = min(len(added_lines_list), len(removed_lines_list))
    
    for i in range(modified_lines_count):
        # We assign importance from the newly added equivalent (the modified payload)
        modify_score += get_importance(added_lines_list[i], avg_line_length)
        
    m_count = int(modified_lines_count)
    for i in range(m_count, len(added_lines_list)):
        add_score += get_importance(added_lines_list[i], avg_line_length)
        
    for i in range(m_count, len(removed_lines_list)):
        delete_score += get_importance(removed_lines_list[i], avg_line_length)
                 
    # CHANGE 2: Weighted Similarity Score
    similarity_ratio = difflib.SequenceMatcher(None, old_str, new_str).ratio()
    weighted_similarity = (1.0 - similarity_ratio) * total_lines
    
    # CHANGE 3: Block Diff Scoring
    block_size = 5
    old_blocks = ["\n".join(old_lines[i:int(i+block_size)]) for i in range(0, len(old_lines), block_size)]
    new_blocks = ["\n".join(new_lines[i:int(i+block_size)]) for i in range(0, len(new_lines), block_size)]
    
    # Count blocks in new that differ from old, plus old that differ from new
    new_diff_blocks = sum(1 for b in new_blocks if b not in old_blocks)
    old_diff_blocks = sum(1 for b in old_blocks if b not in new_blocks)
    block_changes = new_diff_blocks + old_diff_blocks
    
    block_score = block_changes * avg_line_length
    
    # CHANGE 4: Size Score
    old_size = len(old_str)
    new_size = len(new_str)
    size_score = abs(new_size - old_size) / max(float(old_size), 1.0)
    
    # Final aggregations
    change_score = add_score + delete_score + modify_score + weighted_similarity + block_score + size_score
    
    # Intent Detection
    if delete_score > add_score:
        intent = "Deletion Heavy"
    else:
        intent = "Addition/Modification"
        
    # CHANGE 6: Dynamic Severity Classification
    major_threshold = total_lines * 15
    moderate_threshold = total_lines * 5
    
    if change_score > major_threshold:
        severity = "Major"
    elif change_score > moderate_threshold:
        severity = "Moderate"
    else:
        severity = "Minor"
        
    # CHANGE 5: Normalized Risk Score
    raw_risk_score = delete_score / max(change_score, 1.0)
    risk_score = min(1.0, max(0.0, raw_risk_score))
    
    return {
        "change_score": change_score,
        "risk_score": risk_score,
        "intent": intent,
        "severity": severity,
        "similarity_score": weighted_similarity,
        "modify_score": modify_score,
        "block_score": block_score,
        "add_score": add_score,
        "delete_score": delete_score,
        "size_score": size_score
    }
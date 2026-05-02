import re
import math
import difflib
import re

SENSITIVE_KEYWORDS = {
    "password", "confidential", "secret", "api_key", "token", "auth", 
    "private", "salary", "credentials"
}

SENSITIVE_PATTERNS = [
    re.compile(r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b'), # Credit Card
    re.compile(r'\b[\w\.-]+@[\w\.-]+\.\w+\b'),             # Email
    re.compile(r'\b\d{3}-\d{2}-\d{4}\b')                   # SSN
]

def check_sensitivity(line: str) -> bool:
    line_lower = line.lower()
    for keyword in SENSITIVE_KEYWORDS:
        if keyword in line_lower:
            return True
    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(line):
            return True
    return False

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
        
    # Shield: Base64/Blob Detector
    # Detects long, dense strings likely to be encoded blobs (images/data) rather than code/text.
    if len(line) > 120 and " " not in line:
        if re.match(r'^[A-Za-z0-9+/=]+$', line):
            # 90% reduction for blobs - we don't want an icon paste to be "Major Risk"
            return (shannon_entropy(line) * 0.1) 

    len_score = len(line)
    
    # Token count (split by whitespace) (the computer counts the words)
    tokens = line.split()
    token_score = len(tokens)
    
    # Non-alphanumeric symbol count
    symbols = re.sub(r'[a-zA-Z0-9\s]', '', line)
    symbol_score = len(symbols)
    
    #3 shannon entropy
    entropy_score = shannon_entropy(line)
    
    #4 aggregate
    importance = entropy_score + token_score + symbol_score + (len_score / max(avg_line_length, 1.0))
    
    # Shield: Excel Ripple Effects (Formula Detection)
    # If this is an Excel formula (found in our structured JSON), boost its weight significantly
    if '"formula": "=' in line:
        importance *= 5.0 # Formulas have high dependency/ripple impact

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
                 
    # CHANGE 1: Proprietary Asymmetric Information Loss Scoring
    modify_score = 0.0
    add_score = 0.0
    delete_score = 0.0
    modified_lines_count = min(len(added_lines_list), len(removed_lines_list))
    
    # 1. Modification Scoring: Penalize "Information Downgrades"
    for i in range(modified_lines_count):
        old_line = removed_lines_list[i]
        new_line = added_lines_list[i]
        
        old_imp = get_importance(old_line, avg_line_length)
        new_imp = get_importance(new_line, avg_line_length)
        
        if old_imp > new_imp:
            # The user replaced highly complex data with simple data (Information Loss)
            # We apply a 2.0x risk penalty to the delta that was lost.
            loss_delta = (old_imp - new_imp) * 2.0
            modify_score += (new_imp + loss_delta)
        else:
            # Safe modification (adding complexity)
            modify_score += new_imp
        
    m_count = int(modified_lines_count)
    
    # 2. Addition Scoring: Standard Weight (1.0x)
    # Adding data is common and inherently low-risk.
    for i in range(m_count, len(added_lines_list)):
        add_score += get_importance(added_lines_list[i], avg_line_length)
        
    # 3. Deletion Scoring: Dynamic Asymmetric Penalty (2.0x to 3.0x)
    # Destroying data is strictly riskier than adding data.
    sensitive_deletion_detected = False
    
    for i in range(m_count, len(removed_lines_list)):
        line = removed_lines_list[i]
        base_imp = get_importance(line, avg_line_length)
        
        # Check for sensitive data first
        if check_sensitivity(line):
            dynamic_multiplier = 10.0 # Massive penalty for sensitive data destruction
            sensitive_deletion_detected = True
        else:
            # Calculate mathematical density of the destroyed data
            entropy = shannon_entropy(line)
            
            # Scale the penalty based on how dense the destroyed information was
            if entropy > 3.5:
                dynamic_multiplier = 3.0 # Destroyed highly complex math/code
            elif entropy > 2.0:
                dynamic_multiplier = 2.5 # Destroyed standard structured sentences
            else:
                dynamic_multiplier = 2.0 # Destroyed basic data
            
        delete_score += (base_imp * dynamic_multiplier)
                 
    # CHANGE 2: Weighted Similarity Score
    similarity_ratio = difflib.SequenceMatcher(None, old_str, new_str).ratio()
    weighted_similarity = (1.0 - similarity_ratio) * total_lines
    
    # CHANGE 3: Block Diff Scoring (Set-based to ignore simple shifts)
    block_size = 5
    old_blocks = set("\n".join(old_lines[i:int(i+block_size)]) for i in range(0, len(old_lines), block_size))
    new_blocks = set("\n".join(new_lines[i:int(i+block_size)]) for i in range(0, len(new_lines), block_size))
    
    # Only count blocks that are TRULY new or TRULY gone, regardless of where they moved
    unique_new_blocks = [b for b in new_blocks if b not in old_blocks]
    unique_old_blocks = [b for b in old_blocks if b not in new_blocks]
    block_changes = len(unique_new_blocks) + len(unique_old_blocks)
    
    # Apply a dampening factor so shifts don't cause Major Risk hallucinations
    block_score = block_changes * (avg_line_length * 0.2)
    
    # CHANGE 4: Size Score
    old_size = len(old_str)
    new_size = len(new_str)
    size_score = abs(new_size - old_size) / max(float(old_size), 1.0)
    
    # Final aggregations
    change_score = add_score + delete_score + modify_score + weighted_similarity + block_score + size_score

    # Intent Detection
    total_removed = len(removed_lines_list)
    total_added = len(added_lines_list)
    if sensitive_deletion_detected:
        intent = "Sensitive Data Deletion"
    elif total_removed > total_added:
        if total_removed > total_lines * 0.5:
            intent = "Heavy Deletion"
        elif total_removed > total_lines * 0.2:
            intent = "Moderate Deletion"
        else:
            intent = "Light Deletion"
    elif total_added > total_removed:
        intent = "Addition/Modification"
    else:
        intent = "Addition/Modification"
        
    # CHANGE 6: Dynamic Severity Classification
    major_threshold = total_lines * 20
    moderate_threshold = total_lines * 10
    
    if sensitive_deletion_detected:
        # SECURITY OVERRIDE: If sensitive data is gone, it's always Major Risk
        severity = "Major"
    elif change_score > major_threshold:
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
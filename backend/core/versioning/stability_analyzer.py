def calculate_stability(old_content: str, new_content: str, risk_score: float = 0.0) -> float:
    """
    Returns semantic stability score between 0 and 1.
    Factors in both structural changes (length) and semantic risk (IWSD).
    """

    if old_content is None:
        return 1.0

    # Handle stringified empty structures from Word/Excel (e.g. "{}" or "{}")
    normalized_old = str(old_content).strip()
    if normalized_old in ["", "{}", "[]", "None"]:
        return 1.0

    old_len = len(old_content)
    new_len = len(new_content) if new_content is not None else 0

    max_len = max(old_len, new_len)
    if max_len == 0:
        return 1.0
        
    # Base structural stability (change in size)
    delta = abs(new_len - old_len)
    structural_stability = 1.0 - (delta / float(max_len))
    
    # Semantic stability (weighted by risk_score)
    # Even if size is identical, high risk = low stability
    semantic_penalty = risk_score * 0.7 # 70% of risk impacts stability
    
    stability = structural_stability * (1.0 - semantic_penalty)

    # Clamp between 0.05 and 1 (never show 0 for a valid file to avoid UI confusion)
    stability = max(0.05, min(stability, 1.0))

    return float(round(stability, 3))
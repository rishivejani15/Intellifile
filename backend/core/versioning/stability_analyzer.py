def calculate_stability(old_content: str, new_content: str) -> float:
    """
    Returns stability score between 0 and 1.
    1 = highly stable
    """

    old_len = len(old_content)
    new_len = len(new_content)

    if old_len == 0:
        return 1.0

    max_len = max(old_len, new_len)
    if max_len == 0:
        return 1.0
        
    delta = abs(new_len - old_len)
    stability = 1.0 - (delta / float(max_len))

    # Clamp between 0 and 1
    stability = max(0.0, min(stability, 1.0))

    return float(round(stability, 3))
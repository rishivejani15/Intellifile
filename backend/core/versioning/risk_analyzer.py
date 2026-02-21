import re

HIGH_RISK_KEYWORDS = [
    "delete",
    "remove",
    "drop",
    "truncate",
]

CRITICAL_FILES = [
    ".env",
    "config",
    "settings",
    "requirements.txt",
    "package.json",
]


def calculate_risk(diff: any, semantic_data: dict, format_type: str = "text") -> str:
    """
    Advanced rule-based risk scoring for text, word, and excel.
    """

    risk_score = 0

    if format_type == "text":
        lines = diff.splitlines()
        added = 0
        removed = 0

        for line in lines:
            if line.startswith("+") and not line.startswith("+++"):
                added += 1
            if line.startswith("-") and not line.startswith("---"):
                removed += 1
                for keyword in HIGH_RISK_KEYWORDS:
                    if keyword in line.lower():
                        risk_score += 3

        if removed > 20:
            risk_score += 5
        if (added + removed) > 100:
            risk_score += 5

        function_pattern = r"(def\s+\w+|function\s+\w+)"
        removed_functions = [
            line for line in lines
            if line.startswith("-") and re.search(function_pattern, line)
        ]
        if removed_functions:
            risk_score += 4

        if semantic_data.get("complexity_delta", 0) > 10:
            risk_score += 3

    elif format_type == "word":
        # Word risk rules
        if len(diff.get("removed_headings", [])) > 3:
            risk_score += 10
        if diff.get("table_delta", 0) < 0:
            risk_score += 8
        
        # High paragraph removal ratio
        total_old = semantic_data.get("paragraphs", 1) # Fallback to 1 to avoid div by zero
        removed_count = len(diff.get("removed_paragraphs", []))
        if removed_count / max(total_old, 1) > 0.2:
            risk_score += 7

    elif format_type == "excel":
        # Excel risk rules
        if diff.get("removed_sheets"):
            risk_score += 12
        if diff.get("changed_cells_count", 0) > 50:
            risk_score += 6
        if diff.get("formula_changes", 0) > 0:
            risk_score += 8

    # Final Risk Level Mapping
    if risk_score >= 10:
        return "High"
    elif risk_score >= 5:
        return "Medium"
    else:
        return "Low"

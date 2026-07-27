import re
from .base_provider import BaseAIProvider

class RuleBasedProvider(BaseAIProvider):

    def summarize(self, diff_text: str) -> str:
        added = diff_text.count("\n+")
        removed = diff_text.count("\n-")

        if added > removed * 2:
            return "Major feature additions detected."
        elif removed > added * 2:
            return "Significant content removal detected."
        elif added > 0 or removed > 0:
            return "Minor modifications made."
        else:
            return "No significant changes."

    def classify_intent(self, diff_text: str) -> str:
        if "def " in diff_text or "class " in diff_text:
            return "Feature Update"
        if "try:" in diff_text or "except" in diff_text:
            return "Bug Fix"
        if "import " in diff_text:
            return "Dependency Change"
        if diff_text.count("\n-") > 20:
            return "Deletion Heavy"
        return "Refactor"

    def analyze_semantics(self, old_content: str, new_content: str) -> dict:
        old_lines = len(old_content.splitlines())
        new_lines = len(new_content.splitlines())

        return {
            "line_delta": new_lines - old_lines,
            "size_change_percent": (
                (len(new_content) - len(old_content)) / max(len(old_content), 1)
            )
        }

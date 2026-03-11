# Leave this empty for now.
# Later you plug Gemini API here.

from .base_provider import BaseAIProvider

class GeminiProvider(BaseAIProvider):

    def summarize(self, diff_text: str) -> str:
        raise NotImplementedError("Gemini provider not implemented yet.")

    def classify_intent(self, diff_text: str) -> str:
        raise NotImplementedError("Gemini provider not implemented yet.")

    def analyze_semantics(self, old_content: str, new_content: str) -> dict:
        raise NotImplementedError("Gemini provider not implemented yet.")

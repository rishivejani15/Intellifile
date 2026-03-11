from abc import ABC, abstractmethod

class BaseAIProvider(ABC):

    @abstractmethod
    def summarize(self, diff_text: str) -> str:
        pass

    @abstractmethod
    def classify_intent(self, diff_text: str) -> str:
        pass

    @abstractmethod
    def analyze_semantics(self, old_content: str, new_content: str) -> dict:
        pass

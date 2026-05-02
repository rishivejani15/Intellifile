import os

try:
    from config.settings import AI_PROVIDER as _CONFIG_PROVIDER
except Exception:
    _CONFIG_PROVIDER = None

from ai.providers.rule_based_provider import RuleBasedProvider
from ai.providers.gemini_provider import GeminiProvider

def get_ai_provider():
    provider = (_CONFIG_PROVIDER or os.getenv("INTELLIFILE_AI_PROVIDER", "rule_based")).strip().lower()

    if provider == "rule_based":
        return RuleBasedProvider()

    elif provider == "gemini":
        return GeminiProvider()

    else:
        raise ValueError(f"Invalid AI Provider selected: {provider}")

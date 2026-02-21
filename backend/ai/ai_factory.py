from config.settings import AI_PROVIDER

from ai.providers.rule_based_provider import RuleBasedProvider
from ai.providers.gemini_provider import GeminiProvider

def get_ai_provider():

    if AI_PROVIDER == "rule_based":
        return RuleBasedProvider()

    elif AI_PROVIDER == "gemini":
        return GeminiProvider()

    else:
        raise ValueError("Invalid AI Provider selected.")

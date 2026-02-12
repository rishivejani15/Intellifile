
import os
import requests
import logging
from typing import List, Dict, Any, Optional

class RAGClient:
    def __init__(self):
        # OpenAI compatible endpoint for local server
        self.base_url = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8001/v1")
        self.model = os.getenv("LLM_MODEL", "qwen2.5-3b-instruct-q4_k_m.gguf") # customizable

    def generate_answer(self, query: str, context_chunks: List[str]) -> str:
        if not context_chunks:
             return "I don't have enough information to answer that question."

        try:
            prompt_content = self._construct_prompt(query, context_chunks)
            payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant. Use ONLY provided context to answer. If context is missing, say you don't know."},
                    {"role": "user", "content": prompt_content}
                ],
                "temperature": 0.3,
                "max_tokens": 512
            }
            
            resp = requests.post(f"{self.base_url}/chat/completions", json=payload, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            return data['choices'][0]['message']['content']
            
        except Exception as e:
            logging.error(f"LLM generation failed: {e}")
            return "Sorry, I encountered an error generating the answer."

    def _construct_prompt(self, query: str, chunks: List[str]) -> str:
        context_str = "\n\n".join([f"Context {i+1}: {chunk}" for i, chunk in enumerate(chunks)])
        return f"Context:\n{context_str}\n\nQuestion: {query}"

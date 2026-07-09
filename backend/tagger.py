import asyncio
import os
import re

import numpy as np

from core.extractor import extract_text_with_status


TAG_TAXONOMY = {
    "finance": ["invoice", "receipt", "budget", "tax", "payment", "expense", "bank", "statement"],
    "legal": ["contract", "agreement", "nda", "terms", "policy", "compliance", "legal", "signature"],
    "career": ["resume", "cv", "portfolio", "interview", "job", "application", "experience", "education"],
    "personal": ["personal", "family", "travel", "medical", "home", "notes", "photos", "journal"],
    "code": ["source code", "script", "repository", "bug", "build", "deployment", "api", "function"],
    "media": ["photo", "video", "screenshot", "image", "capture", "gallery", "clip", "thumbnail"],
    "documents": ["document", "report", "memo", "proposal", "specification", "notes", "draft"],
    "archives": ["archive", "backup", "compressed", "bundle", "zip", "extract", "package"],
    "installers": ["installer", "setup", "download", "msi", "exe", "package"],
}

SIMILARITY_THRESHOLD = 0.55


def _normalize_tags(tags):
    cleaned = []
    seen = set()
    for tag in tags:
        if not tag:
            continue
        value = re.sub(r"[^a-z0-9\- ]+", "", str(tag).strip().lower())
        value = value.replace(" ", "-").strip("-")
        if not value or value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
    return cleaned


def _base_tags(category):
    parts = [part.strip().lower() for part in str(category or "").split("/") if part.strip()]
    if not parts:
        parts = ["other"]
    return _normalize_tags(parts)


def _call_llm(llm, prompt):
    if llm is None:
        return None

    chat_model = llm
    if hasattr(llm, "chat_model") and getattr(llm, "chat_model") is not None:
        chat_model = getattr(llm, "chat_model")

    try:
        if hasattr(chat_model, "create_chat_completion"):
            response = chat_model.create_chat_completion(
                messages=[
                    {"role": "system", "content": "Return only comma-separated lowercase tags."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=32,
            )
            choices = response.get("choices", []) if isinstance(response, dict) else []
            if choices:
                message = choices[0].get("message", {})
                return (message.get("content") or "").strip()
        if callable(chat_model):
            return str(chat_model(prompt)).strip()
    except Exception:
        return None
    return None


def _cosine_similarity(doc_vector, keyword_vectors):
    if doc_vector is None or keyword_vectors is None or len(keyword_vectors) == 0:
        return 0.0
    doc = np.asarray(doc_vector, dtype=np.float32)
    matrix = np.asarray(keyword_vectors, dtype=np.float32)
    if doc.ndim > 1:
        doc = doc.reshape(-1)
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)
    doc_norm = np.linalg.norm(doc) or 1.0
    row_norms = np.linalg.norm(matrix, axis=1)
    row_norms = np.where(row_norms == 0, 1.0, row_norms)
    scores = (matrix @ doc) / (row_norms * doc_norm)
    return float(np.max(scores)) if scores.size else 0.0


async def generate_tags(path, category, extractor, embedder, llm) -> list[str]:
    tags = _base_tags(category)

    text_snippet = ""
    if extractor is not None:
        try:
            text_snippet, _reason = extract_text_with_status(path)
        except Exception:
            text_snippet = ""

    if not text_snippet.strip():
        filename = os.path.basename(path or "")
        text_snippet = f"{category} {filename} {path or ''}".strip()

    if embedder is not None and text_snippet.strip():
        try:
            doc_vector = await asyncio.to_thread(
                embedder.encode,
                [text_snippet[:1500]],
                normalize_embeddings=True,
            )
            doc_vector = doc_vector[0]
            for tag_name, keyword_list in TAG_TAXONOMY.items():
                keyword_texts = [" ".join(keyword_list)]
                keyword_vectors = await asyncio.to_thread(
                    embedder.encode,
                    keyword_texts,
                    normalize_embeddings=True,
                )
                score = _cosine_similarity(doc_vector, keyword_vectors)
                if score > SIMILARITY_THRESHOLD:
                    tags.append(tag_name)
        except Exception:
            pass

    tags = _normalize_tags(tags)

    if len(tags) < 3 and llm is not None:
        prompt = (
            f"Generate 3 short comma-separated lowercase tags for a file in category '{category}'. "
            "Return only tags separated by commas.\n\n"
            f"Text snippet:\n{text_snippet[:1500]}"
        )
        raw = await asyncio.to_thread(_call_llm, llm, prompt)
        if raw:
            parsed = [part.strip() for part in raw.split(",")]
            tags.extend(parsed)
            tags = _normalize_tags(tags)

    return tags[:6]
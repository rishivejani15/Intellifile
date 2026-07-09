import asyncio
import mimetypes
import os
import re
from pathlib import Path

from core.extractor import extract_text_with_status


CLASSIFICATION_CATEGORIES = [
    "Documents/Invoices",
    "Documents/Receipts",
    "Documents/Contracts",
    "Documents/Resumes",
    "Documents/Reports",
    "Documents/General",
    "Media/Screenshots",
    "Media/Images",
    "Media/Videos",
    "Media/Audio",
    "Archives",
    "Code",
    "Installers",
    "Other",
]

_FILENAME_RULES = [
    (re.compile(r"screenshot|screen[-_ ]?shot|snip", re.I), "Media/Screenshots"),
    (re.compile(r"invoice|bill|receipt", re.I), "Documents/Invoices"),
    (re.compile(r"contract|agreement|nda", re.I), "Documents/Contracts"),
    (re.compile(r"resume|cv|curriculum[-_ ]?vitae", re.I), "Documents/Resumes"),
    (re.compile(r"report|summary|annual", re.I), "Documents/Reports"),
    (re.compile(r"install|setup|installer|msi|pkg", re.I), "Installers"),
]

_EXTENSION_RULES = {
    ".pdf": "Documents/General",
    ".doc": "Documents/General",
    ".docx": "Documents/General",
    ".rtf": "Documents/General",
    ".odt": "Documents/General",
    ".txt": "Documents/General",
    ".md": "Documents/General",
    ".csv": "Documents/Reports",
    ".xls": "Documents/Reports",
    ".xlsx": "Documents/Reports",
    ".ppt": "Documents/Reports",
    ".pptx": "Documents/Reports",
    ".png": "Media/Images",
    ".jpg": "Media/Images",
    ".jpeg": "Media/Images",
    ".gif": "Media/Images",
    ".webp": "Media/Images",
    ".bmp": "Media/Images",
    ".tif": "Media/Images",
    ".tiff": "Media/Images",
    ".mp4": "Media/Videos",
    ".mov": "Media/Videos",
    ".mkv": "Media/Videos",
    ".avi": "Media/Videos",
    ".mp3": "Media/Audio",
    ".wav": "Media/Audio",
    ".flac": "Media/Audio",
    ".zip": "Archives",
    ".rar": "Archives",
    ".7z": "Archives",
    ".tar": "Archives",
    ".gz": "Archives",
    ".bz2": "Archives",
    ".xz": "Archives",
    ".exe": "Installers",
    ".msi": "Installers",
    ".appx": "Installers",
    ".msix": "Installers",
    ".ps1": "Code",
    ".py": "Code",
    ".js": "Code",
    ".ts": "Code",
    ".jsx": "Code",
    ".tsx": "Code",
    ".json": "Code",
    ".yaml": "Code",
    ".yml": "Code",
    ".html": "Code",
    ".css": "Code",
    ".cs": "Code",
    ".java": "Code",
    ".go": "Code",
    ".rs": "Code",
    ".c": "Code",
    ".cpp": "Code",
    ".h": "Code",
    ".sh": "Code",
}

_MIME_RULES = {
    "image/": "Media/Images",
    "video/": "Media/Videos",
    "audio/": "Media/Audio",
    "application/zip": "Archives",
    "application/x-7z-compressed": "Archives",
    "application/x-rar-compressed": "Archives",
    "application/x-msdownload": "Installers",
    "application/vnd.microsoft.portable-executable": "Installers",
}

_CONTENT_RULES = [
    (re.compile(r"\binvoice\b|\bbalance due\b|\bamount due\b|\bvat\b", re.I), "Documents/Invoices"),
    (re.compile(r"\breceipt\b|\bsubtotal\b|\btax\b|\bmerchant\b", re.I), "Documents/Receipts"),
    (re.compile(r"\bcontract\b|\bagreement\b|\bparty\b|\bterms\b", re.I), "Documents/Contracts"),
    (re.compile(r"\bresume\b|\bcurriculum vitae\b|\bexperience\b|\beducation\b", re.I), "Documents/Resumes"),
    (re.compile(r"\breport\b|\bsummary\b|\banalysis\b|\bfindings\b", re.I), "Documents/Reports"),
    (re.compile(r"\bscreenshot\b|\bui\b|\berror\b|\bcapture\b", re.I), "Media/Screenshots"),
]


def _filename_text(path):
    name = Path(path).name
    return re.sub(r"[_\-.]+", " ", name)


def classify_by_filename_pattern(path):
    name = _filename_text(path)
    for pattern, category in _FILENAME_RULES:
        if pattern.search(name):
            return category
    return None


def classify_by_extension(path):
    if not path:
        return None
    suffix = Path(path).suffix.lower()
    return _EXTENSION_RULES.get(suffix)


def classify_by_mime(path):
    mime, _ = mimetypes.guess_type(path or "")
    if not mime:
        return None
    for prefix, category in _MIME_RULES.items():
        if mime.startswith(prefix) or mime == prefix:
            return category
    if mime in {"text/plain", "text/markdown", "application/json", "text/csv"}:
        return "Documents/General"
    return None


def classify_by_content(text_snippet):
    if not text_snippet:
        return None
    snippet = text_snippet[:1500]
    for pattern, category in _CONTENT_RULES:
        if pattern.search(snippet):
            return category
    lowered = snippet.lower()
    if any(token in lowered for token in ("invoice", "amount due", "bill to")):
        return "Documents/Invoices"
    if any(token in lowered for token in ("resume", "curriculum vitae", "work experience")):
        return "Documents/Resumes"
    return None


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
                    {"role": "system", "content": "Return only the requested label."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
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


def classify_with_llm(text_snippet, llm):
    prompt = (
        "Classify the file into exactly one category from this list: "
        + ", ".join(CLASSIFICATION_CATEGORIES)
        + ". Return only the category string.\n\n"
        + (text_snippet[:1500] if text_snippet else "")
    )
    raw = _call_llm(llm, prompt)
    if not raw:
        return None

    cleaned = raw.strip().strip('"\'`')
    lower_cleaned = cleaned.lower()
    for category in CLASSIFICATION_CATEGORIES:
        if lower_cleaned == category.lower():
            return category
    for category in CLASSIFICATION_CATEGORIES:
        if category.lower() in lower_cleaned:
            return category
    return None


async def classify_file(path, extractor, llm) -> str:
    filename_category = classify_by_filename_pattern(path)
    if filename_category:
        return filename_category

    extension_category = classify_by_extension(path)
    if extension_category:
        return extension_category

    mime_category = classify_by_mime(path)
    if mime_category:
        return mime_category

    text_snippet = ""
    if extractor is not None:
        try:
            text_snippet, _reason = extract_text_with_status(path)
        except Exception:
            text_snippet = ""
        text_snippet = (text_snippet or "")[:1500]

    content_category = classify_by_content(text_snippet)
    if content_category:
        return content_category

    if text_snippet.strip():
        llm_category = await asyncio.to_thread(classify_with_llm, text_snippet, llm)
        if llm_category:
            return llm_category

    if not text_snippet.strip():
        return "Other"

    return "Other"
import re

# Max chunks any single file can produce (prevents outliers from dominating)
MAX_CHUNKS_PER_FILE = 40


def expand_camel_case(text: str) -> str:
    """
    Expands CamelCase and compound technical terms (e.g. 'DriveSafe' -> 'DriveSafe Drive Safe',
    'FastAPI' -> 'FastAPI Fast API') so that both compound and separate terms are indexed in
    FTS5 and captured by vector embeddings.
    """
    def _repl(match):
        word = match.group(0)
        split = re.sub(r'([a-z])([A-Z])', r'\1 \2', word)
        split = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', split)
        return f'{word} {split}' if split != word else word

    return re.sub(r'\b[A-Za-z0-9]+\b', _repl, text)


def chunk_text(text, chunk_size=280, overlap=45, doc_context=""):
    """
    Split *text* into overlapping chunks, preferring sentence boundaries and line breaks.
    Falls back to word-level splitting for very long paragraphs.

    chunk_size of ~280 words (≈ 350-400 tokens) comfortably fits within the 512-token
    context window of bge-small-en-v1.5 without truncation, while isolating individual
    projects, sections, and topics for high semantic similarity.

    Parameters
    ----------
    chunk_size  : int   – max words per chunk (default 280 words ≈ 380 tokens)
    overlap     : int   – words shared between consecutive chunks (default 45)
    doc_context : str   – optional parent document name/title to prepend to every chunk
                          so chunks maintain parent context for both FTS5 and vector search

    Returns
    -------
    list[str]
    """
    if not text or not text.strip():
        return []

    # Expand CamelCase so compound identifiers can be searched both merged and separated
    text = expand_camel_case(text)

    # Split on sentence-ending punctuation or line/paragraph breaks
    sentences = re.split(r'(?<=[.!?;])\s+|\n+', text.strip())
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return []

    chunks = []
    current = []          # word buffer
    step = max(chunk_size - overlap, 1)

    for sent in sentences:
        words = sent.split()
        if not words:
            continue

        # If adding this sentence overflows, flush current chunk
        if current and len(current) + len(words) > chunk_size:
            chunks.append(" ".join(current))
            current = current[-overlap:] if len(current) > overlap else list(current)

        current.extend(words)

        # Handle sentences longer than chunk_size
        while len(current) > chunk_size:
            chunks.append(" ".join(current[:chunk_size]))
            current = current[step:]

    # Flush remaining words
    if current:
        tail = " ".join(current)
        if not chunks or tail != chunks[-1]:
            chunks.append(tail)

    # Cap to prevent any single file from creating too many chunks
    if len(chunks) > MAX_CHUNKS_PER_FILE:
        # Keep evenly spaced chunks to maintain coverage
        step = len(chunks) / MAX_CHUNKS_PER_FILE
        chunks = [chunks[int(i * step)] for i in range(MAX_CHUNKS_PER_FILE)]

    # Prepend parent document context if provided
    if doc_context and doc_context.strip():
        prefix = f"[{doc_context.strip()}] "
        chunks = [f"{prefix}{c}" for c in chunks]

    return chunks
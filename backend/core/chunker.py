import re

# Max chunks any single file can produce (prevents outliers from dominating)
MAX_CHUNKS_PER_FILE = 40


def chunk_text(text, chunk_size=1000, overlap=150):
    """
    Split *text* into overlapping chunks, preferring sentence boundaries.
    Falls back to word-level splitting for very long paragraphs.

    Larger chunk_size (1000 words ≈ 512 tokens) matches the model's max
    input length, so we get the same quality with far fewer chunks.

    Parameters
    ----------
    chunk_size : int   – max words per chunk (1000 ≈ 512 model tokens)
    overlap    : int   – words shared between consecutive chunks

    Returns
    -------
    list[str]
    """
    if not text or not text.strip():
        return []

    # Split on sentence-ending punctuation or paragraph breaks
    sentences = re.split(r'(?<=[.!?;])\s+|\n{2,}', text.strip())
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

    return chunks
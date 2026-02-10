def chunk_text(text, chunk_size=400, overlap=80):
    """
    Split *text* into overlapping word-level chunks.

    Parameters
    ----------
    chunk_size : int
        Maximum number of words per chunk.
    overlap : int
        Number of words shared between consecutive chunks.
        Prevents loss of context at chunk boundaries.

    Returns
    -------
    list[str]
    """
    words = text.split()
    if not words:
        return []

    chunks = []
    start = 0
    step = max(chunk_size - overlap, 1)

    while start < len(words):
        end = start + chunk_size
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start += step

    return chunks
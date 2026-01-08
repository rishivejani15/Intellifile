def chunk_text(text,chunk_size = 400):
    """
    Splits text into chunks of chunk_size
    Returns a list of chunks strings
    """
    words = text.split()
    chunks = []
    
    current_chunk = []
    curret_len = 0
    
    for word in words:
        current_chunk.append(word)
        curret_len += 1
        
        if curret_len >= chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            curret_len = 0
        
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    
    return chunks
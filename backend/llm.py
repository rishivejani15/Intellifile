import os
import numpy as np
from llama_cpp import Llama
import subprocess
import sys

chat_model = None

def init_models():
    global chat_model
    if chat_model is not None:
        return

    models_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    chat_path = os.path.join(models_dir, "qwen2.5-3b-instruct-q4_k_m.gguf")

    if not os.path.exists(chat_path):
        print("Chat model not found at", chat_path)
        chat_model = None
        return

    print("Loading chat model...")
    chat_model = Llama(model_path=chat_path, chat_format="chatml", n_ctx=4096, verbose=False)
    print("Chat model loaded successfully")

# Initialize on module load
init_models()

def ingest_file(file_path):
    python_exe = sys.executable
    backend_dir = os.path.dirname(__file__)
    project_root = os.path.dirname(backend_dir)
    # Index the file
    subprocess.run([python_exe, "-m", "backend.search.index_files", file_path], cwd=project_root, check=True)
    # Build index
    subprocess.run([python_exe, "-m", "backend.search.build_index"], cwd=project_root, check=True)

def get_relevant_chunks(query, top_k=5):
    python_exe = sys.executable
    backend_dir = os.path.dirname(__file__)
    project_root = os.path.dirname(backend_dir)
    print(f"DEBUG: Running search for '{query}'...")
    result = subprocess.run([python_exe, "-m", "backend.search.search", query], cwd=project_root, capture_output=True, text=True)
    
    # print(f"DEBUG: Search stdout: {result.stdout}")
    # print(f"DEBUG: Search stderr: {result.stderr}")

    lines = result.stdout.strip().split('\n')
    chunks = []
    for line in lines:
        if '\t' in line:
            text, score = line.rsplit('\t', 1)
            chunks.append((text, float(score)))
    chunks = chunks[:top_k]
    print(f"DEBUG: Found {len(chunks)} chunks.")
    return chunks

def chat(query, chunks=None, on_token_callback=None):
    # ... (init handled globally)

    if chat_model is None:
        msg = "LLM model not available."
        if on_token_callback:
            on_token_callback(msg)
        return msg

    relevant_chunks = chunks if chunks is not None else get_relevant_chunks(query, top_k=5)
    try:
        print(f"DEBUG: Relevant chunks content: {str(relevant_chunks).encode('ascii', errors='replace').decode('ascii')}")
    except Exception:
        print("DEBUG: Relevant chunks content: <hidden due to encoding error>")

    # Deduplicate chunks by text, keeping the one with highest score
    unique_chunks = {}
    for text, score in relevant_chunks:
        if text not in unique_chunks or score > unique_chunks[text][1]:
            unique_chunks[text] = (text, score)
    relevant_chunks = list(unique_chunks.values())
    
    # Sort by score descending and take top 3
    relevant_chunks.sort(key=lambda x: x[1], reverse=True)
    relevant_chunks = relevant_chunks[:3]

    context_text = "\n---\n".join([text for text, _ in relevant_chunks]) if relevant_chunks else ""

    user_prompt = f"Document context:\n{context_text}\n\nQuestion: {query}" if context_text else f"Question: {query}"

    if on_token_callback:
        on_token_callback("Thinking... ")

    system_prompt = """You are a helpful and precise document assistant.
Use the provided document context to answer the user's question.
- For specific facts, verify they are in the context.
- For summaries or overviews, synthesize the available information.
- If the answer is not in the document, state that clearly.
- Maintain a professional and helpful tone."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    full_response = ""

    if on_token_callback:
        output = chat_model.create_chat_completion(messages=messages, max_tokens=1024, temperature=0.1, stream=True)
        for chunk in output:
            token = chunk['choices'][0]['delta'].get('content', '')
            full_response += token
            if on_token_callback:
                on_token_callback(token)
    else:
        output = chat_model.create_chat_completion(messages=messages, max_tokens=1024, temperature=0.1)
        full_response = output['choices'][0]['message']['content']

    return full_response

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "ingest_file":
            file_path = sys.argv[2]
            ingest_file(file_path)
        elif command == "chat":
            query = " ".join(sys.argv[2:])
            response = chat(query)
            print(response)
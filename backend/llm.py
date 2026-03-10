import os
import numpy as np
from llama_cpp import Llama
import subprocess
import sys
import requests
import json
import time
import logging

logger = logging.getLogger("IntelliFile.LLM")

chat_model = None
LLAMA_CPP_ENDPOINT = "http://127.0.0.1:8080/v1/chat/completions"

def init_models():
    global chat_model
    if chat_model is not None:
        return

    # Check if server is running
    try:
        response = requests.get("http://127.0.0.1:8080/v1/models", timeout=5)
        if response.status_code == 200:
            print("Chat model loaded successfully")
            chat_model = "server"  # Indicate server is used
            return
    except:
        pass

    # Fallback to local loading
    models_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    
    # Priority 1: 1.5B Model (Target for Lightning Speed)
    # Priority 2: 3B Model (Current fallback)
    chat_path_1_5b = os.path.join(models_dir, "qwen2.5-1.5b-instruct-q4_k_m.gguf")
    chat_path_3b = os.path.join(models_dir, "qwen2.5-3b-instruct-q4_k_m.gguf")

    if os.path.exists(chat_path_1_5b):
        chat_path = chat_path_1_5b
        model_name = "Qwen 1.5B"
    elif os.path.exists(chat_path_3b):
        chat_path = chat_path_3b
        model_name = "Qwen 3B"
    else:
        print("Chat model not found! Please place 'qwen2.5-1.5b-instruct-q4_k_m.gguf' in the models folder.")
        chat_model = None
        return

    print(f"Loading {model_name}...")
    # OPTIMIZED FOR CPU SPEED:
    # 1. n_batch: 512 - Processes the prompt much faster
    # 2. n_threads: 8 - Uses more CPU cores (adjust to your CPU)
    # 3. n_gpu_layers: 0 - (Set to -1 if you have an NVIDIA/Apple GPU)
    chat_model = Llama(
        model_path=chat_path, 
        chat_format="chatml", 
        n_ctx=2048, 
        n_batch=512,
        n_threads=4, 
        n_gpu_layers=0,
        verbose=False
    )
    print(f"{model_name} loaded successfully (Optimized for speed)")


def is_chat_model_loaded():
    return chat_model is not None


# Initialize on module load
# init_models()  <-- Removed to prevent blocking


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

def chat(query, chunks=None, stream=False):
    start_time = time.time()
    print(f"\n[DEBUG] Starting Chat Process at {time.strftime('%H:%M:%S')}")

    if chat_model is None:
        msg = "LLM model not available."
        if stream:
            yield msg
            return
        return msg

    # 1. Retrieval Timing
    retr_start = time.time()
    relevant_chunks = chunks if chunks is not None else get_relevant_chunks(query, top_k=5)
    retr_end = time.time()
    print(f"[DEBUG] 1. Retrieval took {retr_end - retr_start:.2f}s (Found {len(relevant_chunks)} raw chunks)")
    
    # 2. Filtering/Context Prep Timing
    prep_start = time.time()
    unique_chunks = {}
    for text, score in relevant_chunks:
        if text not in unique_chunks or score > unique_chunks[text][1]:
            unique_chunks[text] = (text, score)
    relevant_chunks = list(unique_chunks.values())
    
    relevant_chunks.sort(key=lambda x: x[1], reverse=True)
    relevant_chunks = relevant_chunks[:2]

    context_text = "\n---\n".join([text for text, _ in relevant_chunks]) if relevant_chunks else ""
    user_prompt = f"Document context:\n{context_text}\n\nQuestion: {query}" if context_text else f"Question: {query}"
    prep_end = time.time()
    print(f"[DEBUG] 2. Context preparation took {prep_end - prep_start:.4f}s")

    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": user_prompt}
    ]

    print(f"[DEBUG] 3. Entering Generation Phase (Mode: {'Server' if chat_model == 'server' else 'Local'}, Stream: {stream})")
    gen_start = time.time()
    first_token_received = False

    if chat_model == "server":
        # Use server
        data = {
            "model": "qwen2.5-1.5b-instruct-q4_k_m",
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.1,
            "stream": stream
        }
        try:
            if stream:
                # Use requests with stream=True for the server call
                response = requests.post(LLAMA_CPP_ENDPOINT, json=data, timeout=120, stream=True)
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        line_decoded = line.decode('utf-8')
                        if line_decoded.startswith("data: "):
                            content = line_decoded[6:]
                            if content.strip() == "[DONE]":
                                break
                            try:
                                json_data = json.loads(content)
                                token = json_data['choices'][0]['delta'].get('content', '')
                                if token:
                                    if not first_token_received:
                                        print(f"[DEBUG] First token received from server after {time.time() - gen_start:.2f}s")
                                        first_token_received = True
                                    yield token
                            except:
                                continue
            else:
                response = requests.post(LLAMA_CPP_ENDPOINT, json=data, timeout=60)
                response.raise_for_status()
                result = response.json()
                print(f"[DEBUG] Generation completed in {time.time() - gen_start:.2f}s")
                return result['choices'][0]['message']['content']
        except Exception as e:
            err_msg = f"Error calling LLM server: {e}"
            print(f"[DEBUG] SERVER ERROR: {e}")
            if stream: yield err_msg
            else: return err_msg
    else:
        # Local model
        try:
            if stream:
                output = chat_model.create_chat_completion(messages=messages, max_tokens=512, temperature=0.1, stream=True)
                for chunk in output:
                    token = chunk['choices'][0]['delta'].get('content', '')
                    if token:
                        if not first_token_received:
                            print(f"[DEBUG] First token received from local LLM after {time.time() - gen_start:.2f}s")
                            first_token_received = True
                        yield token
                print(f"[DEBUG] Total stream duration: {time.time() - gen_start:.2f}s")
            else:
                output = chat_model.create_chat_completion(messages=messages, max_tokens=512, temperature=0.1)
                print(f"[DEBUG] Local generation took {time.time() - gen_start:.2f}s")
                return output['choices'][0]['message']['content']
        except MemoryError:
            err_msg = "Error: System ran out of memory while generating response."
            print(f"[DEBUG] MEMORY ERROR: {err_msg}")
            if stream: yield err_msg
            else: return err_msg
        except Exception as e:
            err_msg = f"Error generating response: {e}"
            print(f"[DEBUG] GENERATION ERROR: {e}")
            if stream: yield err_msg
            else: return err_msg

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
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

# Global Chat State
_chat_history = [] # List of {"role": "role", "content": "text"}
_last_ingested_file = {"path": None, "mtime": 0}

def reset_chat_history():
    global _chat_history
    _chat_history = []
    print("DEBUG: Chat history cleared.")

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
    # OPTIMIZED FOR SPEED:
    # 1. n_batch: 512 - Processes the prompt much faster
    # 2. n_threads: all CPU cores for max throughput
    # 3. n_gpu_layers: -1 - Offload all layers to GPU if available
    import multiprocessing
    cpus = multiprocessing.cpu_count()
    threads = cpus
    
    chat_model = Llama(
        model_path=chat_path, 
        chat_format="chatml", 
        n_ctx=2048, 
        n_batch=512,
        n_threads=threads, 
        n_gpu_layers=-1,
        verbose=False
    )
    print(f"{model_name} loaded successfully (Using {threads} threads)")


def is_chat_model_loaded():
    return chat_model is not None


# Initialize on module load
init_models() 


def ingest_file(file_path):
    global _last_ingested_file
    
    # Check if we really need to re-ingest
    try:
        current_mtime = os.path.getmtime(file_path)
        if _last_ingested_file["path"] == file_path and _last_ingested_file["mtime"] == current_mtime:
            print(f"DEBUG: File {file_path} is already the active context and hasn't changed. Skipping ingestion.")
            return
    except:
        pass

    python_exe = sys.executable
    backend_dir = os.path.dirname(__file__)
    print(f"DEBUG: Ingesting file {file_path}")
    
    try:
        # Index the file
        subprocess.run([python_exe, "-m", "search.index_files", file_path], cwd=backend_dir, check=True)
        # Build FAISS index
        subprocess.run([python_exe, "-m", "search.build_index"], cwd=backend_dir, check=True)
        
        # Update cache
        _last_ingested_file = {"path": file_path, "mtime": os.path.getmtime(file_path)}
        # Reset history when a new file is ingested
        reset_chat_history()
        print("DEBUG: Ingestion successful. Chat history reset.")
        
    except Exception as e:
        print(f"DEBUG: Ingestion failed: {e}")
        raise

def get_relevant_chunks(query, top_k=5):
    try:
        from search.search import semantic_search
        
        # Improve retrieval for brief follow-ups
        search_query = query
        if len(_chat_history) >= 2:
            query_lower = query.lower()
            pronouns = ["that", "it", "this", "them", "those", "explain", "more", "why", "how", "tell", "describe"]
            is_brief = len(query.split()) < 4
            is_continuation = any(p in query_lower for p in pronouns)
            
            if is_brief or is_continuation:
                # Append last user message to help narrow down context
                last_user_msg = _chat_history[-2]["content"]
                # Keep it concise for embeddings
                context_hint = " ".join(last_user_msg.split()[:10]) 
                search_query = f"{context_hint} {query}"
                print(f"DEBUG: Follow-up detected. Search hint: '{context_hint}'")

        print(f"DEBUG: Running internal search for '{search_query}'...")
        results = semantic_search(search_query, top_k=top_k)
        print(f"DEBUG: Found {len(results)} chunks.")
        return results
    except Exception as e:
        print(f"DEBUG: Search failed: {e}")
        return []

def chat(query, chunks=None, stream=False):
    start_time = time.time()
    print(f"\n[DEBUG] Starting Chat Process at {time.strftime('%H:%M:%S')}")

    if chat_model is None:
        msg = "LLM model not available."
        if stream:
            yield msg
            return
        yield msg
        return

    # 1. Retrieval Timing
    retr_start = time.time()
    relevant_chunks = chunks if chunks is not None else get_relevant_chunks(query, top_k=3)
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
    
    is_summary = "summar" in query.lower() or "overview" in query.lower()
    top_n = 5 if is_summary else 3
    relevant_chunks = relevant_chunks[:top_n]

    context_text = "\n---\n".join([text for text, _ in relevant_chunks]) if relevant_chunks else ""
    
    if is_summary:
        user_prompt = f"Based on these parts of the document:\n{context_text}\n\nPlease provide a comprehensive summary."
    else:
        user_prompt = f"Document context:\n{context_text}\n\nQuestion: {query}" if context_text else f"Question: {query}"
    
    prep_end = time.time()
    print(f"[DEBUG] 2. Context preparation took {prep_end - prep_start:.4f}s (Top {len(relevant_chunks)} chunks used)")

    messages = [
        {"role": "system", "content": "You are a helpful AI assistant. Use the provided document context to answer questions. If the question is a follow-up, use the conversation history to maintain context. If the answer is not in the context or history, you can use your general knowledge but clearly state if the info is not in the document."}
    ]
    
    # Add relevant history (last 3 turns / 6 messages)
    if _chat_history:
        messages.extend(_chat_history[-6:])
    
    messages.append({"role": "user", "content": user_prompt})
    
    print(f"[DEBUG] Prompt turns: {len(messages)//2}. Current context used.")

    print(f"[DEBUG] 3. Entering Generation Phase (Mode: {'Server' if chat_model == 'server' else 'Local'}, Stream: {stream})")
    gen_start = time.time()
    first_token_received = False

    if chat_model == "server":
        # Use server
        data = {
            "model": "qwen2.5-1.5b-instruct-q4_k_m",
            "messages": messages,
            "max_tokens": 300,
            "temperature": 0.7,
            "top_p": 0.9,
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
                yield result['choices'][0]['message']['content']
                return
        except Exception as e:
            err_msg = f"Error calling LLM server: {e}"
            print(f"[DEBUG] SERVER ERROR: {e}")
            yield err_msg
            return
    else:
        # Local model
        try:
            if stream:
                output = chat_model.create_chat_completion(messages=messages, max_tokens=300, temperature=0.7, top_p=0.9, stream=True)
                for chunk in output:
                    token = chunk['choices'][0]['delta'].get('content', '')
                    if token:
                        if not first_token_received:
                            print(f"[DEBUG] First token received from local LLM after {time.time() - gen_start:.2f}s")
                            first_token_received = True
                        yield token
                print(f"[DEBUG] Total stream duration: {time.time() - gen_start:.2f}s")
            else:
                max_toks = 400 if is_summary else 300
                output = chat_model.create_chat_completion(
                    messages=messages, 
                    max_tokens=max_toks, 
                    temperature=0.7,
                    top_p=0.9
                )
                print(f"[DEBUG] Local generation took {time.time() - gen_start:.2f}s")
                print(f"[DEBUG] Raw completion output: {output}")
                
                content = output['choices'][0]['message'].get('content', '')
                if not content:
                    print("[DEBUG] CONTENT IS EMPTY. Checking for logic errors.")
                else:
                    # Update local history
                    _chat_history.append({"role": "user", "content": query})
                    _chat_history.append({"role": "assistant", "content": content})
                
                yield content
                return
        except MemoryError:
            err_msg = "Error: System ran out of memory while generating response."
            print(f"[DEBUG] MEMORY ERROR: {err_msg}")
            yield err_msg
            return
        except Exception as e:
            err_msg = f"Error generating response: {e}"
            print(f"[DEBUG] GENERATION ERROR: {e}")
            yield err_msg
            return
    
    # Final check for empty results
    # (Note: this part only reached if not returned/yielded above)
    yield "AI could not generate a response. Please try again."

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
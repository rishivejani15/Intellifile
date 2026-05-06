import os
import sys
import requests
import json
import time
import logging
from typing import List

LLAMA_IMPORT_ERROR = ""
try:
    from llama_cpp import Llama
except Exception as e:
    print(f"Failed to import llama_cpp: {e}")
    LLAMA_IMPORT_ERROR = str(e)
    Llama = None

# Ensure backend root is available for canonical core/indexing imports.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from .chat_store import ingest_chat_file, search_chat_chunks

logger = logging.getLogger("IntelliFile.LLM")

chat_model = None
LLAMA_CPP_ENDPOINT = "http://127.0.0.1:8080/v1/chat/completions"
CHAT_LOCK_REASON = ""
CHAT_MODE = "none"

# Global Chat State
_chat_history = [] # List of {"role": "role", "content": "text"}

def reset_chat_history():
    global _chat_history
    _chat_history = []
    print("DEBUG: Chat history cleared.")


def _detect_build_tools_missing_reason() -> str:
    """Return a human-readable lock reason when local llama backend cannot be used."""
    if not LLAMA_IMPORT_ERROR:
        return ""

    err = LLAMA_IMPORT_ERROR.lower()
    build_tool_markers = [
        "microsoft visual c++",
        "build tools",
        "cl.exe",
        "unable to find vcvarsall",
        "subprocess-exited-with-error",
        "could not build wheels",
    ]

    # If import failure likely indicates missing compiler chain, lock with explicit guidance.
    if any(marker in err for marker in build_tool_markers):
        return "Chat is disabled: Visual Studio C++ Build Tools are required for local model support."

    # Generic import failure fallback.
    return f"Chat is disabled: llama-cpp failed to load ({LLAMA_IMPORT_ERROR})."


def get_chat_status():
    enabled = chat_model is not None
    return {
        "enabled": enabled,
        "mode": CHAT_MODE,
        "reason": "" if enabled else CHAT_LOCK_REASON,
        "llama_import_error": LLAMA_IMPORT_ERROR,
    }

def init_models():
    global chat_model, CHAT_LOCK_REASON, CHAT_MODE
    if chat_model is not None:
        return

    # Check if server is running
    try:
        response = requests.get("http://127.0.0.1:8080/v1/models", timeout=5)
        if response.status_code == 200:
            print("Chat model loaded successfully")
            chat_model = "server"  # Indicate server is used
            CHAT_MODE = "server"
            CHAT_LOCK_REASON = ""
            return
    except:
        pass

    # Fallback to local loading
    if Llama is None:
        print("llama_cpp is not installed. Local model loading disabled; server mode only.")
        chat_model = None
        CHAT_MODE = "none"
        CHAT_LOCK_REASON = _detect_build_tools_missing_reason() or (
            "Chat is disabled: no local model backend available and remote model server is not running."
        )
        return

    # Respect per-user / packaged model dir via core.paths
    try:
        from core.paths import get_models_dir
        models_dir = get_models_dir()
    except Exception:
        models_dir = os.path.join(_BACKEND_DIR, "models")
    
    # Priority 1: 1.5B Model (Target for Lightning Speed)
    # Priority 2: 3B Model (Current fallback)
    chat_path_1_5b = os.path.join(models_dir, "qwen2.5-1.5b-instruct-q4_k_m.gguf")
    chat_path_3b = os.path.join(models_dir, "qwen2.5-3b-instruct-q5_k_m.gguf")

    if os.path.exists(chat_path_1_5b):
        chat_path = chat_path_1_5b
        model_name = "Qwen 1.5B"
    elif os.path.exists(chat_path_3b):
        chat_path = chat_path_3b
        model_name = "Qwen 3B"
    else:
        print("Chat model not found! Please place 'qwen2.5-1.5b-instruct-q4_k_m.gguf' in the models folder.")
        chat_model = None
        CHAT_MODE = "none"
        CHAT_LOCK_REASON = "Chat is disabled: no local GGUF model file found in backend/models."
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
        n_ctx=4096, 
        n_batch=512,
        n_threads=threads, 
        n_gpu_layers=-1,
        verbose=False
    )
    CHAT_MODE = "local"
    CHAT_LOCK_REASON = ""
    print(f"{model_name} loaded successfully (Using {threads} threads)")


def is_chat_model_loaded():
    return chat_model is not None


# Initialize on module load
init_models() 


def ingest_file(file_path):
    print(f"DEBUG: Ingesting file through isolated chat pipeline: {file_path}")
    try:
        ingest_start = time.perf_counter()
        file_size_bytes = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
        result = ingest_chat_file(file_path, clear_existing=True)
        elapsed_ms = int((time.perf_counter() - ingest_start) * 1000)
        ingest_ms = int(result.get("ingest_ms", elapsed_ms))
        file_size_mb = file_size_bytes / (1024 * 1024) if file_size_bytes else 0.0

        print(
            "DEBUG: Ingest metrics | "
            f"size={file_size_bytes}B ({file_size_mb:.2f}MB) | "
            f"chunks={int(result.get('new_chunks', 0))} | "
            f"time={ingest_ms}ms"
        )

        if result.get("status") == "indexed":
            reset_chat_history()
            print(f"DEBUG: Indexed {result.get('new_chunks', 0)} chunks. Chat history reset.")
        elif result.get("status") == "skipped":
            print("DEBUG: Ingestion skipped for unchanged file.")
        else:
            print("DEBUG: File unchanged; ingestion skipped.")
        return result
    except Exception as e:
        print(f"DEBUG: Ingestion failed: {e}")
        raise


def get_relevant_chunks(query, top_k=5):
    try:
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

        print(f"DEBUG: Running isolated chat retrieval for '{search_query}'...")
        scored_chunks = search_chat_chunks(search_query, top_k=max(top_k, 3))

        print(f"DEBUG: Found {len(scored_chunks)} context chunks from chat store.")
        return scored_chunks
    except Exception as e:
        print(f"DEBUG: Search failed: {e}")
        return []

def chat(query, chunks=None, stream=False):
    start_time = time.time()
    print(f"\n[DEBUG] Starting Chat Process at {time.strftime('%H:%M:%S')}")

    if chat_model is None:
        msg = CHAT_LOCK_REASON or "LLM model not available."
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
    full_response_parts: List[str] = []

    if chat_model == "server":
        # Use server
        data = {
            "model": "qwen2.5-1.5b-instruct-q4_k_m",
            "messages": messages,
            "max_tokens": 150 if not is_summary else 250,
            "temperature": 0.2,
            "top_p": 0.85,
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
                                    full_response_parts.append(token)
                                    yield token
                            except:
                                continue
                full_content = "".join(full_response_parts).strip()
                if full_content:
                    _chat_history.append({"role": "user", "content": query})
                    _chat_history.append({"role": "assistant", "content": full_content})
            else:
                response = requests.post(LLAMA_CPP_ENDPOINT, json=data, timeout=60)
                response.raise_for_status()
                result = response.json()
                print(f"[DEBUG] Generation completed in {time.time() - gen_start:.2f}s")
                content = result['choices'][0]['message']['content']
                if content:
                    _chat_history.append({"role": "user", "content": query})
                    _chat_history.append({"role": "assistant", "content": content})
                yield content
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
                output = chat_model.create_chat_completion(messages=messages, max_tokens=150 if not is_summary else 250, temperature=0.2, top_p=0.85, stream=True)
                for chunk in output:
                    token = chunk['choices'][0]['delta'].get('content', '')
                    if token:
                        if not first_token_received:
                            print(f"[DEBUG] First token received from local LLM after {time.time() - gen_start:.2f}s")
                            first_token_received = True
                        full_response_parts.append(token)
                        yield token
                print(f"[DEBUG] Total stream duration: {time.time() - gen_start:.2f}s")
                full_content = "".join(full_response_parts).strip()
                if full_content:
                    _chat_history.append({"role": "user", "content": query})
                    _chat_history.append({"role": "assistant", "content": full_content})
            else:
                max_toks = 250 if is_summary else 150
                output = chat_model.create_chat_completion(
                    messages=messages, 
                    max_tokens=max_toks, 
                    temperature=0.2,
                    top_p=0.85
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
import os
import subprocess
import sys
import time
import requests

BACKEND_URL = "http://127.0.0.1:8001"

def start_llm_server():
    backend_path = os.path.join(os.path.dirname(__file__), "..")
    model_path = os.path.join(backend_path, "models", "qwen2.5-1.5b-instruct-q4_k_m.gguf")
    if not os.path.exists(model_path):
        print("LLM Model not found at:", model_path)
        print("Please download Qwen model to models/ folder.")
        return None
    python_executable = sys.executable
    print(f"Starting LLM Server with: {python_executable}")
    print(f"Model: {model_path}")
    process = subprocess.Popen([
        python_executable, "-m", "llama_cpp.server",
        "--model", model_path,
        "--host", "127.0.0.1",
        "--port", "8080"
    ], cwd=backend_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return process

def start_backend():
    backend_path = os.path.dirname(__file__)
    python_executable = sys.executable
    print(f"Starting backend with: {python_executable}")
    process = subprocess.Popen([python_executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"], cwd=backend_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return process

def check_backend():
    for i in range(60):
        try:
            response = requests.get(f"{BACKEND_URL}/health")
            print("Backend is ready and responding!")
            return
        except:
            time.sleep(1)
    print("Backend failed to respond after 60 seconds.")

if __name__ == "__main__":
    llm_process = start_llm_server()
    backend_process = start_backend()
    check_backend()
    try:
        llm_process.wait()
        backend_process.wait()
    except KeyboardInterrupt:
        if backend_process:
            backend_process.terminate()
        if llm_process:
            llm_process.terminate()
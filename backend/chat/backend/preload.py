import os
import requests

BACKEND_URL = "http://127.0.0.1:8001"

# File system API

def open_file():
    # In a real app, use a file dialog library, but for backend, perhaps return None
    # For simulation, assume file path is provided
    return {"filePath": "", "content": ""}

def read_folder(path):
    items = []
    for item in os.listdir(path):
        full_path = os.path.join(path, item)
        stat = os.stat(full_path)
        items.append({
            "name": item,
            "path": full_path,
            "isDirectory": os.path.isdir(full_path),
            "size": stat.st_size,
            "modified": stat.st_mtime,
        })
    return items

def get_root_folders():
    home = os.path.expanduser("~")
    return [
        {"name": "Documents", "path": os.path.join(home, "Documents")},
        {"name": "Downloads", "path": os.path.join(home, "Downloads")},
        {"name": "Desktop", "path": os.path.join(home, "Desktop")},
    ]

# Ingest document

def ingest_document(file_path):
    with open(file_path, 'rb') as f:
        files = {'file': f}
        response = requests.post(f"{BACKEND_URL}/upload", files=files)
    return response.json()

# AI Streaming (simulated)

def start_chat(query):
    response = requests.post(f"{BACKEND_URL}/ask", json={"query": query, "top_k": 5})
    return response.json()['answer']

# Note: Streaming and listeners are not directly translatable to Python backend without websockets or similar.
# In a Python app, you might use asyncio or callbacks differently.
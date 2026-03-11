import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
import subprocess
import sys
import os
import threading
import time

# Import backend functions
sys.path.append('backend')
from llm import ingest_file, chat

class IntelliFileApp:
    def __init__(self, root):
        self.root = root
        self.root.title("IntelliFile")
        self.root.geometry("800x600")

        # Start backend in background
        self.backend_process = None
        self.start_backend()

        # GUI Elements
        self.create_widgets()

    def start_backend(self):
        backend_path = os.path.join(os.getcwd(), "backend")
        python_exe = sys.executable
        self.backend_process = subprocess.Popen([python_exe, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"], cwd=backend_path)

    def create_widgets(self):
        # Menu
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)

        file_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=file_menu)
        file_menu.add_command(label="Open Document", command=self.open_file)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)

        # Chat area
        self.chat_frame = tk.Frame(self.root)
        self.chat_frame.pack(pady=10, padx=10, fill=tk.BOTH, expand=True)

        self.chat_display = scrolledtext.ScrolledText(self.chat_frame, wrap=tk.WORD, height=20)
        self.chat_display.pack(fill=tk.BOTH, expand=True)

        self.query_entry = tk.Entry(self.root, width=50)
        self.query_entry.pack(pady=5)
        self.query_entry.bind("<Return>", lambda e: self.send_query())

        self.send_button = tk.Button(self.root, text="Send", command=self.send_query)
        self.send_button.pack(pady=5)

    def open_file(self):
        file_path = filedialog.askopenfilename(filetypes=[("Documents", "*.pdf *.docx *.txt")])
        if file_path:
            try:
                ingest_file(file_path)
                messagebox.showinfo("Success", "Document ingested successfully!")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to ingest document: {str(e)}")

    def send_query(self):
        query = self.query_entry.get().strip()
        if not query:
            return
        self.query_entry.delete(0, tk.END)
        self.chat_display.insert(tk.END, f"You: {query}\n")
        self.chat_display.see(tk.END)

        # Run chat in thread to avoid blocking GUI
        threading.Thread(target=self.process_query, args=(query,)).start()

    def process_query(self, query):
        try:
            response = chat(query)
            self.chat_display.insert(tk.END, f"AI: {response}\n\n")
            self.chat_display.see(tk.END)
        except Exception as e:
            self.chat_display.insert(tk.END, f"Error: {str(e)}\n\n")
            self.chat_display.see(tk.END)

    def on_closing(self):
        if self.backend_process:
            self.backend_process.terminate()
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = IntelliFileApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()
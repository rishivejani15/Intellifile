import os

SUPPORTED_EXT = (".pdf",".docx",".txt")

def scan_folder(folder):
    files = []
    for root , _, filenames in os.walk(folder):
        for filename in filenames:
            if filename.lower().endswith(SUPPORTED_EXT):
                files.append(os.path.join(root, filename))
    return files
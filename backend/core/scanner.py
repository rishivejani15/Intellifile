import os

# Document & code file extensions supported for indexing
SUPPORTED_EXT = (
    # Documents
    ".pdf", ".docx", ".txt", ".md", ".rtf",
    # Code / config
    ".py", ".js", ".jsx", ".ts", ".tsx",
    ".java", ".cpp", ".c", ".h", ".hpp",
    ".go", ".rs", ".rb", ".php",
    ".html", ".css", ".json", ".xml", ".yaml", ".yml",
    ".sh", ".bat", ".ps1",
    ".sql", ".csv", ".log",
)


def scan_folder(folder):
    """Recursively collect all supported files under *folder*."""
    files = []
    for root, _, filenames in os.walk(folder):
        for filename in filenames:
            if filename.lower().endswith(SUPPORTED_EXT):
                files.append(os.path.join(root, filename))
    return files
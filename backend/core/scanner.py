import os
import concurrent.futures

# Document & media file extensions supported for indexing
SUPPORTED_EXT = (
    # Documents
    ".pdf", ".docx", ".doc", ".txt", ".md", ".rtf", ".odt",
    # Spreadsheets
    ".xlsx", ".xls", ".csv",
    # Presentations
    ".pptx", ".ppt",
)

# Skip system, app, and development folders
IGNORE_DIRS = {
    # Windows system
    "windows", "program files", "program files (x86)", "programdata",
    "$recycle.bin", "system volume information", "recovery",
    "msocache", "intel", "perflogs", "boot",
    # User app data / caches
    "appdata", ".cache", ".local", ".config",
    # Browsers
    "google", "mozilla", "edge", "chrome", "firefox",
    # Dev / build
    "node_modules", ".git", ".venv", "venv", "__pycache__",
    "build", "dist", "out", "target", "bin", "obj",
    ".vs", ".idea", ".vscode", "packages", "site-packages",
    # Package managers / runtimes
    "npm", "pip", "conda", ".nuget", ".cargo", ".rustup",
    ".gradle", ".m2", ".npm", ".yarn",
    # App-specific
    "steam", "steamapps", "origin", "epicgames",
    "nvidia", "amd", "logs", "temp", "tmp",
}

def get_logical_drives():
    """Return a list of available Windows drives (e.g. ['C:\\', 'D:\\'])."""
    drives = []
    if os.name == 'nt':
        import string
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for letter in string.ascii_uppercase:
            if bitmask & 1:
                drives.append(f"{letter}:\\")
            bitmask >>= 1
    else:
        drives = ["/"]
    return drives

def is_ignored(dirname):
    return dirname.lower() in IGNORE_DIRS

def _scan_directory(folder):
    """Scan a single folder recursively using os.scandir. Yields (path, mtime)."""
    try:
        with os.scandir(folder) as it:
            for entry in it:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if not is_ignored(entry.name):
                        yield from _scan_directory(entry.path)
                elif entry.is_file():
                    if entry.name.lower().endswith(SUPPORTED_EXT):
                        try:
                            # entry.stat() is fast on Windows os.scandir
                            st = entry.stat()
                            # Skip files > 50MB
                            if st.st_size <= 50 * 1024 * 1024:
                                yield (entry.path, int(st.st_mtime))
                        except OSError:
                            pass
    except PermissionError:
        pass
    except FileNotFoundError:
        pass
    except OSError:
        pass

def fast_scan_device(max_workers=8):
    """
    Scans all available drives concurrently.
    Yields (filepath, mtime) tuples.
    """
    drives = get_logical_drives()
    top_level_dirs = []
    
    # Get top-level directories of all drives to distribute work uniformly across threads
    for drive in drives:
        try:
            with os.scandir(drive) as it:
                for entry in it:
                    if entry.is_dir() and not is_ignored(entry.name) and not entry.is_symlink():
                        top_level_dirs.append(entry.path)
                    elif entry.is_file() and entry.name.lower().endswith(SUPPORTED_EXT):
                        try:
                            st = entry.stat()
                            if st.st_size <= 50 * 1024 * 1024:
                                yield (entry.path, int(st.st_mtime))
                        except OSError:
                            pass
        except OSError:
            pass

    # Process all top-level directories in a ThreadPool
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all top-level directories to the executor
        future_to_dir = {executor.submit(lambda d=d: list(_scan_directory(d))): d for d in top_level_dirs}
        for future in concurrent.futures.as_completed(future_to_dir):
            try:
                results = future.result()
                for res in results:
                    yield res
            except Exception:
                pass
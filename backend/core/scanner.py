import os
import concurrent.futures

# Only human-readable document formats — no code, no system files
SUPPORTED_EXT = (
    ".pdf",
    ".docx",
    ".txt",
    ".pptx",
    ".csv",
    ".xlsx", ".xls",
    ".png", ".jpg", ".jpeg",
)

# Skip common junk/temporary/system-like files even in user folders
SKIP_EXT = (
    ".log", ".tmp", ".bak", ".old", ".cache", ".dmp",
    ".swp", ".swo", ".part", ".crdownload", ".download",
    ".lnk", ".url",
)

SKIP_NAMES = {
    "thumbs.db",
    "desktop.ini",
    ".ds_store",
}

SKIP_PREFIXES = ("~$", "._")

SKIP_SUFFIXES = ("~",)

def _is_valid_size(filename, size):
    # Default cap of 50MB
    if size > 50 * 1024 * 1024:
        return False
    # If image, must be 50KB to 15MB
    if filename.lower().endswith((".png", ".jpg", ".jpeg")):
        return 50 * 1024 <= size <= 15 * 1024 * 1024
    return True

def _is_supported_file(filename):
    name = (filename or "").lower()
    if not name:
        return False
    if name in SKIP_NAMES:
        return False
    if name.startswith("."):
        return False
    if any(name.startswith(prefix) for prefix in SKIP_PREFIXES):
        return False
    if any(name.endswith(suffix) for suffix in SKIP_SUFFIXES):
        return False
    if name.endswith(SKIP_EXT):
        return False
    return name.endswith(SUPPORTED_EXT)


def is_indexable_document(path):
    """Return True when a path is eligible for content indexing."""
    if not path:
        return False

    lower_path = str(path).lower()
    filename = os.path.basename(lower_path)
    if not _is_supported_file(filename):
        return False

    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXT


def _has_system_attrs(stat_result):
    if os.name != "nt":
        return False
    attrs = getattr(stat_result, "st_file_attributes", 0)
    return bool(attrs & 0x6)  # FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM


def _is_hidden_or_system_entry(entry):
    name = (entry.name or "")
    if name.startswith("."):
        return True
    try:
        return _has_system_attrs(entry.stat())
    except OSError:
        return True

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
    ".vs", ".idea", ".vscode", ".antigravity", "packages", "site-packages",
    # Package managers / runtimes
    "npm", "pip", "conda", ".nuget", ".cargo", ".rustup",
    ".gradle", ".m2", ".npm", ".yarn",
    # App-specific
    "steam", "steamapps", "origin", "epicgames", "epic games", "steam library",
    "nvidia", "amd", "logs", "temp", "tmp",
    # Games / caches / code folders
    "game", "games", "gamecache", "game cache", "shadercache",
    "cache", "caches",
    "code", "codes",
    # SDKs / frameworks
    "flutter", "android", "sdk",
    # Generic system folders
    "system", "system32",
}

_DEFAULT_USER_DIRS = [
    "Documents",
    "Desktop",
    "Downloads",
    "Pictures",
    "Music",
    "Videos",
]


def _normalize_roots(roots):
    if isinstance(roots, (str, os.PathLike)):
        roots = [str(roots)]
    normalized = []
    for root in roots or []:
        if not root:
            continue
        expanded = os.path.abspath(os.path.expanduser(root))
        if os.path.exists(expanded):
            normalized.append(expanded)
    return normalized


def get_default_index_roots():
    """Return default root folders to index, or None to scan all drives."""
    env_roots = os.getenv("IF_INDEX_ROOTS", "").strip()
    if env_roots:
        return _normalize_roots(env_roots.split(os.pathsep))

    scope = os.getenv("IF_INDEX_SCOPE", "").strip().lower()
    if scope in {"all", "all_drives", "device"}:
        return None

    user_home = os.path.expanduser("~")
    user_profile = os.getenv("USERPROFILE") or user_home

    candidates = []
    if user_profile:
        for name in _DEFAULT_USER_DIRS:
            candidates.append(os.path.join(user_profile, name))

        onedrive = os.getenv("OneDrive")
        if not onedrive and user_profile:
            onedrive = os.path.join(user_profile, "OneDrive")
        if onedrive:
            candidates.append(onedrive)
            for name in _DEFAULT_USER_DIRS:
                candidates.append(os.path.join(onedrive, name))

    roots = [p for p in candidates if os.path.isdir(p)]
    if roots:
        return roots

    if user_home and os.path.isdir(user_home):
        return [user_home]

    return None

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
    name = (dirname or "").lower()
    if not name:
        return False
    if name.startswith("."):
        return True
    return name in IGNORE_DIRS

def _scan_directory(folder):
    """Scan a single folder recursively using os.scandir. Yields (path, mtime)."""
    try:
        with os.scandir(folder) as it:
            for entry in it:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if not is_ignored(entry.name) and not _is_hidden_or_system_entry(entry):
                        yield from _scan_directory(entry.path)
                elif entry.is_file():
                    if _is_supported_file(entry.name):
                        try:
                            # entry.stat() is fast on Windows os.scandir
                            st = entry.stat()
                            if _has_system_attrs(st):
                                continue
                            if _is_valid_size(entry.name, st.st_size):
                                yield (entry.path, int(st.st_mtime), int(st.st_ctime))
                        except OSError:
                            pass
    except PermissionError:
        pass
    except FileNotFoundError:
        pass
    except OSError:
        pass

def fast_scan_device(max_workers=8, roots=None):
    """
    Scans default roots (user folders) or all drives if configured.
    Yields (filepath, mtime) tuples.
    """
    resolved_roots = _normalize_roots(roots)
    if roots is None:
        resolved_roots = get_default_index_roots()

    if resolved_roots is None:
        drives = get_logical_drives()
        top_level_dirs = []

        # Get top-level directories of all drives to distribute work uniformly across threads
        for drive in drives:
            try:
                with os.scandir(drive) as it:
                    for entry in it:
                        if entry.is_dir() and not is_ignored(entry.name) and not entry.is_symlink():
                            if not _is_hidden_or_system_entry(entry):
                                top_level_dirs.append(entry.path)
                        elif entry.is_file() and _is_supported_file(entry.name):
                            try:
                                st = entry.stat()
                                if _has_system_attrs(st):
                                    continue
                                if _is_valid_size(entry.name, st.st_size):
                                    yield (entry.path, int(st.st_mtime), int(st.st_ctime))
                            except OSError:
                                pass
            except OSError:
                pass
    else:
        top_level_dirs = []
        for root in resolved_roots:
            if not root:
                continue
            base = os.path.basename(os.path.normpath(root))
            if base and is_ignored(base):
                continue
            if os.path.isfile(root):
                if _is_supported_file(root):
                    try:
                        st = os.stat(root)
                        if _has_system_attrs(st):
                            continue
                        if _is_valid_size(root, st.st_size):
                            yield (root, int(st.st_mtime), int(st.st_ctime))
                    except OSError:
                        pass
                continue
            if os.path.isdir(root):
                top_level_dirs.append(root)

    if not top_level_dirs:
        return

    worker_count = min(max_workers, max(1, len(top_level_dirs)))
    # Process all top-level directories in a ThreadPool
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
        # Submit all top-level directories to the executor
        future_to_dir = {executor.submit(lambda d=d: list(_scan_directory(d))): d for d in top_level_dirs}
        for future in concurrent.futures.as_completed(future_to_dir):
            try:
                results = future.result()
                for res in results:
                    yield res
            except Exception:
                pass
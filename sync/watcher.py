# sync/watcher.py

import os
import time
import threading
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

try:
    from sync.vector_clock import load_clock, save_clock, DEVICE_ID
    from sync.merkle import build_merkle_tree, save_merkle_cache, load_merkle_cache
    from sync.checksum import file_checksum
except ModuleNotFoundError:
    from vector_clock import load_clock, save_clock, DEVICE_ID
    from merkle import build_merkle_tree, save_merkle_cache, load_merkle_cache
    from checksum import file_checksum

DB_PATH     = os.environ.get("INTELLIFIL_DB", "intellifil.db")
SYNC_FOLDER = os.environ.get("INTELLIFIL_SYNC", "./intellifil_files")

log = logging.getLogger("intellifil.watcher")

# Debounce window in seconds — events within this window are coalesced
DEBOUNCE_SECONDS = 0.5


class _DebouncedHandler(FileSystemEventHandler):
    """
    File system event handler with debouncing.

    Rapid successive events on the same file (e.g. editor save triggers
    multiple writes) are coalesced into a single callback after a quiet
    period of DEBOUNCE_SECONDS.
    """

    def __init__(self, on_change_callback):
        super().__init__()
        self._on_change = on_change_callback
        self._pending: dict[str, tuple[str, threading.Timer]] = {}
        self._lock = threading.Lock()

    def on_modified(self, event):
        if event.is_directory:
            return
        self._schedule(event.src_path, "modified")

    def on_created(self, event):
        if event.is_directory:
            return
        self._schedule(event.src_path, "added")

    def on_deleted(self, event):
        if event.is_directory:
            return
        self._schedule(event.src_path, "deleted")

    def _schedule(self, abs_path: str, event_type: str):
        rel_path = os.path.relpath(abs_path, SYNC_FOLDER).replace("\\", "/")

        # Ignore hidden/temp files
        basename = os.path.basename(abs_path)
        if basename.startswith(".") or basename.endswith(".tmp"):
            return

        with self._lock:
            # Cancel any pending timer for this file
            if rel_path in self._pending:
                _, old_timer = self._pending[rel_path]
                old_timer.cancel()

            # Schedule a new timer
            timer = threading.Timer(
                DEBOUNCE_SECONDS,
                self._fire,
                args=(rel_path, event_type),
            )
            timer.daemon = True
            timer.start()
            self._pending[rel_path] = (event_type, timer)

    def _fire(self, rel_path: str, event_type: str):
        """Called after the debounce window expires."""
        with self._lock:
            self._pending.pop(rel_path, None)

        try:
            cached_tree = load_merkle_cache(DB_PATH)
            if event_type != "deleted":
                abs_path = os.path.join(SYNC_FOLDER, rel_path)
                if not os.path.exists(abs_path):
                    return
                new_cs = file_checksum(abs_path)
                if cached_tree.get(rel_path) == new_cs:
                    return # Already handled by incoming sync or no content change

                cached_tree[rel_path] = new_cs
                save_merkle_cache(DB_PATH, cached_tree)

                # Tick vector clock for this file
                vc = load_clock(DB_PATH, rel_path)
                vc.tick()
                save_clock(DB_PATH, rel_path, vc)
            else:
                if rel_path not in cached_tree:
                    return # Already deleted or never existed
                
                del cached_tree[rel_path]
                save_merkle_cache(DB_PATH, cached_tree)

                vc = load_clock(DB_PATH, rel_path)
                vc.tick()
                save_clock(DB_PATH, rel_path, vc)

            # Notify server to push delta to connected clients
            self._on_change(rel_path, event_type)
            log.info("File %s: %s", event_type, rel_path)
        except Exception as exc:
            log.error("Error handling %s for %s: %s", event_type, rel_path, exc)


def start_watcher(on_change_callback) -> Observer:
    """
    Start watching the sync folder for changes.

    Args:
        on_change_callback: Called with (filepath, event_type) when a file
            changes. This callback may be invoked from a background thread.

    Returns:
        The Observer instance (call .stop() to shut down).
    """
    os.makedirs(SYNC_FOLDER, exist_ok=True)
    handler  = _DebouncedHandler(on_change_callback)
    observer = Observer()
    observer.schedule(handler, path=SYNC_FOLDER, recursive=True)
    observer.start()
    log.info("Watching %s", os.path.abspath(SYNC_FOLDER))
    return observer
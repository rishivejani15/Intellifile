# sync/watcher.py

import os
import time
import threading
import logging

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

try:
    from sync.vector_clock import load_clock, save_clock
    from sync.merkle import save_merkle_cache, load_merkle_cache
    from sync.checksum import file_checksum
except ModuleNotFoundError:
    from vector_clock import load_clock, save_clock
    from merkle import save_merkle_cache, load_merkle_cache
    from checksum import file_checksum

log = logging.getLogger("intellifil.watcher")

# Debounce window in seconds — rapid successive events on the same file are
# coalesced into a single callback after this quiet period.
DEBOUNCE_SECONDS = 0.5


class _DebouncedHandler(FileSystemEventHandler):
    """
    File-system event handler with per-file debouncing.

    Rapid events (editor save touching multiple writes) are coalesced into
    a single callback call after DEBOUNCE_SECONDS of silence for that path.
    """

    def __init__(self, on_change_callback, db_path: str, sync_folder: str):
        super().__init__()
        self._on_change   = on_change_callback
        self._db_path     = db_path
        self._sync_folder = sync_folder
        self._pending: dict[str, tuple[str, threading.Timer]] = {}
        self._lock = threading.Lock()

    def on_modified(self, event):
        if not event.is_directory:
            self._schedule(event.src_path, "modified")

    def on_created(self, event):
        if not event.is_directory:
            self._schedule(event.src_path, "added")

    def on_deleted(self, event):
        if not event.is_directory:
            self._schedule(event.src_path, "deleted")

    def _schedule(self, abs_path: str, event_type: str):
        try:
            rel_path = os.path.relpath(abs_path, self._sync_folder).replace("\\", "/")
        except ValueError:
            # Can happen on Windows when drive letters differ
            return

        # Ignore hidden/temp files
        basename = os.path.basename(abs_path)
        if basename.startswith(".") or basename.endswith(".tmp"):
            return

        with self._lock:
            # Cancel any pending timer for this file
            if rel_path in self._pending:
                _, old_timer = self._pending[rel_path]
                old_timer.cancel()

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
            cached_tree = load_merkle_cache(self._db_path)

            if event_type != "deleted":
                abs_path = os.path.join(self._sync_folder, rel_path)
                if not os.path.exists(abs_path):
                    return  # File disappeared before we could process it

                new_cs = file_checksum(abs_path)
                if cached_tree.get(rel_path) == new_cs:
                    # Content hasn't changed (e.g. touch or duplicate event)
                    return

                cached_tree[rel_path] = new_cs
                save_merkle_cache(self._db_path, cached_tree)

                # Tick vector clock so remote knows this side modified the file
                vc = load_clock(self._db_path, rel_path)
                vc.tick()
                save_clock(self._db_path, rel_path, vc)

            else:
                if rel_path not in cached_tree:
                    return  # Already deleted or never tracked

                del cached_tree[rel_path]
                save_merkle_cache(self._db_path, cached_tree)

                vc = load_clock(self._db_path, rel_path)
                vc.tick()
                save_clock(self._db_path, rel_path, vc)

            self._on_change(rel_path, event_type)
            log.info("File %s: %s", event_type, rel_path)

        except Exception as exc:
            log.error("Error handling %s for %s: %s", event_type, rel_path, exc, exc_info=True)


def start_watcher(on_change_callback, db_path: str, sync_folder: str) -> Observer:
    """
    Start watching *sync_folder* for changes.

    Args:
        on_change_callback: Called with (filepath, event_type) when a file
            changes.  This may be invoked from a background thread.
        db_path: Path to the SQLite database (for vector clock & Merkle cache).
        sync_folder: Absolute path to the folder being watched.

    Returns:
        The Observer instance (call .stop() then .join() to shut down).
    """
    os.makedirs(sync_folder, exist_ok=True)
    handler  = _DebouncedHandler(on_change_callback, db_path, sync_folder)
    observer = Observer()
    observer.schedule(handler, path=sync_folder, recursive=True)
    observer.start()
    log.info("Watching %s", os.path.abspath(sync_folder))
    return observer
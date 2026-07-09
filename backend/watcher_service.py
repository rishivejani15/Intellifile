import asyncio
import os
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from core import scanner
from core.db import get_setting_json, get_setting_bool


def _resolve_watched_folder(folder):
    if not folder:
        return None
    folder_text = str(folder).strip()
    if not folder_text:
        return None

    if folder_text.lower() in {"downloads", "desktop", "documents", "pictures", "music", "videos"}:
        candidate = Path.home() / folder_text
    else:
        candidate = Path(folder_text).expanduser()
    try:
        candidate = candidate.resolve()
    except Exception:
        candidate = candidate.absolute()
    return str(candidate)


def _path_has_ignored_component(file_path):
    try:
        parts = Path(file_path).parts
        return any(scanner.is_ignored(part) for part in parts)
    except Exception:
        return False


class _CreatedHandler(FileSystemEventHandler):
    def __init__(self, service):
        super().__init__()
        self.service = service

    def on_created(self, event):
        if event.is_directory:
            return
        self.service.defer_enqueue(event.src_path)

    def on_moved(self, event):
        if event.is_directory:
            return
        self.service.cancel_pending(event.src_path)
        self.service.enqueue(event.dest_path)


class WatcherService:
    _CREATED_GRACE_SECONDS = 4.0

    def __init__(self, loop=None):
        self.loop = loop or asyncio.get_event_loop()
        self.queue = asyncio.Queue()
        self.observer = None
        self._handler = _CreatedHandler(self)
        self._roots = set()
        self._running = False
        self._lock = threading.Lock()
        self._pending = {}

    def _clear_pending(self, path):
        entry = self._pending.pop(path, None)
        if not entry:
            return
        timer = entry.get("timer")
        if timer is not None:
            try:
                timer.cancel()
            except Exception:
                pass

    def cancel_pending(self, path):
        if not path:
            return
        with self._lock:
            self._clear_pending(os.path.abspath(path))

    def defer_enqueue(self, path):
        if not path or _path_has_ignored_component(path):
            return

        abs_path = os.path.abspath(path)

        def _fire():
            with self._lock:
                self._pending.pop(abs_path, None)
            self.enqueue(abs_path)

        with self._lock:
            self._clear_pending(abs_path)
            timer = threading.Timer(self._CREATED_GRACE_SECONDS, _fire)
            timer.daemon = True
            self._pending[abs_path] = {"created_at": time.time(), "timer": timer}
            timer.start()

    def _load_roots(self):
        folders = get_setting_json("watched_folders", []) or []
        roots = []
        for folder in folders:
            resolved = _resolve_watched_folder(folder)
            if not resolved:
                continue
            if _path_has_ignored_component(resolved):
                continue
            if os.path.isdir(resolved):
                roots.append(resolved)
        return sorted(set(roots))

    def enqueue(self, path):
        if not path or _path_has_ignored_component(path):
            return
        if not self.loop or self.loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self.queue.put(path), self.loop)

    def start(self):
        with self._lock:
            if self._running:
                return {"started": True, "watching": sorted(self._roots)}
            if not get_setting_bool("auto_sort_enabled", False):
                return {"started": False, "reason": "disabled"}

            roots = self._load_roots()
            self.observer = Observer()
            for root in roots:
                self.observer.schedule(self._handler, root, recursive=False)
            self.observer.start()
            self._roots = set(roots)
            self._running = True
            return {"started": True, "watching": roots}

    def stop(self):
        with self._lock:
            for path in list(self._pending.keys()):
                self._clear_pending(path)
            if self.observer is not None:
                try:
                    self.observer.stop()
                    self.observer.join(timeout=5)
                except Exception:
                    pass
                self.observer = None
            self._running = False
            self._roots = set()
            if self.loop and not self.loop.is_closed():
                asyncio.run_coroutine_threadsafe(self.queue.put(None), self.loop)
            return {"stopped": True}

    @property
    def running(self):
        return self._running
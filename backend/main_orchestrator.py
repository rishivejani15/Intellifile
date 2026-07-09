import asyncio
import os
import threading
import time
from pathlib import Path

from core.db import (
    get_connection,
    get_setting,
    get_setting_bool,
    get_setting_json,
    init_db,
    set_setting,
)
from core.faiss_manager import invalidate_cache
from core.extractor import extract_text_with_status
from core.model import MODEL
from indexing.single_file_ingest import ingest_single_file
from indexing.update_faiss import update_faiss

from classifier import classify_file
from sort_engine import move_and_log, undo_sort
from stability_check import is_temp_file, wait_until_stable
from tagger import generate_tags
from watcher_service import WatcherService


_controller = None
_controller_lock = threading.Lock()
_emit_json = None


def set_emitter(callback):
    global _emit_json
    _emit_json = callback


def _emit(payload):
    if callable(_emit_json):
        _emit_json(payload)


def _resolve_setting_path(value):
    return value


def _current_timestamp():
    return time.time()


def _resolve_sort_root(sort_root):
    if not sort_root:
        sort_root = "Sorted"
    root = Path(str(sort_root)).expanduser()
    if not root.is_absolute():
        root = Path.home() / root
    return str(root)


def _get_llm_backend():
    try:
        from chat.backend import llm as chat_llm

        if getattr(chat_llm, "chat_model", None) is not None:
            return chat_llm
    except Exception:
        return None
    return None


def _update_sorted_index(original_path, new_path):
    init_db()
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM files WHERE path = ?", (os.path.abspath(original_path),))
        row = cur.fetchone()
        if row:
            file_id = int(row[0])
            new_abs = os.path.abspath(new_path)
            filename = os.path.basename(new_abs)
            created_time = int(os.stat(new_abs).st_ctime) if os.path.exists(new_abs) else int(time.time())
            cur.execute(
                "UPDATE files SET path = ?, filename = ?, modified_time = ?, created_time = COALESCE(created_time, ?) WHERE id = ?",
                (new_abs, filename, int(os.path.getmtime(new_abs)) if os.path.exists(new_abs) else int(time.time()), created_time, file_id),
            )
            cur.execute(
                "SELECT id FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC LIMIT 1",
                (file_id,),
            )
            chunk_row = cur.fetchone()
            affected_ids = []
            if chunk_row and os.path.exists(new_abs):
                chunk_id = int(chunk_row[0])
                meta_chunk = f"{Path(filename).stem.replace('_', ' ').replace('-', ' ')} {filename} {new_abs}"
                cur.execute("UPDATE chunks SET text = ? WHERE id = ?", (meta_chunk, chunk_id))
                affected_ids.append(chunk_id)
            conn.commit()
        else:
            affected_ids = []
    finally:
        conn.close()

    if row:
        if affected_ids:
            update_faiss(affected_ids)
        invalidate_cache()
        return {"status": "updated", "path": os.path.abspath(new_path)}

    if os.path.exists(new_path):
        return ingest_single_file(new_path)
    return {"status": "skipped", "reason": "file_missing"}


def settings_get(key):
    init_db()
    value = get_setting(key)
    if value is None:
        return {"key": key, "value": None}
    if key == "auto_sort_enabled":
        return {"key": key, "value": get_setting_bool(key, False)}
    if key in {"watched_folders"}:
        return {"key": key, "value": get_setting_json(key, [])}
    return {"key": key, "value": value}


def settings_update(key, value):
    init_db()
    set_setting(key, value)
    if key == "auto_sort_enabled":
        if str(value).lower() in {"true", "1", "yes", "on"}:
            start_autosort()
        else:
            stop_autosort()
    return {"success": True, "key": key, "value": value}


def _autosort_controller():
    global _controller
    with _controller_lock:
        if _controller is None:
            _controller = _AutoSortController()
        return _controller


def start_autosort():
    return _autosort_controller().start()


def stop_autosort():
    return _autosort_controller().stop()


def autosort_recent(limit=20):
    init_db()
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, original_path, new_path, category, tags, timestamp, undone FROM sort_log ORDER BY timestamp DESC LIMIT ?",
            (int(limit),),
        )
        rows = []
        for row in cur.fetchall():
            log_id, original_path, new_path, category, tags, timestamp, undone = row
            rows.append(
                {
                    "id": log_id,
                    "original_path": original_path,
                    "new_path": new_path,
                    "filename": os.path.basename(new_path),
                    "category": category,
                    "tags": [tag.strip() for tag in (tags or "").split(",") if tag.strip()],
                    "timestamp": timestamp,
                    "undone": int(undone or 0),
                    "exists": os.path.exists(new_path),
                    "undoable": int(undone or 0) == 0 and os.path.exists(new_path),
                }
            )
        return {"success": True, "items": rows}
    finally:
        conn.close()


def autosort_undo(log_id):
    init_db()
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT original_path, new_path FROM sort_log WHERE id = ?",
            (int(log_id),),
        )
        row = cur.fetchone()
        if not row:
            return {"success": False}
        original_path, new_path = row
    finally:
        conn.close()

    result = asyncio.run(undo_sort(None, log_id))
    if not result:
        return {"success": False}

    _update_sorted_index(new_path, original_path)
    return {"success": True}


def _get_sort_log_id(original_path, new_path):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM sort_log WHERE original_path = ? AND new_path = ? ORDER BY timestamp DESC LIMIT 1",
            (os.path.abspath(original_path), os.path.abspath(new_path)),
        )
        row = cur.fetchone()
        return int(row[0]) if row else None
    finally:
        conn.close()


async def _handle_file(path):
    if not path or is_temp_file(path):
        return
    if not get_setting_bool("auto_sort_enabled", False):
        return
    if not os.path.exists(path):
        return

    if not await wait_until_stable(path):
        return
    if not get_setting_bool("auto_sort_enabled", False):
        return

    try:
        llm = _get_llm_backend()
        category = await classify_file(path, extract_text_with_status, llm)
        if not get_setting_bool("auto_sort_enabled", False):
            return
        tags = await generate_tags(path, category, extract_text_with_status, MODEL, llm)
        if not get_setting_bool("auto_sort_enabled", False):
            return

        sort_root = get_setting("sort_root", "Sorted")
        moved_path = await move_and_log(None, path, category, tags, sort_root)
        if not moved_path:
            return

        sync_result = _update_sorted_index(path, moved_path)
        log_id = _get_sort_log_id(path, moved_path)
        _emit(
            {
                "event": "autosort:notification",
                "payload": {
                    "logId": log_id,
                    "originalPath": os.path.abspath(path),
                    "newPath": moved_path,
                    "filename": os.path.basename(path),
                    "category": category,
                    "tags": tags,
                    "timestamp": _current_timestamp(),
                },
            }
        )
        set_setting("autosort_last_processed_ts", str(_current_timestamp()))
    except Exception as exc:
        print(f"[autosort] Failed to process {path}: {exc}")


class _AutoSortController:
    def __init__(self):
        self.thread = None
        self.loop = None
        self.service = None
        self.running = False
        self.lock = threading.Lock()

    def _bootstrap(self):
        asyncio.set_event_loop(self.loop)
        self.service = WatcherService(loop=self.loop)
        start_result = self.service.start()
        self.running = bool(start_result.get("started"))
        if self.running:
            self.loop.create_task(self._consume_queue())
            self.loop.create_task(self._catch_up())
            self.loop.run_forever()

    async def _catch_up(self):
        if not self.running or not get_setting_bool("auto_sort_enabled", False):
            return
        last_processed = float(get_setting("autosort_last_processed_ts", "0") or 0)
        folders = get_setting_json("watched_folders", []) or []
        for folder in folders:
            if not get_setting_bool("auto_sort_enabled", False):
                return
            candidate = Path(str(folder)).expanduser()
            if not candidate.is_absolute():
                candidate = Path.home() / candidate
            if not candidate.exists() or not candidate.is_dir():
                continue
            try:
                for entry in candidate.iterdir():
                    if not entry.is_file():
                        continue
                    if entry.stat().st_mtime <= last_processed:
                        continue
                    self.service.enqueue(str(entry))
            except Exception:
                continue

    async def _consume_queue(self):
        while True:
            path = await self.service.queue.get()
            if path is None:
                break
            if not self.running or not get_setting_bool("auto_sort_enabled", False):
                continue
            await _handle_file(path)

    def start(self):
        with self.lock:
            init_db()
            if self.running:
                return {"started": True, "watching": sorted(self.service._roots) if self.service else []}
            if not get_setting_bool("auto_sort_enabled", False):
                return {"started": False, "reason": "disabled"}

            self.loop = asyncio.new_event_loop()
            self.thread = threading.Thread(target=self._bootstrap, daemon=True)
            self.thread.start()
            return {"started": True}

    def stop(self):
        with self.lock:
            if not self.loop:
                self.running = False
                return {"stopped": True}
            self.running = False
            try:
                if self.service:
                    self.service.stop()
            except Exception:
                pass
            try:
                self.loop.call_soon_threadsafe(self.loop.stop)
            except Exception:
                pass
            self.loop = None
            self.service = None
            return {"stopped": True}

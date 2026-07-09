import asyncio
import os
import shutil
import time
from pathlib import Path

from core.db import get_connection, init_db


def _resolve_sort_root(sort_root):
    if not sort_root:
        sort_root = "Sorted"
    root = Path(str(sort_root)).expanduser()
    if not root.is_absolute():
        root = Path.home() / root
    return root


def _unique_destination(destination):
    destination = Path(destination)
    if not destination.exists():
        return destination

    stem = destination.stem
    suffix = destination.suffix
    parent = destination.parent
    index = 1
    while True:
        candidate = parent / f"{stem} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


async def resolve_target_path(original_path, category, sort_root) -> str:
    source = Path(original_path)
    destination_dir = _resolve_sort_root(sort_root) / str(category or "Other")
    destination_dir.mkdir(parents=True, exist_ok=True)
    return str(_unique_destination(destination_dir / source.name))


def _move_with_retry(source_path, destination_path, retries=3, backoff=0.25):
    last_error = None
    for attempt in range(max(1, retries)):
        try:
            os.rename(source_path, destination_path)
            return True
        except PermissionError as exc:
            last_error = exc
        except OSError as exc:
            last_error = exc
            try:
                shutil.copy2(source_path, destination_path)
                os.remove(source_path)
                return True
            except PermissionError as copy_error:
                last_error = copy_error
            except OSError as copy_error:
                last_error = copy_error

        if attempt < retries - 1:
            time.sleep(backoff * (attempt + 1))

    if last_error:
        raise last_error
    return False


async def move_and_log(db, original_path, category, tags, sort_root) -> str:
    init_db()
    source_path = os.path.abspath(original_path)
    if not os.path.exists(source_path):
        return ""

    target_path = await resolve_target_path(source_path, category, sort_root)

    try:
        await asyncio.to_thread(_move_with_retry, source_path, target_path)
    except Exception as exc:
        print(f"[autosort] Move failed for {source_path}: {exc}")
        return ""

    conn = db or get_connection()
    should_close = db is None
    try:
        conn.execute(
            """
            INSERT INTO sort_log (original_path, new_path, category, tags, timestamp, undone)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (source_path, target_path, category, ",".join(tags or []), time.time()),
        )
        conn.commit()
    finally:
        if should_close:
            conn.close()

    return target_path


async def undo_sort(db, log_id) -> bool:
    init_db()
    conn = db or get_connection()
    should_close = db is None
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT original_path, new_path, undone FROM sort_log WHERE id = ?",
            (int(log_id),),
        )
        row = cur.fetchone()
        if not row:
            return False

        original_path, new_path, undone = row
        if int(undone or 0) == 1:
            return False
        if not os.path.exists(new_path):
            return False
        if os.path.exists(original_path):
            return False

        try:
            await asyncio.to_thread(_move_with_retry, new_path, original_path)
        except Exception as exc:
            print(f"[autosort] Undo failed for {new_path}: {exc}")
            return False

        cur.execute("UPDATE sort_log SET undone = 1 WHERE id = ?", (int(log_id),))
        conn.commit()
        return True
    finally:
        if should_close:
            conn.close()
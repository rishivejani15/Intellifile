import asyncio
import os
import time


_TEMP_SUFFIXES = (".crdownload", ".part", ".tmp", ".download")


def is_temp_file(path):
    if not path:
        return False
    lower = str(path).lower()
    return lower.endswith(_TEMP_SUFFIXES)


async def wait_until_stable(path, checks=3, interval=1.0, timeout=30):
    if not path:
        return False

    deadline = time.monotonic() + timeout
    stable_count = 0
    last_size = None

    while time.monotonic() < deadline:
        if not os.path.exists(path):
            return False

        try:
            current_size = os.path.getsize(path)
        except FileNotFoundError:
            return False

        if last_size is not None and current_size == last_size:
            stable_count += 1
        else:
            stable_count = 1
            last_size = current_size

        if stable_count >= max(1, int(checks)):
            try:
                with open(path, "rb"):
                    return True
            except PermissionError:
                return False
            except FileNotFoundError:
                return False

        await asyncio.sleep(interval)

    return False
# sync/checksum.py

import hashlib
import logging
import os

BLOCK_SIZE = 128 * 1024  # 128 KB — must match mobile and JS client

log = logging.getLogger("intellifil.checksum")


def get_block_checksums(filepath: str) -> dict:
    """
    Split file into 128 KB blocks and return MD5 checksum per block.
    Returns {block_index: checksum_hex}
    """
    checksums = {}
    if not os.path.exists(filepath):
        return checksums

    with open(filepath, 'rb') as f:
        i = 0
        while chunk := f.read(BLOCK_SIZE):
            checksums[i] = hashlib.md5(chunk).hexdigest()
            i += 1
    return checksums


def compute_delta(filepath: str, remote_checksums: dict) -> list:
    """
    Compare local file blocks against remote checksums.
    Returns only the changed blocks as a list of dicts:
      [{ 'block': int, 'checksum': str, 'data': hex_str }, ...]
    """
    deltas = []
    with open(filepath, 'rb') as f:
        i = 0
        while chunk := f.read(BLOCK_SIZE):
            local_checksum = hashlib.md5(chunk).hexdigest()
            remote_key = remote_checksums.get(i) or remote_checksums.get(str(i))
            if remote_key != local_checksum:
                deltas.append({
                    "block":    i,
                    "checksum": local_checksum,
                    "data":     chunk.hex(),
                })
            i += 1
    return deltas


def apply_delta(filepath: str, deltas: list, expected_size: int | None = None):
    """
    Apply received block deltas to a local file in-place.

    Uses seek/write to overwrite only the changed 128 KB blocks — no full
    file read into RAM, so this is safe for arbitrarily large files.

    If expected_size is provided the file is truncated to that length after
    all blocks are written (handles the case where mobile sent a shorter
    version of the file).
    """
    try:
        if not deltas:
            return

        dir_path = os.path.dirname(filepath)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)

        # Create the file if it doesn't exist yet (non-destructive)
        open(filepath, 'ab').close()

        with open(filepath, 'r+b') as f:
            for delta in deltas:
                position = int(delta["block"]) * BLOCK_SIZE
                data = bytes.fromhex(delta["data"])
                f.seek(position)
                f.write(data)

            # Truncate to the correct final size so stale tail bytes are removed
            if expected_size is not None:
                f.truncate(expected_size)
    except Exception as exc:
        log.error("apply_delta failed for %s: %s", filepath, exc, exc_info=True)
        raise


def file_checksum(filepath: str) -> str:
    """Single MD5 of entire file — used by Merkle tree."""
    h = hashlib.md5()
    with open(filepath, 'rb') as f:
        while chunk := f.read(BLOCK_SIZE):
            h.update(chunk)
    return h.hexdigest()
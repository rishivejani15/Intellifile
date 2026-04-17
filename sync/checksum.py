# pc/sync/checksum.py

import hashlib
import os

BLOCK_SIZE = 128 * 1024  # 128KB


def get_block_checksums(filepath: str) -> dict:
    """
    Split file into 128KB blocks and return MD5 checksum per block.
    {block_index: checksum_hex}
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
    Returns only the blocks that differ — the delta.
    """
    deltas = []
    with open(filepath, 'rb') as f:
        i = 0
        while chunk := f.read(BLOCK_SIZE):
            local_checksum = hashlib.md5(chunk).hexdigest()
            if remote_checksums.get(i) != local_checksum:
                deltas.append({
                    "block":    i,
                    "checksum": local_checksum,
                    "data":     chunk.hex()   # hex so it's JSON serializable
                })
            i += 1

    # handle case where local file has fewer blocks than remote
    # (file was truncated) — remote will detect missing blocks
    return deltas


def apply_delta(filepath: str, deltas: list):
    """
    Apply received block deltas to a local file.
    Only the changed blocks are overwritten.
    """
    # read existing blocks into memory
    blocks = {}
    if os.path.exists(filepath):
        with open(filepath, 'rb') as f:
            i = 0
            while chunk := f.read(BLOCK_SIZE):
                blocks[i] = chunk
                i += 1

    # apply changed blocks
    for delta in deltas:
        blocks[delta["block"]] = bytes.fromhex(delta["data"])

    # write all blocks back in order
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'wb') as f:
        for i in sorted(blocks.keys()):
            f.write(blocks[i])


def file_checksum(filepath: str) -> str:
    """Single MD5 of entire file — used by Merkle tree."""
    h = hashlib.md5()
    with open(filepath, 'rb') as f:
        while chunk := f.read(BLOCK_SIZE):
            h.update(chunk)
    return h.hexdigest()
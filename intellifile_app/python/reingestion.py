# python/reingestion.py

import os

def reingest_file(filepath: str):
    """
    Called after a file is synced from PC.
    Re-chunks, re-embeds, updates SQLite + HNSW index.
    Plug in your existing ingestion pipeline here.
    """
    if not os.path.exists(filepath):
        print(f'[reingest] file not found: {filepath}')
        return

    print(f'[reingest] processing {filepath}')

    # ── plug your existing pipeline here ──────────────────
    # from ingestion import ingest_file
    # ingest_file(filepath)
    # ──────────────────────────────────────────────────────

    print(f'[reingest] done: {filepath}')
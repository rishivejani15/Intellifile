import time
import faiss
import numpy as np
from core.model import MODEL
from core.db import get_connection
from core.faiss_manager import load_index, save_index

_ENCODE_BATCH = 128       # chunks per outer loop iteration
_ENCODE_MINI  = 16        # internal batch_size for MODEL.encode() — small = better CPU cache
_SQL_BATCH    = 5000       # rows per SQL IN (…) query


def update_faiss(chunk_ids, progress_cb=None):
    if chunk_ids is None:
        chunk_ids = []

    t0 = time.perf_counter()

    def _progress(phase, detail="", pct=None):
        if progress_cb:
            progress_cb(phase, detail, pct)

    if not chunk_ids:
        print("No FAISS update needed.")
        return
    
    chunk_ids = list(set(chunk_ids))
    ids_np = np.array(chunk_ids, dtype="int64")

    # ── Fetch chunk texts in batches to avoid SQL variable limits ──
    # ── Load / create FAISS index ─────────────────────────
    index = load_index(force_reload=True)
    if index is None:
        dim = MODEL.get_embedding_dimension()
        base = faiss.IndexFlatIP(dim)
        index = faiss.IndexIDMap(base)
    else:
        index.remove_ids(ids_np)
    conn = get_connection()
    cur = conn.cursor()
     # ── Fetch chunk texts in batches to avoid SQL variable limits ──
    rows = []
    for i in range(0, len(chunk_ids), _SQL_BATCH):
        batch = chunk_ids[i:i + _SQL_BATCH]
        placeholders = ",".join("?" * len(batch))
        cur.execute(
            f"SELECT id, text FROM chunks WHERE id IN ({placeholders})",
            batch,
        )
        rows.extend(cur.fetchall())
    

    if not rows:
        save_index(index)
        conn.close()
        print(f"FAISS removed {len(ids_np)} deleted chunks.")
        return

    # ── Encode & add in batches to cap peak memory ────────
    texts = [t for _, t in rows]
    ids_exist = np.array([cid for cid, _ in rows], dtype="int64")
    total = len(texts)

    _progress("embed", f"Embedding {total} chunks…", pct=0)
    batch_t0 = time.perf_counter()

    for i in range(0, total, _ENCODE_BATCH):
        batch_texts = texts[i:i + _ENCODE_BATCH]
        batch_ids   = ids_exist[i:i + _ENCODE_BATCH]

        start = i + 1
        end = min(i + _ENCODE_BATCH, total)
        print(f"  … encoding chunks {start}-{end}/{total}", flush=True)

        embs = MODEL.encode(
            batch_texts,
            normalize_embeddings=True,
            batch_size=_ENCODE_MINI,
            show_progress_bar=False,
        ).astype("float32")

        index.add_with_ids(embs, batch_ids)

        done = min(i + _ENCODE_BATCH, total)
        pct = int(done / total * 100)
        elapsed = time.perf_counter() - batch_t0
        speed = done / elapsed if elapsed > 0 else 0
        eta = int((total - done) / speed) if speed > 0 else 0
        eta_str = f"{eta // 60}m {eta % 60}s" if eta >= 60 else f"{eta}s"
        detail = f"Embedded {done}/{total} chunks ({speed:.0f}/sec, ETA {eta_str})"
        _progress("embed", detail, pct=pct)
        print(f"  … {detail}", flush=True)

    save_index(index)
    conn.close()
    embed_secs = time.perf_counter() - t0
    print(f"FAISS updated for {len(ids_exist)} chunks in {embed_secs:.1f}s.")

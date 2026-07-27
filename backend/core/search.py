import os
from collections import defaultdict
from core.model import encode_query
from core.faiss_manager import load_index
from core.db import get_connection

# Reciprocal Rank Fusion constant (higher = more uniform blending)
_RRF_K = 60


def _normalize_root(root_folder):
    if not root_folder:
        return None
    return os.path.normcase(os.path.abspath(root_folder)).rstrip("\\/")


def _path_in_root(file_path, root_folder):
    if not root_folder:
        return True
    try:
        normalized_path = os.path.normcase(os.path.abspath(file_path)).rstrip("\\/")
        normalized_root = _normalize_root(root_folder)
        return normalized_path == normalized_root or normalized_path.startswith(normalized_root + os.sep)
    except Exception:
        return False


def _faiss_search(query, top_k, min_sim=0.15, root_folder=None):
    """Semantic similarity search via FAISS."""
    if not query.strip():
        return []
    index = load_index()
    if index is None or index.ntotal == 0:
        return []

    q_emb = encode_query(query).reshape(1, -1)
    scores, ids = index.search(q_emb, top_k)

    hits = []
    root_folder = _normalize_root(root_folder)

    conn = get_connection()
    try:
        cur = conn.cursor()
        for cid, sim in zip(ids[0], scores[0]):
            if cid == -1 or sim < min_sim:
                continue
            cur.execute(
                """SELECT files.path
                   FROM chunks
                   JOIN files ON chunks.file_id = files.id
                   WHERE chunks.id = ?""",
                (int(cid),),
            )
            row = cur.fetchone()
            if not row or not _path_in_root(row[0], root_folder):
                continue
            hits.append((int(cid), float(sim)))
    finally:
        conn.close()

    return hits


def _fts5_search(query, top_k, root_folder=None):
    """Keyword search via SQLite FTS5 (BM25 ranking)."""
    words = query.strip().split()
    if not words:
        return []

    # Build an OR query so any matching word contributes
    fts_query = " OR ".join(f'"{w}"' for w in words)

    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        cur.execute(
            """SELECT chunks_fts.rowid, rank, files.path
               FROM chunks_fts
               JOIN chunks ON chunks_fts.rowid = chunks.id
               JOIN files ON chunks.file_id = files.id
               WHERE chunks_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (fts_query, top_k * 5),
        )
        # FTS5 rank is negative (lower = better), negate for positive score
        return [
            (row[0], -row[1])
            for row in cur.fetchall()
            if _path_in_root(row[2], root_folder)
        ][:top_k]
    except Exception:
        return []  # FTS5 table missing or query error
    finally:
        conn.close()


def _filename_search(query, top_k, root_folder=None):
    """Exact filename / path substring search via SQLite."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        root_clause = ""
        root_params = []
        if root_folder:
          root_clause = " AND path LIKE ?"
          root_params.append(f"{root_folder}%")
        if not query.strip():
            cur.execute(
                """SELECT id, path FROM files
                   WHERE 1=1
                   """ + root_clause + """
                   ORDER BY created_time DESC, modified_time DESC
                   LIMIT ?""",
                root_params + [top_k],
            )
            return cur.fetchall()

        pattern = f"%{query}%"
        cur.execute(
            """SELECT id, path FROM files
               WHERE (path LIKE ? OR filename LIKE ?)
               """ + root_clause + """
               ORDER BY created_time DESC, modified_time DESC
               LIMIT ?""",
            [pattern, pattern, *root_params, top_k * 5],
        )
        return cur.fetchall()[:top_k]
    except Exception:
        return []
    finally:
        conn.close()


def _date_range_search(top_k, date_from=None, date_to=None, root_folder=None):
    """Direct SQL query for files within a creation-date range.
    
    Used when the user issues a date-only query (e.g. 'files of august 2022')
    with no semantic keywords, so FAISS/FTS5 have nothing to match on.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        conditions = []
        params = []
        if date_from is not None:
            conditions.append("created_time >= ?")
            params.append(date_from)
        if date_to is not None:
            conditions.append("created_time <= ?")
            params.append(date_to)
        if root_folder:
            conditions.append("path LIKE ?")
            params.append(f"{root_folder}%")

        where = " AND ".join(conditions) if conditions else "1=1"
        root_folder = _normalize_root(root_folder)
        cur.execute(
            f"""SELECT path, created_time FROM files
                WHERE {where}
                ORDER BY created_time DESC
                LIMIT ?""",
            params + [top_k],
        )
        return [
            {"path": row[0], "score": 1.0, "created_time": row[1]}
            for row in cur.fetchall()
        ]
    except Exception:
        return []
    finally:
        conn.close()


def semantic_search(query, top_k=20, min_similarity=0.15, date_from=None, date_to=None, root_folder=None):
    """
    Hybrid search: FAISS semantic + FTS5 keyword + filename match,
    combined via Reciprocal Rank Fusion.

    Optional date_from/date_to (Unix timestamps) filter results by
    file creation date.

    Returns list of dicts: {path, score, created_time} sorted by relevance.
    """

    # ── Fast path: date-only query (no keywords to search) ──
    # When the user asks "files of august 2022" the NLP parser strips
    # everything, leaving an empty query string.  FAISS and FTS5 cannot
    # match on an empty string, so we fall through to a direct SQL
    # date-range lookup instead.
    if not query.strip() and (date_from is not None or date_to is not None):
        return _date_range_search(top_k, date_from=date_from, date_to=date_to, root_folder=root_folder)

    fetch_k = top_k * 5  # over-fetch for better fusion

    sem_hits = _faiss_search(query, fetch_k, min_sim=min_similarity, root_folder=root_folder)
    kw_hits = _fts5_search(query, fetch_k, root_folder=root_folder)
    fn_hits = _filename_search(query, fetch_k, root_folder=root_folder)

    # ── Build a map of actual cosine similarity per chunk (for display) ──
    chunk_cosine = {}
    for cid, sim in sem_hits:
        chunk_cosine[cid] = max(chunk_cosine.get(cid, 0), sim)

    # ── RRF at chunk level (for ranking) ─────────────────
    chunk_rrf = {}

    for rank, (cid, _score) in enumerate(sem_hits, 1):
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + 1.0 / (_RRF_K + rank)

    for rank, (cid, _score) in enumerate(kw_hits, 1):
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + 1.0 / (_RRF_K + rank)

    # ── Filename matches get injected directly as file-level hits ──
    filename_boost = {}
    for rank, (_fid, path) in enumerate(fn_hits, 1):
        filename_boost[path] = 1.0 / (_RRF_K + rank)

    if not chunk_rrf and not filename_boost:
        return []

    # ── Map chunk IDs → file paths + created_time ────────
    all_ids = list(chunk_rrf.keys())
    conn = get_connection()
    cur = conn.cursor()

    rows = []
    if all_ids:
        placeholders = ",".join("?" * len(all_ids))
        cur.execute(
            f"""SELECT chunks.id, files.path, files.created_time
                FROM chunks
                JOIN files ON chunks.file_id = files.id
                WHERE chunks.id IN ({placeholders})""",
            all_ids,
        )
        rows = cur.fetchall()

    # ── Also load created_time for filename-matched files ──
    file_created = {}
    if filename_boost:
        fn_paths = list(filename_boost.keys())
        fn_ph = ",".join("?" * len(fn_paths))
        cur.execute(
            f"SELECT path, created_time FROM files WHERE path IN ({fn_ph})",
            fn_paths,
        )
        for r in cur.fetchall():
            file_created[r[0]] = r[1]

    conn.close()

    # ── Aggregate per file ──────────────────────────────
    # Ranking: best single RRF score per file (no large-file bias)
    # Display: actual cosine similarity of best chunk (real accuracy %)
    file_best_rrf = {}
    file_best_cosine = {}
    for cid, path, ctime in rows:
        rrf = chunk_rrf.get(cid, 0)
        cos = chunk_cosine.get(cid, 0)
        
        # If FTS5 hit without semantic hit, cos is 0. Give it a baseline 50% score.
        if cos == 0:
            cos = 0.5
            
        if path not in file_best_rrf or rrf > file_best_rrf[path]:
            file_best_rrf[path] = rrf
        if path not in file_best_cosine or cos > file_best_cosine[path]:
            file_best_cosine[path] = cos
        if ctime is not None:
            file_created[path] = ctime

    # Add filename-match boost to RRF scores
    for path, boost in filename_boost.items():
        file_best_rrf[path] = file_best_rrf.get(path, 0) + boost
        # Filename matches without semantic hits get a baseline cosine
        if path not in file_best_cosine:
            file_best_cosine[path] = 0.5

    # Sort by RRF rank
    ranked = sorted(file_best_rrf.items(), key=lambda x: x[1], reverse=True)

    # ── Date filtering ──────────────────────────────────
    if date_from is not None or date_to is not None:
        filtered = []
        for path, rrf in ranked:
            ctime = file_created.get(path)
            if ctime is None:
                # Include files with unknown creation time (not yet re-indexed)
                filtered.append((path, rrf))
                continue
            if date_from is not None and ctime < date_from:
                continue
            if date_to is not None and ctime > date_to:
                continue
            filtered.append((path, rrf))
        ranked = filtered

    ranked = ranked[:top_k]

    return [
        {
            "path": path,
            "score": file_best_cosine.get(path, 0),
            "created_time": file_created.get(path),
        }
        for path, _rrf in ranked
    ]

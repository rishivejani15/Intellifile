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


import re
import faiss

# Common English stop words to exclude from keyword search term dominance
_STOP_WORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "as", "at", "be", "because", "been", "before", "being", "below",
    "between", "both", "but", "by", "could", "did", "do", "does", "doing", "down",
    "during", "each", "few", "for", "from", "further", "had", "has", "have",
    "having", "he", "her", "here", "hers", "herself", "him", "himself", "his",
    "how", "i", "if", "in", "into", "is", "it", "its", "itself", "me", "more",
    "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only",
    "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
    "same", "she", "should", "so", "some", "such", "than", "that", "the", "their",
    "theirs", "them", "themselves", "then", "there", "these", "they", "this",
    "those", "through", "to", "too", "under", "until", "up", "very", "was", "we",
    "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with",
    "would", "you", "your", "yours", "yourself", "yourselves"
}


def _classify_query_intent(query):
    """
    Classifies query intent and returns dynamic fusion weights (w_sem, w_kw, w_fn).
    - Filename / extension queries: prioritize filename & keyword
    - Short 1-2 word queries: prioritize keyword & filename
    - Long descriptive / conversational queries (>= 5 words): prioritize semantic vector search
    - Balanced queries (3-4 words): balanced weights
    """
    tokens = re.findall(r'[a-zA-Z0-9]+', query)
    content_tokens = [t for t in tokens if t.lower() not in _STOP_WORDS]
    n_content = len(content_tokens)
    n_total = len(tokens)

    has_extension = bool(re.search(r'\.(pdf|docx|xlsx|pptx|png|jpg|jpeg|txt|py|csv|json)\b', query, re.I))

    if has_extension:
        return 0.6, 1.2, 1.6

    if n_content <= 1:
        return 0.7, 1.4, 1.5
    elif n_content == 2:
        return 0.9, 1.3, 1.2
    elif n_content >= 5 or n_total >= 6:
        return 1.4, 0.8, 0.8
    else:
        return 1.0, 1.1, 1.0


def _build_fts5_queries(query):
    """
    Build tiered FTS5 queries:
    1. Primary (high precision): exact phrase, compound words, and AND conjunction of content words.
    2. Fallback (high recall): OR disjunction across content words (only used if primary needs more candidates).
    """
    tokens = re.findall(r'[a-zA-Z0-9]+', query)
    if not tokens:
        return "", ""

    clean_phrase = " ".join(tokens)
    content_tokens = [t for t in tokens if t.lower() not in _STOP_WORDS]
    if not content_tokens:
        content_tokens = tokens  # fallback if query consists solely of stopwords

    primary_clauses = []
    # 1. Exact phrase match & compound merged words (e.g. "drive safe" -> "drivesafe", "bio data" -> "biodata")
    if len(tokens) > 1:
        primary_clauses.append(f'"{clean_phrase}"')
        compound = "".join(tokens)
        if len(compound) > len(tokens[0]):
            primary_clauses.append(f'"{compound}"')

        # Adjacent non-stopword pairs (e.g. "bio data of a girl" -> "biodata")
        for i in range(len(tokens) - 1):
            t1, t2 = tokens[i].lower(), tokens[i+1].lower()
            if t1 not in _STOP_WORDS and t2 not in _STOP_WORDS:
                pair = t1 + t2
                if len(pair) >= 5 and pair != compound:
                    primary_clauses.append(f'"{pair}"')

    # 2. CamelCase split for single compound words (e.g. "DriveSafe" -> "Drive Safe")
    if len(tokens) == 1:
        single = tokens[0]
        split_single = re.sub(r'([a-z])([A-Z])', r'\1 \2', single)
        split_single = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', split_single)
        if split_single != single:
            primary_clauses.append(f'"{split_single}"')
            sub_tokens = split_single.split()
            if len(sub_tokens) > 1:
                primary_clauses.append(f'(' + " AND ".join(f'"{t}"' for t in sub_tokens) + ')')
        primary_clauses.append(f'"{single}"')

    # 3. Conjunction (AND) of informative content words
    if len(content_tokens) > 1:
        and_part = " AND ".join(f'"{t}"' for t in content_tokens)
        primary_clauses.append(f'({and_part})')

    primary_query = " OR ".join(primary_clauses)

    fallback_query = ""
    if len(content_tokens) > 1:
        or_part = " OR ".join(f'"{t}"' for t in content_tokens)
        fallback_query = f'({or_part})'

    return primary_query, fallback_query


def _faiss_search(query, top_k, min_sim=0.15, root_folder=None):
    """Semantic similarity search via FAISS with folder pre-filtering."""
    if not query.strip():
        return []
    index = load_index()
    if index is None or index.ntotal == 0:
        return []

    q_emb = encode_query(query).reshape(1, -1)
    normalized_root = _normalize_root(root_folder)

    # When scoped to a folder, pre-filter candidate chunk IDs to avoid being
    # drowned out by global nearest neighbors from outside the folder
    folder_cids = None
    if normalized_root:
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT chunks.id
                   FROM chunks
                   JOIN files ON chunks.file_id = files.id
                   WHERE files.path = ? OR files.path LIKE ?""",
                (normalized_root, normalized_root + os.sep + "%"),
            )
            folder_cids = [r[0] for r in cur.fetchall()]
        finally:
            conn.close()

        if not folder_cids:
            return []

    scores = None
    ids = None
    if folder_cids is not None:
        try:
            sel = faiss.IDSelectorBatch(folder_cids)
            params = faiss.SearchParameters(sel=sel)
            k_search = min(top_k, len(folder_cids))
            scores, ids = index.search(q_emb, k_search, params=params)
        except Exception:
            # Fallback if IDSelector is unsupported: over-fetch to capture folder items
            scores, ids = index.search(q_emb, min(index.ntotal, top_k * 10))
    else:
        scores, ids = index.search(q_emb, top_k)

    hits = []
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
            if not row or not _path_in_root(row[0], normalized_root):
                continue
            hits.append((int(cid), float(sim)))
    finally:
        conn.close()

    return hits


def _fts5_search(query, top_k, root_folder=None):
    """Keyword search via SQLite FTS5 (BM25 ranking) with tiered query and folder scoping."""
    primary_q, fallback_q = _build_fts5_queries(query)
    if not primary_q:
        return []

    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        root_clause = ""
        folder_params = []
        if root_folder:
            root_clause = " AND (files.path = ? OR files.path LIKE ?)"
            folder_params = [root_folder, root_folder + os.sep + "%"]

        target_count = top_k * 5

        # 1. Primary Query: exact phrase, compound words, and AND conjunction
        cur.execute(
            f"""SELECT chunks_fts.rowid, rank, files.path
               FROM chunks_fts
               JOIN chunks ON chunks_fts.rowid = chunks.id
               JOIN files ON chunks.file_id = files.id
               WHERE chunks_fts MATCH ?{root_clause}
               ORDER BY rank
               LIMIT ?""",
            [primary_q] + folder_params + [target_count],
        )
        hits = [
            (row[0], -row[1])
            for row in cur.fetchall()
            if _path_in_root(row[2], root_folder)
        ]

        # 2. Fallback Query: OR disjunction across content words (down-weighted)
        needed = target_count - len(hits)
        if needed > 0 and fallback_q:
            seen_cids = {cid for cid, _ in hits}
            cur.execute(
                f"""SELECT chunks_fts.rowid, rank, files.path
                   FROM chunks_fts
                   JOIN chunks ON chunks_fts.rowid = chunks.id
                   JOIN files ON chunks.file_id = files.id
                   WHERE chunks_fts MATCH ?{root_clause}
                   ORDER BY rank
                   LIMIT ?""",
                [fallback_q] + folder_params + [needed * 2],
            )
            for row in cur.fetchall():
                if row[0] not in seen_cids and _path_in_root(row[2], root_folder):
                    seen_cids.add(row[0])
                    # Down-weight fallback partial matches by 0.2 so primary full matches always rank higher
                    hits.append((row[0], max(0.1, -row[1] * 0.2)))
                    if len(hits) >= target_count:
                        break

        return hits[:top_k]
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

        patterns = [f"%{query}%"]
        tokens = re.findall(r'[a-zA-Z0-9]+', query)
        for i in range(len(tokens) - 1):
            t1, t2 = tokens[i].lower(), tokens[i+1].lower()
            if t1 not in _STOP_WORDS and t2 not in _STOP_WORDS:
                pair = t1 + t2
                if len(pair) >= 5 and f"%{pair}%" not in patterns:
                    patterns.append(f"%{pair}%")

        where_parts = []
        pattern_params = []
        for p in patterns:
            where_parts.append("(path LIKE ? OR filename LIKE ?)")
            pattern_params.extend([p, p])

        where_clause = " OR ".join(where_parts)
        cur.execute(
            f"""SELECT id, path FROM files
               WHERE ({where_clause})
               """ + root_clause + """
               ORDER BY created_time DESC, modified_time DESC
               LIMIT ?""",
            [*pattern_params, *root_params, top_k * 5],
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
    root_folder = _normalize_root(root_folder)
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

    w_sem, w_kw, w_fn = _classify_query_intent(query)
    fetch_k = max(30, top_k * 5)  # over-fetch for better fusion

    sem_hits = _faiss_search(query, fetch_k, min_sim=min_similarity, root_folder=root_folder)
    kw_hits = _fts5_search(query, fetch_k, root_folder=root_folder)
    fn_hits = _filename_search(query, fetch_k, root_folder=root_folder)

    # ── RRF at chunk level (with dynamic intent weighting) ─────────────
    chunk_rrf = {}
    # Track which search signals contributed to each chunk
    chunk_signals = defaultdict(set)  # cid -> {'semantic', 'keyword'}

    for rank, (cid, _score) in enumerate(sem_hits, 1):
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + w_sem / (_RRF_K + rank)
        chunk_signals[cid].add('semantic')

    for rank, (cid, _score) in enumerate(kw_hits, 1):
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + w_kw / (_RRF_K + rank)
        chunk_signals[cid].add('keyword')

    # ── Filename matches get injected directly as file-level hits ──
    filename_boost = {}
    for rank, (_fid, path) in enumerate(fn_hits, 1):
        filename_boost[path] = (w_fn * 1.0) / (_RRF_K + rank)

    if not chunk_rrf and not filename_boost:
        return []

    # ── Map chunk IDs → file paths + created_time + chunk text ────────
    all_ids = list(chunk_rrf.keys())
    conn = get_connection()
    cur = conn.cursor()

    rows = []
    if all_ids:
        placeholders = ",".join("?" * len(all_ids))
        cur.execute(
            f"""SELECT chunks.id, files.path, files.created_time, chunks.text
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
    file_best_rrf = {}
    file_signals = defaultdict(set)  # path -> set of signal types
    file_best_chunk = {}

    for cid, path, ctime, ctext in rows:
        rrf = chunk_rrf.get(cid, 0)
        if path not in file_best_rrf or rrf > file_best_rrf[path]:
            file_best_rrf[path] = rrf
            file_best_chunk[path] = ctext or ""
        file_signals[path].update(chunk_signals.get(cid, set()))
        if ctime is not None:
            file_created[path] = ctime

    # Add filename-match boost to RRF scores
    for path, boost in filename_boost.items():
        file_best_rrf[path] = file_best_rrf.get(path, 0) + boost
        file_signals[path].add('filename')

    # ── Two-Stage Fine-Grained Candidate Rescoring ──────
    # Rescores candidate files based on exact phrase alignment, compound token matching,
    # and query content-term coverage.
    tokens = re.findall(r'[a-zA-Z0-9]+', query)
    content_tokens = [t.lower() for t in tokens if t.lower() not in _STOP_WORDS]
    if not content_tokens:
        content_tokens = [t.lower() for t in tokens]
    clean_query = " ".join(tokens).lower()

    # Compound token matches (e.g. bio + data -> biodata, drive + safe -> drivesafe)
    compound_tokens = []
    for i in range(len(tokens) - 1):
        t1, t2 = tokens[i].lower(), tokens[i+1].lower()
        if t1 not in _STOP_WORDS and t2 not in _STOP_WORDS:
            pair = t1 + t2
            if len(pair) >= 5:
                compound_tokens.append(pair)

    for path in list(file_best_rrf.keys()):
        fname = os.path.basename(path).lower()
        chunk_txt = file_best_chunk.get(path, "").lower()
        corpus = f"{fname} {chunk_txt}"

        # 1. Exact phrase match bonus
        if clean_query and clean_query in corpus:
            file_best_rrf[path] *= 1.25

        # 2. Compound word bonus
        if any(c in corpus for c in compound_tokens):
            file_best_rrf[path] *= 1.15

        # 3. Term coverage ratio
        if len(content_tokens) >= 2:
            covered = sum(1 for tok in content_tokens if tok in corpus)
            ratio = covered / len(content_tokens)
            file_best_rrf[path] *= (0.75 + 0.35 * ratio)

        # 4. Multi-signal boost on RRF: files matching multiple independent search modes
        # receive a ranking multiplier so verified matches leapfrog
        n_signals = len(file_signals.get(path, set()))
        if n_signals >= 3:
            file_best_rrf[path] *= 1.35
        elif n_signals >= 2:
            file_best_rrf[path] *= 1.25

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

    # ── Compute normalized confidence scores (0–100%) ───
    # Uses min-max normalization of RRF scores with a multi-signal boost.
    # This replaces the old misleading raw-cosine display.
    if not ranked:
        return []

    rrf_values = [rrf for _, rrf in ranked]
    rrf_max = max(rrf_values)
    rrf_min = min(rrf_values)
    rrf_range = rrf_max - rrf_min

    # Base confidence range: top result gets ~92%, worst gets ~40%
    _CONF_CEIL = 0.92
    _CONF_FLOOR = 0.40

    results = []
    for path, rrf in ranked:
        # Normalize RRF score to [FLOOR, CEIL] range
        if rrf_range > 0:
            norm = (rrf - rrf_min) / rrf_range
        else:
            # All results have the same RRF score
            norm = 1.0
        confidence = _CONF_FLOOR + norm * (_CONF_CEIL - _CONF_FLOOR)

        # Multi-signal boost: files matched by multiple signals get
        # a confidence bump (max +8% for all three signals matching)
        n_signals = len(file_signals.get(path, set()))
        if n_signals >= 3:
            confidence += 0.08  # semantic + keyword + filename
        elif n_signals == 2:
            confidence += 0.05  # two signals agree
        # Single-signal hits keep their base confidence

        confidence = min(confidence, 0.99)  # cap at 99%

        results.append({
            "path": path,
            "score": round(confidence, 3),
            "created_time": file_created.get(path),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]

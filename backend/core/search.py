import difflib
import os
import logging
from collections import defaultdict
from core.model import encode_query
from core.faiss_manager import load_index
from core.db import get_connection

# Reciprocal Rank Fusion constant (higher = more uniform blending)
_RRF_K = 60
_SEMANTIC_MARGIN = 0.035
# A fallback FTS OR-query is recall evidence, not the same as a phrase or
# conjunction match.  Keep it available for conceptual searches, but prevent
# a ubiquitous token such as "system" from dominating hybrid fusion.
_FTS_FALLBACK_WEIGHT = 0.20

logger = logging.getLogger("intellifile.search")


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


def _file_metadata_clause(root_folder=None, date_from=None, date_to=None, table="files"):
    """Build SQL predicates for the canonical creation-date metadata field.

    ``date_to`` is deliberately exclusive.  This keeps month boundaries
    unambiguous: ``before July 2026`` is ``date < 2026-07-01`` and ``during
    July`` is ``2026-07-01 <= date < 2026-08-01``.
    """
    conditions = []
    params = []
    root_folder = _normalize_root(root_folder)
    if root_folder:
        conditions.append(f"({table}.path = ? OR {table}.path LIKE ?)")
        params.extend([root_folder, root_folder + os.sep + "%"])
    if date_from is not None:
        conditions.append(f"{table}.created_time >= ?")
        params.append(date_from)
    if date_to is not None:
        conditions.append(f"{table}.created_time < ?")
        params.append(date_to)
    return (" AND " + " AND ".join(conditions)) if conditions else "", params


def _metadata_matches(created_time, date_from=None, date_to=None):
    """Return whether a known creation timestamp satisfies an exclusive range."""
    if date_from is None and date_to is None:
        return True
    if created_time is None:
        return False
    if date_from is not None and created_time < date_from:
        return False
    if date_to is not None and created_time >= date_to:
        return False
    return True


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

# _IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff')


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
    1. Primary (high precision): exact phrase, compound words, adjacent prefix phrase, and AND conjunction of content words.
    2. Fallback (high recall): OR disjunction across content words (only used if primary needs more candidates).
    """
    # Normalize 3+ repeated characters for typo resilience (e.g. "safeeee" -> "safe")
    clean_query = re.sub(r'([a-zA-Z])\1{2,}', r'\1', str(query or ""))
    tokens = re.findall(r'[a-zA-Z0-9]+', clean_query)
    if not tokens:
        return "", ""

    clean_phrase = " ".join(tokens)
    content_tokens = [t for t in tokens if t.lower() not in _STOP_WORDS]
    if not content_tokens:
        content_tokens = tokens  # fallback if query consists solely of stopwords

    primary_clauses = []
    # 1. Exact phrase match and adjacent term pairs
    if len(tokens) > 1:
        primary_clauses.append(f'"{clean_phrase}"')

        # Adjacent meaningful phrases preserve useful partial evidence
        for i in range(len(tokens) - 1):
            t1, t2 = tokens[i].lower(), tokens[i+1].lower()
            if t1 not in _STOP_WORDS and t2 not in _STOP_WORDS:
                primary_clauses.append(f'"{t1} {t2}"')
                # Adjacent prefix matching (e.g. driv* + safe* matches DriveSafe / Drive Safe)
                if len(t1) >= 3 and len(t2) >= 3:
                    primary_clauses.append(f'({t1}* + {t2}*)')

    # 2. Compound words (e.g. driv + safe -> drivsafe*)
    if len(content_tokens) >= 2:
        for i in range(len(content_tokens) - 1):
            c = (content_tokens[i] + content_tokens[i+1]).lower()
            if len(c) >= 5:
                primary_clauses.append(f'"{c}"')
                primary_clauses.append(f'{c}*')

    # 3. CamelCase split for single compound words (e.g. "DriveSafe" -> "Drive Safe")
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
        if len(single) >= 4:
            primary_clauses.append(f'{single}*')

    # 4. Conjunction (AND) of informative content words (exact and prefix)
    if len(content_tokens) > 1:
        and_exact = " AND ".join(f'"{t}"' for t in content_tokens)
        primary_clauses.append(f'({and_exact})')
        prefix_tokens = [f"{t}*" if len(t) >= 4 else f'"{t}"' for t in content_tokens]
        and_prefix = " AND ".join(prefix_tokens)
        if and_prefix != and_exact:
            primary_clauses.append(f'({and_prefix})')

    primary_query = " OR ".join(primary_clauses)

    fallback_query = ""
    if len(content_tokens) > 1:
        or_part = " OR ".join(f'"{t}"' for t in content_tokens)
        fallback_query = f'({or_part})'

    return primary_query, fallback_query


def _faiss_search(query, top_k, min_sim=0.15, root_folder=None, date_from=None, date_to=None):
    """Semantic similarity search with deterministic metadata pre-filtering."""
    if not query.strip():
        return []
    index = load_index()
    if index is None or index.ntotal == 0:
        return []

    q_emb = encode_query(query).reshape(1, -1)
    normalized_root = _normalize_root(root_folder)

    # Metadata restrictions must be applied before ANN retrieval.  Filtering a
    # global top-k afterwards loses in-range candidates and makes mixed queries
    # appear randomly incomplete.
    candidate_cids = None
    if normalized_root or date_from is not None or date_to is not None:
        conn = get_connection()
        try:
            cur = conn.cursor()
            metadata_clause, metadata_params = _file_metadata_clause(
                normalized_root, date_from, date_to
            )
            cur.execute(
                """SELECT chunks.id
                   FROM chunks
                   JOIN files ON chunks.file_id = files.id
                   WHERE 1=1""" + metadata_clause,
                metadata_params,
            )
            candidate_cids = [r[0] for r in cur.fetchall()]
        finally:
            conn.close()

        if not candidate_cids:
            return []

    scores = None
    ids = None
    if candidate_cids is not None:
        try:
            sel = faiss.IDSelectorBatch(candidate_cids)
            params = faiss.SearchParameters()
            params.sel = sel
            k_search = min(top_k, len(candidate_cids))
            scores, ids = index.search(q_emb, k_search, params=params)
        except Exception:
            # IndexFlatIP is exact, so a full search is the only correct
            # fallback when an IDSelector is unavailable.
            scores, ids = index.search(q_emb, index.ntotal)
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
                """SELECT files.path, files.created_time
                   FROM chunks
                   JOIN files ON chunks.file_id = files.id
                   WHERE chunks.id = ?""",
                (int(cid),),
            )
            row = cur.fetchone()
            if (
                not row
                or not _path_in_root(row[0], normalized_root)
                or not _metadata_matches(row[1], date_from, date_to)
            ):
                continue
            hits.append((int(cid), float(sim)))
            if len(hits) >= top_k:
                break
    finally:
        conn.close()

    return hits


def _fts5_search(query, top_k, root_folder=None, date_from=None, date_to=None):
    """Keyword search via SQLite FTS5 (BM25 ranking) with tiered query and folder scoping."""
    primary_q, fallback_q = _build_fts5_queries(query)
    if not primary_q:
        return []

    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        metadata_clause, metadata_params = _file_metadata_clause(
            root_folder, date_from, date_to
        )

        target_count = top_k * 5

        # 1. Primary Query: exact phrase, compound words, and AND conjunction
        cur.execute(
            f"""SELECT chunks_fts.rowid, rank, files.path
               FROM chunks_fts
               JOIN chunks ON chunks_fts.rowid = chunks.id
               JOIN files ON chunks.file_id = files.id
               WHERE chunks_fts MATCH ?{metadata_clause}
               ORDER BY rank
               LIMIT ?""",
            [primary_q] + metadata_params + [target_count],
        )
        hits = [
            (row[0], -row[1])
            for row in cur.fetchall()
            if _path_in_root(row[2], root_folder)
        ]

        # 2. Fallback Query: OR disjunction across content words.  Partial
        # matches are useful only when the precision query found nothing;
        # appending hundreds of them below a few excellent primary matches was
        # the main source of lexical noise.
        needed = target_count - len(hits)
        if not hits and needed > 0 and fallback_q:
            seen_cids = {cid for cid, _ in hits}
            cur.execute(
                f"""SELECT chunks_fts.rowid, rank, files.path
                   FROM chunks_fts
                   JOIN chunks ON chunks_fts.rowid = chunks.id
                   JOIN files ON chunks.file_id = files.id
                   WHERE chunks_fts MATCH ?{metadata_clause}
                   ORDER BY rank
                   LIMIT ?""",
                [fallback_q] + metadata_params + [needed * 2],
            )
            for row in cur.fetchall():
                if row[0] not in seen_cids and _path_in_root(row[2], root_folder):
                    seen_cids.add(row[0])
                    # A negative score is an internal marker for weak OR
                    # fallback evidence.  It is deliberately distinct from a
                    # primary phrase/conjunction hit so the fusion stage can
                    # apply a smaller weight and avoid treating it as a
                    # precision signal.
                    hits.append((row[0], -max(0.1, -row[1] * _FTS_FALLBACK_WEIGHT)))
                    if len(hits) >= target_count:
                        break

        return hits[:top_k]
    except Exception:
        return []  # FTS5 table missing or query error
    finally:
        conn.close()


def _filename_search(query, top_k, root_folder=None, date_from=None, date_to=None):
    """Find exact and title-like filename matches without tokenising punctuation away."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        metadata_clause, metadata_params = _file_metadata_clause(
            root_folder, date_from, date_to
        )
        if not query.strip():
            cur.execute(
                """SELECT id, path FROM files
                   WHERE 1=1
                   """ + metadata_clause + """
                   ORDER BY created_time DESC, modified_time DESC
                   LIMIT ?""",
                metadata_params + [top_k],
            )
            return cur.fetchall()

        patterns = [f"%{query}%"]
        tokens = re.findall(r'[a-zA-Z0-9]+', query)
        content_tokens = [t.lower() for t in tokens if t.lower() not in _STOP_WORDS]
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

        # A title such as "Attention Is All You Need" is commonly stored with
        # hyphens or underscores.  Requiring all meaningful terms lets SQLite
        # find it without confusing a single shared word (for example "model")
        # for a title match.
        title_params = []
        if len(content_tokens) >= 2:
            where_parts.append(
                "(" + " AND ".join("filename LIKE ?" for _ in content_tokens) + ")"
            )
            title_params.extend(f"%{token}%" for token in content_tokens)

        where_clause = " OR ".join(where_parts)
        cur.execute(
            f"""SELECT id, path, filename, created_time FROM files
               WHERE ({where_clause})
               """ + metadata_clause + """
               ORDER BY created_time DESC, modified_time DESC
               LIMIT ?""",
            [*pattern_params, *title_params, *metadata_params, top_k * 10],
        )
        compact_query = re.sub(r"[^a-z0-9]+", "", query.lower())

        def filename_strength(row):
            compact_name = re.sub(r"[^a-z0-9]+", "", row[2].lower())
            if compact_query and compact_query in compact_name:
                return 3
            if content_tokens and all(token in row[2].lower() for token in content_tokens):
                return 2
            return 1

        rows = cur.fetchall()
        rows.sort(key=lambda row: (filename_strength(row), row[3] or 0), reverse=True)
        return [(row[0], row[1]) for row in rows[:top_k]]
    except Exception:
        return []
    finally:
        conn.close()


def _date_range_search(top_k=None, date_from=None, date_to=None, root_folder=None, offset=0):
    """Direct SQL query for files within a creation-date range.
    
    Used when the user issues a date-only query (e.g. 'files of august 2022')
    with no semantic keywords, so FAISS/FTS5 have nothing to match on.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        metadata_clause, params = _file_metadata_clause(root_folder, date_from, date_to)
        limit_clause = ""
        if top_k is not None:
            limit_clause = " LIMIT ? OFFSET ?"
            params.extend([top_k, max(0, offset)])
        cur.execute(
            f"""SELECT path, created_time FROM files
                WHERE 1=1{metadata_clause}
                ORDER BY created_time DESC, path ASC{limit_clause}""",
            params,
        )
        return [
            {"path": row[0], "score": 1.0, "created_time": row[1], "methods": ["date"]}
            for row in cur.fetchall()
        ]
    except Exception:
        return []
    finally:
        conn.close()


def _looks_like_gibberish(query):
    """Conservatively identify keyboard-mash queries with no word structure.

    This is intentionally not a dictionary check: an exact filename or FTS
    match remains valid even for an uncommon course code, acronym, or name.
    It only blocks dense-vector fallback for a long consonant-heavy string
    such as ``ffgggkggikhggh``.
    """
    letters = "".join(re.findall(r"[a-z]", str(query or "").lower()))
    if len(letters) < 8:
        return False
    vowel_ratio = sum(letter in "aeiouy" for letter in letters) / len(letters)
    has_long_consonant_run = bool(re.search(r"[bcdfghjklmnpqrstvwxz]{5,}", letters))
    has_repeated_run = bool(re.search(r"(.)\1{2,}", letters))
    return vowel_ratio < 0.20 and (has_long_consonant_run or has_repeated_run)


def _is_typo_match(term, w):
    """Accurately identify single-typo variations between a query token and corpus word."""
    if not term or not w or len(term) < 4 or len(w) < 4 or w in _STOP_WORDS:
        return False
    # Preserve first character, or for longer words (>= 7) last character
    if term[0] != w[0] and (len(term) < 7 or term[-1] != w[-1]):
        return False
    # 1-edit distance check (single substitution, swap, insertion, or deletion)
    if abs(len(term) - len(w)) <= 1:
        if len(term) == len(w):
            diffs = [i for i in range(len(term)) if term[i] != w[i]]
            if len(diffs) == 1:
                return True
            if len(diffs) == 2 and abs(diffs[0] - diffs[1]) == 1:
                return term[diffs[0]] == w[diffs[1]] and term[diffs[1]] == w[diffs[0]]
        else:
            short, long = (term, w) if len(term) < len(w) else (w, term)
            for i in range(len(long)):
                if long[:i] + long[i+1:] == short:
                    return True
    # For longer words (>= 7 chars), tolerate SequenceMatcher ratio >= 0.85
    if len(term) >= 7 and abs(len(term) - len(w)) <= 2:
        return difflib.SequenceMatcher(None, term, w).ratio() >= 0.85
    return False


def fuzzy_filename_search(query, top_k=20, root_folder=None, date_from=None, date_to=None):
    """Return typo-tolerant filename matches only after normal search misses.

    Candidate generation stays inside the existing FTS index, then a strict
    edit-similarity check is applied to filename tokens.  This avoids scanning
    every file or changing ordinary semantic/keyword ranking and confidence.
    """
    if _looks_like_gibberish(query):
        return []

    query_terms = [
        term.lower() for term in re.findall(r"[a-zA-Z0-9]+", query)
        if term.lower() not in _STOP_WORDS and len(term) >= 4
    ]
    if not query_terms or len(query_terms) > 4:
        return []

    conn = get_connection()
    try:
        cur = conn.cursor()
        metadata_clause, metadata_params = _file_metadata_clause(
            root_folder, date_from, date_to
        )
        cur.execute(
            f"""SELECT path, filename, created_time
                FROM files
                WHERE 1=1{metadata_clause}""",
            metadata_params,
        )
        candidates = cur.fetchall()
    except Exception:
        return []
    finally:
        conn.close()

    matches = []
    for path, filename, created_time in candidates:
        filename_terms = re.findall(r"[a-zA-Z0-9]+", (filename or "").lower())
        if not filename_terms:
            continue
        term_scores = [
            max(difflib.SequenceMatcher(None, term, candidate).ratio() for candidate in filename_terms)
            for term in query_terms
        ]
        mean_score = sum(term_scores) / len(term_scores)
        # Every meaningful word must plausibly refer to the title.  This makes
        # fuzzy matching a typo aid, not a broad semantic substitute.
        if min(term_scores) < 0.72 or mean_score < 0.86:
            continue
        matches.append((mean_score, path, created_time))

    matches.sort(key=lambda row: (-row[0], row[1].lower()))
    return [
        {
            "path": path,
            "score": round(min(0.82, max(0.65, score)), 3),
            "created_time": created_time,
            "methods": ["fuzzy"],
        }
        for score, path, created_time in matches[:top_k]
    ]


def folder_search(folder_name, root_folder=None, date_from=None, date_to=None):
    """List every indexed file in an exact folder-name match.

    This is intentionally a metadata-only operation: it does not load FAISS,
    run FTS, or call the embedding model.  If several folders have the same
    name, their files are returned together and retain their full paths.
    """
    normalized_name = " ".join(str(folder_name or "").split())
    if not normalized_name:
        return []

    conn = get_connection()
    try:
        cur = conn.cursor()
        root_folder = _normalize_root(root_folder)
        cur.execute(
            """SELECT DISTINCT folder_path
               FROM indexed_folders
               WHERE folder_name = ? COLLATE NOCASE""",
            (normalized_name,),
        )
        folder_paths = [row[0] for row in cur.fetchall() if row[0]]
        # Compatibility fallback for databases that have file rows but have
        # not yet received the one-time ancestor-catalog migration.
        if not folder_paths:
            cur.execute(
                """SELECT DISTINCT folder_path
                   FROM files
                   WHERE folder_name = ? COLLATE NOCASE""",
                (normalized_name,),
            )
            folder_paths = [row[0] for row in cur.fetchall() if row[0]]
        if not folder_paths:
            return []

        # Include the named folder and its descendants.  Parameters keep folder
        # names safe even when they contain SQL wildcard characters.
        folder_conditions = []
        folder_params = []
        for folder_path in folder_paths:
            escaped_prefix = (
                folder_path.rstrip("\\/")
                .replace("^", "^^")
                .replace("%", "^%")
                .replace("_", "^_")
            )
            # Use ^ as the escape character: backslashes are literal and very
            # common in Windows paths, so using them as SQL LIKE escapes would
            # make descendant-folder matching fail.
            folder_conditions.append("(files.folder_path = ? OR files.path LIKE ? ESCAPE '^')")
            folder_params.extend([folder_path, escaped_prefix + "\\%"])

        metadata_clause, metadata_params = _file_metadata_clause(
            root_folder, date_from, date_to
        )
        cur.execute(
            """SELECT files.path, files.created_time
               FROM files
               WHERE (""" + " OR ".join(folder_conditions) + ")" + metadata_clause + """
               ORDER BY files.created_time DESC, files.path ASC""",
            folder_params + metadata_params,
        )
        return [
            {
                "path": row[0],
                "score": 1.0,
                "created_time": row[1],
                "methods": ["folder"],
            }
            for row in cur.fetchall()
        ]
    except Exception:
        logger.exception("folder_search_failed folder_name=%r", normalized_name)
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

    # Normalize 3+ repeated characters for typo resilience (e.g. "safeeee" -> "safe")
    query = re.sub(r'([a-zA-Z])\1{2,}', r'\1', str(query or ""))

    # ── Fast path: date-only query (no keywords to search) ──
    # When the user asks "files of august 2022" the NLP parser strips
    # everything, leaving an empty query string.  FAISS and FTS5 cannot
    # match on an empty string, so we fall through to a direct SQL
    # date-range lookup instead.
    if not query.strip() and (date_from is not None or date_to is not None):
        # Date-only requests are deterministic metadata queries.  They return
        # every matching file (the caller may opt into _date_range_search's
        # explicit limit/offset pagination API) and never touch the model.
        return _date_range_search(None, date_from=date_from, date_to=date_to, root_folder=root_folder)

    w_sem, w_kw, w_fn = _classify_query_intent(query)
    fetch_k = max(30, top_k * 5)  # over-fetch for better fusion

    kw_hits = _fts5_search(
        query, fetch_k, root_folder=root_folder,
        date_from=date_from, date_to=date_to,
    )
    fn_hits = _filename_search(
        query, fetch_k, root_folder=root_folder,
        date_from=date_from, date_to=date_to,
    )

    # Dense retrieval has no inherent "no match" state: it will always return
    # nearest vectors.  Never turn a clear keyboard mash into a result list
    # unless the exact filename/primary FTS paths found real evidence first.
    has_primary_keyword = any(score >= 0 for _cid, score in kw_hits)
    if _looks_like_gibberish(query) and not (has_primary_keyword or fn_hits):
        logger.info("search_rejected_gibberish query_length=%d", len(query))
        return []

    sem_hits = _faiss_search(
        query, fetch_k, min_sim=min_similarity, root_folder=root_folder,
        date_from=date_from, date_to=date_to,
    )

    # ── RRF at chunk level (with dynamic intent weighting) ─────────────
    chunk_rrf = {}
    chunk_sims = {}  # cid -> float raw similarity
    # Track which search signals contributed to each chunk
    chunk_signals = defaultdict(set)  # cid -> {'semantic', 'keyword'}

    for rank, (cid, score) in enumerate(sem_hits, 1):
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + w_sem / (_RRF_K + rank)
        chunk_signals[cid].add('semantic')
        chunk_sims[cid] = max(chunk_sims.get(cid, 0.0), score)

    for rank, (cid, keyword_score) in enumerate(kw_hits, 1):
        is_fallback_keyword = keyword_score < 0
        keyword_weight = w_kw * (_FTS_FALLBACK_WEIGHT if is_fallback_keyword else 1.0)
        chunk_rrf[cid] = chunk_rrf.get(cid, 0) + keyword_weight / (_RRF_K + rank)
        chunk_signals[cid].add('weak_keyword' if is_fallback_keyword else 'keyword')

    # ── Filename matches get injected directly as file-level hits ──
    filename_boost = {}
    fuzzy_fn_paths = set()
    compact_query = re.sub(r"[^a-z0-9]+", "", query.lower())
    for rank, (_fid, path) in enumerate(fn_hits, 1):
        compact_name = re.sub(r"[^a-z0-9]+", "", os.path.basename(path).lower())
        exact_title = bool(compact_query and compact_query in compact_name)
        # A full title/filename match is deterministic evidence, not merely a
        # weak RRF hint.  Keep non-exact path matches useful but modest.
        strength = 5.0 if exact_title else 1.0
        filename_boost[path] = (w_fn * strength) / (_RRF_K + rank)

    # Typo-tolerant fuzzy filename hits provide strong deterministic title evidence
    fuzzy_fn_hits = fuzzy_filename_search(
        query, top_k=top_k, root_folder=root_folder,
        date_from=date_from, date_to=date_to,
    )
    for rank, f_hit in enumerate(fuzzy_fn_hits, 1):
        path = f_hit["path"]
        if path not in filename_boost:
            filename_boost[path] = (w_fn * 3.5) / (_RRF_K + rank)
            fuzzy_fn_paths.add(path)

    def _fallback_fuzzy():
        if query.strip():
            return fuzzy_filename_search(
                query,
                top_k=top_k,
                root_folder=root_folder,
                date_from=date_from,
                date_to=date_to,
            )
        return []

    if not chunk_rrf and not filename_boost:
        return _fallback_fuzzy()

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
    file_best_sim = {}  # path -> highest semantic similarity score

    for cid, path, ctime, ctext in rows:
        rrf = chunk_rrf.get(cid, 0)
        if path not in file_best_rrf or rrf > file_best_rrf[path]:
            file_best_rrf[path] = rrf
            file_best_chunk[path] = ctext or ""
        file_signals[path].update(chunk_signals.get(cid, set()))
        if cid in chunk_sims:
            file_best_sim[path] = max(file_best_sim.get(path, 0.0), chunk_sims[cid])
        if ctime is not None:
            file_created[path] = ctime

    # Add filename-match boost to RRF scores
    for path, boost in filename_boost.items():
        file_best_rrf[path] = file_best_rrf.get(path, 0) + boost
        if path in fuzzy_fn_paths:
            file_signals[path].add('fuzzy')
        else:
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
        corpus_words = set(re.findall(r'[a-z0-9]+', corpus))

        resolved_terms = []
        def contains_term(term):
            if term in corpus:
                resolved_terms.append(term)
                return True
            # Align lightweight coverage checks with FTS5's Porter stemming
            # for common plurals without introducing another dependency.
            if len(term) > 3 and term.endswith("s") and term[:-1] in corpus:
                resolved_terms.append(term[:-1])
                return True
            if len(term) >= 4 and any(w.startswith(term) for w in corpus_words):
                for w in corpus_words:
                    if w.startswith(term):
                        resolved_terms.append(w)
                        break
                return True
            # Fuzzy match individual content terms with typo tolerance (e.g. lojistic -> logistic, beth -> bath)
            for w in corpus_words:
                if _is_typo_match(term, w):
                    file_signals[path].add('fuzzy')
                    resolved_terms.append(w)
                    return True
            return False

        # If image file matched on content (semantic or keyword), mark OCR signal
        # if path.lower().endswith(_IMAGE_EXTS):
        #     if 'semantic' in file_signals[path] or 'keyword' in file_signals[path]:
        #         file_signals[path].add('ocr')

        # 1. Exact phrase match bonus
        phrase_matched = False
        if clean_query and clean_query in corpus:
            file_best_rrf[path] *= 1.25
            phrase_matched = True

        # 2. Compound word bonus (with typo and fuzzy tolerance)
        has_compound = any(
            c in corpus or any(_is_typo_match(c, w) for w in corpus_words)
            for c in compound_tokens
        )
        if has_compound:
            file_best_rrf[path] *= 1.25
            file_signals[path].add('fuzzy')

        # 3. Term coverage ratio
        if content_tokens:
            covered = sum(1 for tok in content_tokens if contains_term(tok))
            ratio = covered / len(content_tokens)
            if len(content_tokens) >= 2:
                file_best_rrf[path] *= (0.75 + 0.35 * ratio)
                if not phrase_matched and len(resolved_terms) == len(content_tokens):
                    resolved_phrase = " ".join(resolved_terms)
                    if resolved_phrase in corpus:
                        file_best_rrf[path] *= 1.25
            elif len(content_tokens) == 1 and ratio == 1.0:
                file_best_rrf[path] *= 1.20

        # 4. Multi-signal boost on RRF: files matching multiple independent search modes
        # receive a ranking multiplier so verified matches leapfrog
        n_signals = len(file_signals.get(path, set()))
        if n_signals >= 3:
            file_best_rrf[path] *= 1.35
        elif n_signals >= 2:
            file_best_rrf[path] *= 1.25

    # ── Precision gate ──────────────────────────────────
    # When FTS5 or a filename supplies deterministic evidence, semantic-only
    # neighbours are not allowed to fill the result list.  If no such evidence
    # exists, retain a narrow semantic band around the best *file* score; this
    # makes an empty result possible instead of treating every top-k vector as
    # a match.
    precise_paths = {
        path for path, signals in file_signals.items()
        if "keyword" in signals or "filename" in signals or "fuzzy" in signals
    }
    best_semantic = max(file_best_sim.values(), default=0.0)
    semantic_floor = max(min_similarity, best_semantic - _SEMANTIC_MARGIN)
    semantic_paths = {
        path for path, score in file_best_sim.items()
        if score >= semantic_floor
    }
    if precise_paths:
        # A phrase/title hit is sufficient evidence on its own, but it does
        # not prove that another high-quality semantic passage is irrelevant.
        # Retain only the tightly clustered dense neighbours alongside those
        # deterministic hits; this supports mixed wording such as
        # "student proctoring system" without reopening the arbitrary top-k.
        valid_paths = precise_paths | semantic_paths
    else:
        valid_paths = semantic_paths

    file_best_rrf = {p: score for p, score in file_best_rrf.items() if p in valid_paths}
    if not file_best_rrf:
        return _fallback_fuzzy()

    # Sort by RRF rank
    ranked = sorted(file_best_rrf.items(), key=lambda x: x[1], reverse=True)

    # ── Defensive date filtering ─────────────────────────
    # Candidates were already pre-filtered before retrieval.  Keep this guard
    # for filename-only rows and reject unknown timestamps instead of leaking
    # files that cannot be shown to satisfy a deterministic constraint.
    if date_from is not None or date_to is not None:
        filtered = []
        for path, rrf in ranked:
            ctime = file_created.get(path)
            if not _metadata_matches(ctime, date_from, date_to):
                continue
            filtered.append((path, rrf))
            file_signals[path].add('date')
        ranked = filtered

    # Copies are common across Downloads, OneDrive, and phone sync folders.
    # We already aggregate chunks per file; also collapse candidates with the
    # same matched passage so one document does not consume several result
    # slots under different paths.
    deduped = []
    seen_passages = set()
    for path, rrf in ranked:
        passage = re.sub(r"\s+", " ", file_best_chunk.get(path, "").strip().lower())
        if passage:
            if passage in seen_passages:
                continue
            seen_passages.add(passage)
        deduped.append((path, rrf))
    ranked = deduped[:top_k]
    if not ranked:
        return _fallback_fuzzy()

    # ── Compute grounded confidence scores (0–100%) ─────
    # Grounded in signal strength, exact keyword matches, and real vector cosine similarity
    # rather than artificially scaling low-similarity noise up to 92%.
    results = []
    for path, rrf in ranked:
        signals = file_signals.get(path, set())
        raw_sim = file_best_sim.get(path, 0.0)

        if 'keyword' in signals and 'filename' in signals:
            base_conf = 0.92
        elif path in fuzzy_fn_paths or ('fuzzy' in signals and 'filename' in signals):
            base_conf = 0.90
        elif 'filename' in signals:
            base_conf = 0.85
        elif 'fuzzy' in signals:
            base_conf = 0.82
        elif 'keyword' in signals:
            base_conf = 0.80
        elif raw_sim > 0:
            # Semantic only: score reflects actual cosine similarity
            # e.g., 0.40 -> ~50%, 0.60 -> ~75%, 0.80+ -> 90%+
            base_conf = min(0.92, max(0.40, raw_sim * 1.15))
        else:
            base_conf = 0.50

        # Multi-signal boost: independent verification across modes
        n_signals = len(signals)
        if n_signals >= 3:
            confidence = min(0.99, base_conf + 0.08)
        elif n_signals == 2:
            confidence = min(0.96, base_conf + 0.05)
        else:
            confidence = base_conf

        confidence = min(confidence, 0.99)

        signals = file_signals.get(path, set())
        methods = [m for m in ["fuzzy", "filename", "keyword", "semantic", "ocr", "date"] if m in signals]
        if not methods:
            methods = ["semantic"] if rrf > 0 else ["filename"]

        results.append({
            "path": path,
            "score": round(confidence, 3),
            "created_time": file_created.get(path),
            "methods": methods,
        })

    # ``score`` is a user-facing confidence estimate and deliberately has
    # coarse buckets.  Ranking by it after RRF destroys the evidence-based
    # order (and was the direct cause of unrelated semantic hits jumping ahead
    # of exact keyword/title matches).  Preserve the fused order above.
    logger.info(
        "search_complete query_terms=%d semantic_hits=%d keyword_hits=%d "
        "filename_hits=%d returned=%d",
        len(content_tokens), len(sem_hits), len(kw_hits), len(fn_hits), len(results),
    )
    if not results:
        return _fallback_fuzzy()
    return results[:top_k]


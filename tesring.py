"""
Embedding Model Benchmark: BGE-small vs Nomic-embed-text
=========================================================
ONNX Runtime only — no PyTorch / SentenceTransformers required.

Compares:
  1. Encoding speed (tokens/sec, texts/sec)
  2. Peak memory usage
  3. Retrieval quality (cosine-similarity relevance on curated pairs)

Usage:
    python benchmark_embeddings.py
"""

import os
import sys
import glob
import time
import json
import tracemalloc
import numpy as np

# ─── Configuration ──────────────────────────────────────────────────────────
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "models")

MODELS = {
    "bge-small-en-v1.5": {
        "repo": "Xenova/bge-small-en-v1.5",
        "dim": 384,
        "query_prefix": "Represent this sentence for searching relevant passages: ",
    },
    "nomic-embed-text-v1.5": {
        "repo": "nomic-ai/nomic-embed-text-v1.5",
        "dim": 768,
        "query_prefix": "search_query: ",
        "doc_prefix": "search_document: ",
        "onnx_file": "onnx/model_q4.onnx",   # <-- pick your variant here
    },
}

# ─── Test Data ──────────────────────────────────────────────────────────────
# Curated relevance pairs: (query, relevant_doc, irrelevant_doc)
# Models are scored on how well they rank the relevant doc above the irrelevant.
RETRIEVAL_PAIRS = [
    (
        "How to merge PDF files on Windows",
        "This guide explains how to combine multiple PDF documents into a single file using free tools on Windows 10 and 11.",
        "Best recipes for homemade pasta with tomato sauce and fresh basil.",
    ),
    (
        "Python asyncio tutorial",
        "Learn how to write concurrent code in Python using the asyncio library, including coroutines, tasks, and event loops.",
        "The history of ancient Roman aqueducts and their engineering principles.",
    ),
    (
        "machine learning model deployment",
        "A practical guide to deploying ML models to production using Docker containers, REST APIs, and monitoring dashboards.",
        "How to grow organic tomatoes in a small backyard garden.",
    ),
    (
        "quarterly financial report Q3 2024",
        "Third quarter earnings showed a 12% revenue increase driven by cloud services and subscription growth.",
        "Step-by-step instructions for assembling IKEA furniture.",
    ),
    (
        "employee onboarding checklist",
        "New hire onboarding process: IT setup, HR paperwork, team introductions, first-week training schedule, and 30-60-90 day goals.",
        "Exploring the deep sea: bioluminescent creatures found in the Mariana Trench.",
    ),
    (
        "configure nginx reverse proxy",
        "Set up nginx as a reverse proxy with SSL termination, load balancing, and caching for a Node.js application.",
        "The migration patterns of monarch butterflies across North America.",
    ),
    (
        "invoice processing automation",
        "Automate invoice data extraction using OCR and rule-based matching to reduce manual accounting effort by 80%.",
        "A comprehensive review of the best noise-cancelling headphones for 2024.",
    ),
    (
        "data privacy GDPR compliance",
        "Ensure your organization meets GDPR requirements: data mapping, consent management, breach notification, and DPO appointment.",
        "Top 10 hiking trails in the Swiss Alps with difficulty ratings and scenic highlights.",
    ),
    (
        "kubernetes pod scheduling",
        "Kubernetes scheduler uses node affinity, taints, tolerations, and resource requests to place pods on appropriate cluster nodes.",
        "The art of Japanese calligraphy: brush techniques and ink preparation methods.",
    ),
    (
        "contract renewal negotiation tips",
        "Strategies for renegotiating vendor contracts: benchmark pricing, multi-year discounts, SLA improvements, and exit clause reviews.",
        "How to photograph the northern lights with a DSLR camera in Iceland.",
    ),
]

# Texts for throughput benchmarking (varying lengths)
THROUGHPUT_TEXTS_SHORT = [
    f"This is a short test sentence number {i} for benchmarking embedding speed."
    for i in range(200)
]

THROUGHPUT_TEXTS_MEDIUM = [
    f"Document chunk {i}: The quick brown fox jumps over the lazy dog. "
    f"This sentence is repeated to simulate a medium-length text passage that "
    f"might appear in a typical document chunk during file indexing. "
    f"Additional context is added here to push the token count higher and "
    f"test how the model handles more substantial inputs."
    for i in range(200)
]

THROUGHPUT_TEXTS_LONG = [
    f"Long document passage {i}: " + " ".join([
        "Enterprise knowledge management systems require robust search capabilities "
        "that go beyond simple keyword matching. Semantic search uses embedding models "
        "to understand the meaning behind queries and documents, enabling users to find "
        "relevant information even when exact terms differ. This is particularly valuable "
        "in large organizations where documents span multiple departments, formats, and "
        "writing styles. Effective retrieval depends on the quality of the underlying "
        "embedding model — its ability to capture nuance, handle domain-specific "
        "terminology, and maintain performance across varying document lengths."
    ] * 2)
    for i in range(100)
]


# ─── Helpers ────────────────────────────────────────────────────────────────
def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors."""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))

def download_model(repo_id, models_dir, onnx_file=None):
    cache_name = repo_id.replace("/", "--")
    model_dir = os.path.join(models_dir, f"models--{cache_name}")

    if os.path.isdir(model_dir):
        onnx_files = glob.glob(os.path.join(model_dir, "**", "*.onnx"), recursive=True)
        real_onnx = [f for f in onnx_files if os.path.getsize(f) > 1024]
        if real_onnx:
            print(f"  ✓ {repo_id} already downloaded")
            return model_dir

    print(f"  ↓ Downloading {repo_id}...")
    try:
        from huggingface_hub import snapshot_download
        allow = [onnx_file, "*.json", "tokenizer*"] if onnx_file else ["*.onnx", "*.json", "tokenizer*"]
        snapshot_download(
            repo_id=repo_id,
            cache_dir=models_dir,
            allow_patterns=allow,
            ignore_patterns=None if onnx_file else ["*fp16*", "*int8*", "*quantized*", "*bnb4*", "*q4*", "*uint8*"],
        )
        print(f"  ✓ {repo_id} downloaded successfully")
    except Exception as e:
        print(f"  ✗ Failed to download {repo_id}: {e}")
        sys.exit(1)

    return model_dir


def _resolve_hf_pointer(filepath):
    """Resolve a HuggingFace Git-LFS pointer file to the actual blob path.

    HuggingFace's cache stores tiny pointer files (~134 bytes) in snapshots/
    that look like:
        version https://git-lfs.github.com/spec/v1
        oid sha256:<hash>
        size <bytes>
    The real binary lives at  <model_cache>/blobs/<hash>.
    """
    # If file is larger than 1 KB it's almost certainly the real model, not a pointer
    if os.path.getsize(filepath) > 1024:
        return filepath

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read(512)
        if "https://git-lfs.github.com/spec/v1" not in content:
            return filepath  # not a pointer file

        # Extract the SHA-256 blob hash
        for line in content.splitlines():
            if line.startswith("oid sha256:"):
                blob_hash = line.split(":", 1)[1].strip()
                # Walk up to the model cache root (contains blobs/)
                # filepath is like: .../models--X/snapshots/<rev>/onnx/model.onnx
                search_dir = filepath
                for _ in range(10):  # safety limit
                    search_dir = os.path.dirname(search_dir)
                    blob_path = os.path.join(search_dir, "blobs", blob_hash)
                    if os.path.isfile(blob_path):
                        return blob_path
                break
    except Exception:
        pass

    return filepath  # fall back to original if resolution fails


def find_onnx_and_tokenizer(model_dir, preferred_name="model.onnx"):
    """Locate the ONNX model file and tokenizer.json inside the model cache dir.

    Handles HuggingFace's cache layout where snapshot files may be Git-LFS
    pointer files that reference the real binaries in the blobs/ directory.
    """
    onnx_files = glob.glob(os.path.join(model_dir, "**", "*.onnx"), recursive=True)
    tokenizer_files = glob.glob(os.path.join(model_dir, "**", "tokenizer.json"), recursive=True)

    if not onnx_files:
        # Try any .onnx file
        onnx_files = glob.glob(os.path.join(model_dir, "**", "*.onnx"), recursive=True)

    if not onnx_files:
        raise FileNotFoundError(f"No ONNX model found in {model_dir}")
    if not tokenizer_files:
        raise FileNotFoundError(f"No tokenizer.json found in {model_dir}")

    # Prefer model.onnx over variants
    best_onnx = onnx_files[0]
    for f in onnx_files:
        if os.path.basename(f) == os.path.basename(preferred_name):
            best_onnx = f
            break

    # Resolve LFS pointers to actual blobs
    best_onnx = _resolve_hf_pointer(best_onnx)
    best_tokenizer = _resolve_hf_pointer(tokenizer_files[0])

    # Final sanity check
    onnx_size = os.path.getsize(best_onnx)
    if onnx_size < 1024:
        raise FileNotFoundError(
            f"ONNX file is only {onnx_size} bytes (likely an unresolved LFS pointer). "
            f"Try deleting {model_dir} and re-running to force a fresh download."
        )

    return best_onnx, best_tokenizer


class OnnxEmbedder:
    """Lightweight ONNX-only embedding wrapper."""

    def __init__(self, name, onnx_path, tokenizer_path, dim, query_prefix="", doc_prefix=""):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.name = name
        self.dim = dim
        self.query_prefix = query_prefix
        self.doc_prefix = doc_prefix

        self.tokenizer = Tokenizer.from_file(tokenizer_path)
        self.session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])

        # Detect max sequence length
        self.max_seq_len = 512
        try:
            model_inputs = self.session.get_inputs()
            for inp in model_inputs:
                shape = getattr(inp, "shape", [])
                for dim_val in shape:
                    if isinstance(dim_val, int) and 1 <= dim_val <= 8192:
                        self.max_seq_len = dim_val
                        break
        except Exception:
            pass

        # Check if model has a fixed seq len from the tokenizer
        tok_max = getattr(self.tokenizer, "model_max_length", None)
        if isinstance(tok_max, int) and 1 <= tok_max <= 8192:
            self.max_seq_len = min(self.max_seq_len, tok_max)

        # Clamp to 512 for fair comparison (both models support at least 512)
        self.max_seq_len = min(self.max_seq_len, 512)

        try:
            self.tokenizer.enable_truncation(max_length=self.max_seq_len)
            self.tokenizer.enable_padding(length=self.max_seq_len)
        except Exception:
            pass

        # Cache input names
        self.input_names = [inp.name for inp in self.session.get_inputs()]

        onnx_size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
        print(f"  Loaded: {name}")
        print(f"    ONNX file size : {onnx_size_mb:.1f} MB")
        print(f"    Embedding dim  : {dim}")
        print(f"    Max seq length : {self.max_seq_len}")
        print(f"    ONNX inputs    : {self.input_names}")

    def encode(self, texts, normalize=True, batch_size=32, is_query=False):
        """Encode a list of texts into embeddings."""
        # Apply prefixes if needed
        if is_query and self.query_prefix:
            texts = [self.query_prefix + t for t in texts]
        elif not is_query and self.doc_prefix:
            texts = [self.doc_prefix + t for t in texts]

        all_embeddings = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            encoded = self.tokenizer.encode_batch(batch)

            max_len = self.max_seq_len
            if encoded:
                max_len = min(max(len(item.ids) for item in encoded), self.max_seq_len)

            input_ids = np.zeros((len(encoded), max_len), dtype=np.int64)
            attention_mask = np.zeros((len(encoded), max_len), dtype=np.int64)
            token_type_ids = np.zeros((len(encoded), max_len), dtype=np.int64)

            for row, item in enumerate(encoded):
                ids = item.ids[:max_len]
                input_ids[row, : len(ids)] = ids
                attention_mask[row, : len(ids)] = 1
                try:
                    type_ids = item.type_ids[:max_len]
                    token_type_ids[row, : len(type_ids)] = type_ids
                except Exception:
                    pass

            ort_inputs = {"input_ids": input_ids, "attention_mask": attention_mask}
            if "token_type_ids" in self.input_names:
                ort_inputs["token_type_ids"] = token_type_ids

            outputs = self.session.run(None, ort_inputs)

            # CLS pooling (first token)
            embeddings = outputs[0][:, 0]

            if normalize:
                norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
                norms = np.where(norms == 0, 1e-10, norms)
                embeddings = embeddings / norms

            all_embeddings.append(embeddings.astype("float32"))

        return np.vstack(all_embeddings)


def measure_throughput(embedder, texts, batch_size, label, warmup_runs=2):
    """Measure encoding throughput with warmup."""
    # Warmup
    for _ in range(warmup_runs):
        embedder.encode(texts[:10], batch_size=batch_size)

    # Timed run
    tracemalloc.start()
    mem_before = tracemalloc.get_traced_memory()[1]

    start = time.perf_counter()
    result = embedder.encode(texts, batch_size=batch_size)
    elapsed = time.perf_counter() - start

    mem_after = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()

    texts_per_sec = len(texts) / elapsed
    peak_mem_mb = (mem_after - mem_before) / (1024 * 1024)

    return {
        "label": label,
        "num_texts": len(texts),
        "elapsed_sec": round(elapsed, 3),
        "texts_per_sec": round(texts_per_sec, 1),
        "peak_mem_delta_mb": round(max(0, peak_mem_mb), 2),
        "output_shape": result.shape,
    }


def measure_retrieval_quality(embedder):
    """Score retrieval accuracy on curated query-document pairs."""
    correct = 0
    total = len(RETRIEVAL_PAIRS)
    margin_sum = 0.0
    details = []

    for query, relevant, irrelevant in RETRIEVAL_PAIRS:
        q_emb = embedder.encode([query], is_query=True)[0]
        doc_embs = embedder.encode([relevant, irrelevant], is_query=False)

        sim_relevant = cosine_similarity(q_emb, doc_embs[0])
        sim_irrelevant = cosine_similarity(q_emb, doc_embs[1])
        margin = sim_relevant - sim_irrelevant
        is_correct = sim_relevant > sim_irrelevant

        if is_correct:
            correct += 1
        margin_sum += margin

        details.append({
            "query": query[:50] + "..." if len(query) > 50 else query,
            "sim_relevant": round(sim_relevant, 4),
            "sim_irrelevant": round(sim_irrelevant, 4),
            "margin": round(margin, 4),
            "correct": is_correct,
        })

    return {
        "accuracy": round(correct / total * 100, 1),
        "correct": correct,
        "total": total,
        "avg_margin": round(margin_sum / total, 4),
        "details": details,
    }


# ─── Main Benchmark ────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("  EMBEDDING MODEL BENCHMARK — ONNX Runtime Only")
    print("  BGE-small-en-v1.5  vs  Nomic-embed-text-v1.5")
    print("=" * 70)
    print()

    # Step 1: Download models
    print("▸ Step 1: Downloading / verifying models")
    print("-" * 50)
    model_dirs = {}
    for name, cfg in MODELS.items():
        model_dirs[name] = download_model(cfg["repo"], MODELS_DIR, cfg.get("onnx_file"))
    print()

    # Step 2: Load models
    print("▸ Step 2: Loading ONNX sessions")
    print("-" * 50)
    embedders = {}
    for name, cfg in MODELS.items():
        preferred = os.path.basename(cfg["onnx_file"]) if cfg.get("onnx_file") else "model.onnx"
        onnx_path, tok_path = find_onnx_and_tokenizer(model_dirs[name], preferred_name=preferred)
        embedders[name] = OnnxEmbedder(
            name=name,
            onnx_path=onnx_path,
            tokenizer_path=tok_path,
            dim=cfg["dim"],
            query_prefix=cfg.get("query_prefix", ""),
            doc_prefix=cfg.get("doc_prefix", ""),
        )
    print()

    # Step 3: Throughput benchmarks
    print("▸ Step 3: Throughput Benchmarks")
    print("-" * 50)
    throughput_results = {}

    test_sets = [
        ("short (200 × ~15 tokens)", THROUGHPUT_TEXTS_SHORT),
        ("medium (200 × ~60 tokens)", THROUGHPUT_TEXTS_MEDIUM),
        ("long (100 × ~200 tokens)", THROUGHPUT_TEXTS_LONG),
    ]

    for name, embedder in embedders.items():
        throughput_results[name] = []
        print(f"\n  [{name}]")
        for label, texts in test_sets:
            result = measure_throughput(embedder, texts, batch_size=32, label=label)
            throughput_results[name].append(result)
            print(
                f"    {label:<30s}  "
                f"{result['elapsed_sec']:>6.2f}s  "
                f"{result['texts_per_sec']:>8.1f} texts/s  "
                f"mem Δ: {result['peak_mem_delta_mb']:>6.1f} MB"
            )

    print()

    # Step 4: Retrieval quality
    print("▸ Step 4: Retrieval Quality (10 curated query-document pairs)")
    print("-" * 50)
    retrieval_results = {}

    for name, embedder in embedders.items():
        result = measure_retrieval_quality(embedder)
        retrieval_results[name] = result
        print(f"\n  [{name}]")
        print(f"    Accuracy   : {result['accuracy']}% ({result['correct']}/{result['total']})")
        print(f"    Avg margin : {result['avg_margin']:.4f}")
        print(f"    {'Query':<45s}  {'Rel':>6s}  {'Irrel':>6s}  {'Margin':>7s}  {'OK?'}")
        print(f"    {'─' * 75}")
        for d in result["details"]:
            mark = "  ✓" if d["correct"] else "  ✗"
            print(
                f"    {d['query']:<45s}  "
                f"{d['sim_relevant']:>6.4f}  "
                f"{d['sim_irrelevant']:>6.4f}  "
                f"{d['margin']:>+7.4f}  "
                f"{mark}"
            )

    print()

    # ─── Summary ────────────────────────────────────────────────────────────
    print("=" * 70)
    print("  SUMMARY")
    print("=" * 70)

    # Speed comparison
    print("\n  ┌─ Speed (texts/sec, higher = better) ─────────────────────────┐")
    print(f"  │ {'Test Set':<32s}", end="")
    for name in embedders:
        short_name = name[:18]
        print(f"│ {short_name:>18s} ", end="")
    print("│")
    print(f"  ├{'─' * 33}", end="")
    for _ in embedders:
        print(f"┼{'─' * 20}", end="")
    print("┤")

    for i, (label, _) in enumerate(test_sets):
        short_label = label.split("(")[0].strip()
        print(f"  │ {short_label:<32s}", end="")
        speeds = {}
        for name in embedders:
            speed = throughput_results[name][i]["texts_per_sec"]
            speeds[name] = speed
        best = max(speeds.values())
        for name in embedders:
            speed = speeds[name]
            marker = " ★" if speed == best else "  "
            print(f"│ {speed:>14.1f}{marker}   ", end="")
        print("│")

    print(f"  └{'─' * 33}", end="")
    for _ in embedders:
        print(f"┴{'─' * 20}", end="")
    print("┘")

    # Quality comparison
    print("\n  ┌─ Retrieval Quality ───────────────────────────────────────────┐")
    print(f"  │ {'Metric':<32s}", end="")
    for name in embedders:
        short_name = name[:18]
        print(f"│ {short_name:>18s} ", end="")
    print("│")
    print(f"  ├{'─' * 33}", end="")
    for _ in embedders:
        print(f"┼{'─' * 20}", end="")
    print("┤")

    # Accuracy row
    print(f"  │ {'Accuracy (%)':<32s}", end="")
    accuracies = {name: retrieval_results[name]["accuracy"] for name in embedders}
    best_acc = max(accuracies.values())
    for name in embedders:
        acc = accuracies[name]
        marker = " ★" if acc == best_acc else "  "
        print(f"│ {acc:>14.1f}%{marker}  ", end="")
    print("│")

    # Margin row
    print(f"  │ {'Avg Margin':<32s}", end="")
    margins = {name: retrieval_results[name]["avg_margin"] for name in embedders}
    best_margin = max(margins.values())
    for name in embedders:
        m = margins[name]
        marker = " ★" if m == best_margin else "  "
        print(f"│ {m:>14.4f}{marker}   ", end="")
    print("│")

    # Dimension row
    print(f"  │ {'Embedding Dim':<32s}", end="")
    for name in embedders:
        d = embedders[name].dim
        print(f"│ {d:>18d} ", end="")
    print("│")

    print(f"  └{'─' * 33}", end="")
    for _ in embedders:
        print(f"┴{'─' * 20}", end="")
    print("┘")

    # Recommendation
    print()
    bge_speed_avg = np.mean([r["texts_per_sec"] for r in throughput_results["bge-small-en-v1.5"]])
    nomic_speed_avg = np.mean([r["texts_per_sec"] for r in throughput_results["nomic-embed-text-v1.5"]])
    bge_acc = retrieval_results["bge-small-en-v1.5"]["accuracy"]
    nomic_acc = retrieval_results["nomic-embed-text-v1.5"]["accuracy"]
    bge_margin = retrieval_results["bge-small-en-v1.5"]["avg_margin"]
    nomic_margin = retrieval_results["nomic-embed-text-v1.5"]["avg_margin"]

    speed_ratio = bge_speed_avg / nomic_speed_avg if nomic_speed_avg > 0 else float("inf")

    print("  RECOMMENDATION:")
    if nomic_acc > bge_acc or (nomic_acc == bge_acc and nomic_margin > bge_margin):
        if speed_ratio > 2.0:
            print("  → nomic-embed-text-v1.5 has BETTER retrieval quality but is significantly")
            print(f"    SLOWER ({speed_ratio:.1f}x). Consider nomic if quality is the priority,")
            print("    or stick with bge-small if speed matters (e.g. large-scale indexing).")
        else:
            print("  → nomic-embed-text-v1.5 is the WINNER — better quality with acceptable speed.")
            print(f"    Speed difference is only {speed_ratio:.1f}x, and quality is clearly superior.")
    elif bge_acc > nomic_acc or (bge_acc == nomic_acc and bge_margin > nomic_margin):
        print("  → bge-small-en-v1.5 is the WINNER — better (or equal) quality AND faster.")
        print("    Smaller dimension (384 vs 768) also means less storage and memory.")
    else:
        print("  → Both models perform comparably on quality. bge-small is recommended for")
        print("    its smaller footprint (384-dim vs 768-dim) and faster inference.")

    print()
    print(f"  Note: bge-small uses 384-dim embeddings ({384 * 4 / 1024:.1f} KB/vector)")
    print(f"        nomic uses 768-dim embeddings ({768 * 4 / 1024:.1f} KB/vector)")
    print(f"        Switching to nomic would ~2x your FAISS index size and memory usage.")
    print()

    # Save raw results to JSON
    output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "throughput": throughput_results,
        "retrieval": {
            name: {k: v for k, v in res.items() if k != "details"}
            for name, res in retrieval_results.items()
        },
        "retrieval_details": {name: res["details"] for name, res in retrieval_results.items()},
    }
    results_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark_results.json")
    with open(results_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"  Raw results saved to: {results_path}")
    print()


if __name__ == "__main__":
    main()
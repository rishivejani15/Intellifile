"""
IntelliFile Offline Setup Script
================================
Run this script ONCE while connected to the internet to download
and cache all AI models for offline use (embeddings + chat).

Usage:
    python backend/setup_offline.py
"""

import os
import sys
import urllib.request
import shutil


# ── Qwen GGUF download URLs (HuggingFace) ──────────────────────────
_QWEN_MODELS = {
    "qwen2.5-1.5b-instruct-q4_k_m.gguf": (
        "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/"
        "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    ),
    "qwen2.5-3b-instruct-q5_k_m.gguf": (
        "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/"
        "qwen2.5-3b-instruct-q5_k_m.gguf"
    ),
}


def _download_file(url: str, dest: str) -> None:
    """Download a file with a simple progress indicator."""
    print(f"      Downloading from: {url}")
    print(f"      Saving to:        {dest}")
    tmp = dest + ".part"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "IntelliFile-Setup/1.0"})
        with urllib.request.urlopen(req) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 1024 * 1024  # 1 MB
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    mb_down = downloaded / (1024 * 1024)
                    mb_total = total / (1024 * 1024)
                    print(f"\r      Progress: {mb_down:.0f}/{mb_total:.0f} MB ({pct:.1f}%)", end="", flush=True)
                else:
                    mb_down = downloaded / (1024 * 1024)
                    print(f"\r      Downloaded: {mb_down:.0f} MB", end="", flush=True)
            print()  # newline after progress
        shutil.move(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def main():
    print("=" * 60)
    print("  IntelliFile — Offline Model Setup")
    print("=" * 60)
    print()

    _BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
    _MODELS_DIR = os.path.join(_BACKEND_DIR, "models")
    os.makedirs(_MODELS_DIR, exist_ok=True)

    # ── Step 1: Embedding model (BGE) ────────────────────────────────
    model_name = os.getenv("IF_MODEL_PATH", "BAAI/bge-small-en-v1.5")
    print(f"[1/3] Downloading embedding model: {model_name}")
    print("      This may take a few minutes on first run...")

    try:
        from sentence_transformers import SentenceTransformer

        # Download strictly into models folder
        model = SentenceTransformer(model_name, cache_folder=_MODELS_DIR)

        # Verify with a test encoding
        test_embedding = model.encode("test", normalize_embeddings=True)
        print(f"      ✓ Embedding model loaded (dim: {len(test_embedding)}) → {_MODELS_DIR}")

        # Export ONNX version for faster runtime inference (3-5x speedup)
        onnx_dir = os.path.join(_MODELS_DIR, "onnx-export", model_name.replace("/", "--"))
        onnx_exists = os.path.isdir(onnx_dir) and any(
            f.endswith(".onnx") for _, _, fs in os.walk(onnx_dir) for f in fs
        )
        if onnx_exists:
            print(f"      ✓ ONNX export already exists → {onnx_dir}")
        else:
            print("      Exporting ONNX model for faster inference...")
            try:
                onnx_model = SentenceTransformer(
                    model_name,
                    backend="onnx",
                    model_kwargs={"provider": "CPUExecutionProvider"},
                    cache_folder=_MODELS_DIR,
                    device="cpu",
                )
                os.makedirs(onnx_dir, exist_ok=True)
                onnx_model.save_pretrained(onnx_dir)
                print(f"      ✓ ONNX model exported → {onnx_dir}")
            except Exception as onnx_err:
                print(f"      ⚠ ONNX export failed (will use PyTorch fallback): {onnx_err}")

    except Exception as e:
        print(f"      ✗ Failed to load embedding model: {e}")
        sys.exit(1)

    # ── Step 2: Qwen chat model (GGUF) ───────────────────────────────
    print()
    print("[2/3] Setting up Qwen chat model (GGUF)...")

    # Priority: 1.5B first (fast), then 3B (higher quality)
    primary = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    fallback = "qwen2.5-3b-instruct-q5_k_m.gguf"

    primary_path = os.path.join(_MODELS_DIR, primary)
    fallback_path = os.path.join(_MODELS_DIR, fallback)

    if os.path.exists(primary_path):
        size_mb = os.path.getsize(primary_path) / (1024 * 1024)
        print(f"      ✓ {primary} already present ({size_mb:.0f} MB)")
    else:
        print(f"      Downloading {primary} (~1 GB)...")
        try:
            _download_file(_QWEN_MODELS[primary], primary_path)
            size_mb = os.path.getsize(primary_path) / (1024 * 1024)
            print(f"      ✓ Downloaded {primary} ({size_mb:.0f} MB)")
        except Exception as e:
            print(f"      ✗ Failed to download {primary}: {e}")
            print("      ⚠ Chat will be unavailable unless you manually place the GGUF file in:")
            print(f"        {_MODELS_DIR}")

    if os.path.exists(fallback_path):
        size_mb = os.path.getsize(fallback_path) / (1024 * 1024)
        print(f"      ✓ {fallback} already present ({size_mb:.0f} MB)")
    else:
        print(f"      ℹ Optional: {fallback} not found (higher quality, ~2 GB).")
        print("        To download it, run:")
        print(f'        python -c "from backend.setup_offline import _download_file; '
              f'_download_file(\'{_QWEN_MODELS[fallback]}\', \'{fallback_path.replace(chr(92), "/")}\') "')

    # ── Step 3: Data files check ─────────────────────────────────────
    print()
    print("[3/3] Checking data files...")

    data_dir = os.path.join(_BACKEND_DIR, "data")
    if not os.path.isdir(data_dir):
        data_dir = os.path.join(os.path.dirname(__file__), "..", "backend", "data")
    if not os.path.isdir(data_dir):
        data_dir = os.path.join("backend", "data")
    if not os.path.isdir(data_dir):
        data_dir = "data"

    faiss_path = os.path.join(data_dir, "vectors.faiss")
    db_path = os.path.join(data_dir, "files.db")

    if os.path.exists(faiss_path):
        size_mb = os.path.getsize(faiss_path) / (1024 * 1024)
        print(f"      ✓ FAISS index found ({size_mb:.1f} MB)")
    else:
        print(f"      ⚠ FAISS index not found at {faiss_path}")
        print("        Run the indexing pipeline first to create it.")

    if os.path.exists(db_path):
        size_mb = os.path.getsize(db_path) / (1024 * 1024)
        print(f"      ✓ SQLite database found ({size_mb:.1f} MB)")
    else:
        print(f"      ⚠ SQLite database not found at {db_path}")
        print("        Run the indexing pipeline first to create it.")

    print()
    print("=" * 60)
    print("  Setup complete! The app can now run fully offline.")
    print("=" * 60)


if __name__ == "__main__":
    main()

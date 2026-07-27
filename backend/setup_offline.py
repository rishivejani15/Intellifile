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
import json
import argparse
import warnings


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


_json_mode = False

def _emit_json(msg_type, **kwargs):
    if _json_mode:
        payload = {"type": msg_type}
        payload.update(kwargs)
        print(json.dumps(payload), flush=True)

def _log(msg):
    if not _json_mode:
        print(msg)
    else:
        _emit_json("log", message=msg)

def _download_file(url: str, dest: str, name: str = "") -> None:
    """Download a file with a simple progress indicator."""
    _log(f"      Downloading from: {url}")
    _log(f"      Saving to:        {dest}")
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
                    if not _json_mode:
                        print(f"\r      Progress: {mb_down:.0f}/{mb_total:.0f} MB ({pct:.1f}%)", end="", flush=True)
                    else:
                        _emit_json("progress", name=name, downloaded_mb=mb_down, total_mb=mb_total, pct=pct)
                else:
                    mb_down = downloaded / (1024 * 1024)
                    if not _json_mode:
                        print(f"\r      Downloaded: {mb_down:.0f} MB", end="", flush=True)
                    else:
                        _emit_json("progress", name=name, downloaded_mb=mb_down, total_mb=None, pct=None)
            if not _json_mode:
                print()  # newline after progress
        shutil.move(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--appdata-dir", help="Target AppData directory for Intellifile")
    parser.add_argument("--json", action="store_true", help="Output JSON for IPC")
    args = parser.parse_args()
    
    global _json_mode
    _json_mode = args.json

    _log("=" * 60)
    _log("  IntelliFile — Offline Model Setup")
    _log("=" * 60)
    if not _json_mode:
        print()

    if args.appdata_dir:
        _BACKEND_DIR = os.path.join(args.appdata_dir, "backend")
    else:
        _BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
        
    _MODELS_DIR = os.path.join(_BACKEND_DIR, "models")
    os.makedirs(_MODELS_DIR, exist_ok=True)
    skip_chat_model = os.getenv("IF_SKIP_CHAT_MODEL", "1") == "1"

    # ── Step 1: Embedding model (BGE) ────────────────────────────────
    # We use the Xenova repository which hosts the native ONNX version of bge-small-en-v1.5.
    model_name = os.getenv("IF_MODEL_PATH", "Xenova/bge-small-en-v1.5")
    _log(f"[1/3] Downloading embedding model: {model_name} (ONNX)")
    _log("      This may take a few minutes on first run...")
    _emit_json("step", step=1, total=3, name="Embedding Model", status="downloading")

    try:
        try:
            from huggingface_hub import snapshot_download
        except ImportError as ie:
            _log(f"      [ERROR] huggingface_hub not available: {ie}")
            _emit_json("error", message=f"huggingface_hub import failed: {ie}")
            sys.exit(1)

        # Download directly as ONNX - no export, no PyTorch needed!
        # We only download the necessary files to keep the footprint tiny
        class _FilteredStderr:
            def __init__(self, dest):
                self.dest = dest
            def write(self, data):
                if not data:
                    return
                if "hf_xet" in data or "Xet Storage is enabled" in data:
                    return
                self.dest.write(data)
            def flush(self):
                self.dest.flush()

        old_stderr = sys.stderr
        sys.stderr = _FilteredStderr(old_stderr)
        try:
            snapshot_download(
                repo_id=model_name,
                cache_dir=_MODELS_DIR,
                allow_patterns=["*.onnx", "*.json", "tokenizer*"],
                ignore_patterns=["*model_fp16*", "*model_int8*", "*model_quantized*"]
            )
        finally:
            sys.stderr = old_stderr

        _log(f"      [OK] ONNX embedding model downloaded directly")
        _log(f"      [OK] Saved to -> {_MODELS_DIR}")

        _emit_json("step", step=1, total=3, name="Embedding Model", status="done")

    except Exception as e:
        _log(f"      [ERROR] Failed to setup embedding model (ONNX export is mandatory): {e}")
        _emit_json("error", message=str(e))
        sys.exit(1)

    # ── Step 2: Qwen chat model (GGUF) ───────────────────────────────
    if not _json_mode: print()
    if skip_chat_model:
        _log("[2/3] Skipping Qwen chat model download (chat disabled by policy)")
        _emit_json("step", step=2, total=3, name="Chat Model", status="done")
    else:
        _log("[2/3] Setting up Qwen chat model (GGUF)...")
        _emit_json("step", step=2, total=3, name="Chat Model", status="downloading")

        # Priority: 1.5B first (fast), then 3B (higher quality)
        primary = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
        fallback = "qwen2.5-3b-instruct-q5_k_m.gguf"

        primary_path = os.path.join(_MODELS_DIR, primary)
        fallback_path = os.path.join(_MODELS_DIR, fallback)

        if os.path.exists(primary_path):
            size_mb = os.path.getsize(primary_path) / (1024 * 1024)
            _log(f"      [OK] {primary} already present ({size_mb:.0f} MB)")
        else:
            _log(f"      Downloading {primary} (~1 GB)...")
            try:
                _download_file(_QWEN_MODELS[primary], primary_path, name="Qwen Chat Model")
                size_mb = os.path.getsize(primary_path) / (1024 * 1024)
                _log(f"      [OK] Downloaded {primary} ({size_mb:.0f} MB)")
            except Exception as e:
                _log(f"      [ERROR] Failed to download {primary}: {e}")
                _log("      [WARNING] Chat will be unavailable unless you manually place the GGUF file in:")
                _log(f"        {_MODELS_DIR}")
                _emit_json("error", message=f"Chat model download failed: {e}")

        if os.path.exists(fallback_path):
            size_mb = os.path.getsize(fallback_path) / (1024 * 1024)
            _log(f"      [OK] {fallback} already present ({size_mb:.0f} MB)")
        else:
            _log(f"      [INFO] Optional: {fallback} not found (higher quality, ~2 GB).")
            _log("        To download it, run:")
            _log(f'        python -c "from backend.setup_offline import _download_file; '
                 f'_download_file(\'{_QWEN_MODELS[fallback]}\', \'{fallback_path.replace(chr(92), "/")}\') "')
        
        _emit_json("step", step=2, total=3, name="Chat Model", status="done")

    # ── Step 3: Data files check ─────────────────────────────────────
    if not _json_mode: print()
    _log("[3/3] Checking data files...")
    _emit_json("step", step=3, total=3, name="Data Check", status="processing")

    data_dir = os.path.join(_BACKEND_DIR, "data")
    if not os.path.isdir(data_dir) and not args.appdata_dir:
        data_dir = os.path.join(os.path.dirname(__file__), "..", "backend", "data")
    if not os.path.isdir(data_dir) and not args.appdata_dir:
        data_dir = os.path.join("backend", "data")
    if not os.path.isdir(data_dir) and not args.appdata_dir:
        data_dir = "data"

    faiss_path = os.path.join(data_dir, "vectors.faiss")
    db_path = os.path.join(data_dir, "files.db")

    if os.path.exists(faiss_path):
        size_mb = os.path.getsize(faiss_path) / (1024 * 1024)
        _log(f"      [OK] FAISS index found ({size_mb:.1f} MB)")
    else:
        _log(f"      [WARNING] FAISS index not found at {faiss_path}")
        _log("        Run the indexing pipeline first to create it.")

    if os.path.exists(db_path):
        size_mb = os.path.getsize(db_path) / (1024 * 1024)
        _log(f"      [OK] SQLite database found ({size_mb:.1f} MB)")
    else:
        _log(f"      [WARNING] SQLite database not found at {db_path}")
        _log("        Run the indexing pipeline first to create it.")

    if not _json_mode: print()
    _log("=" * 60)
    _log("  Setup complete! The app can now run fully offline.")
    _log("=" * 60)
    
    _emit_json("step", step=3, total=3, name="Data Check", status="done")
    _emit_json("done", success=True)


if __name__ == "__main__":
    main()
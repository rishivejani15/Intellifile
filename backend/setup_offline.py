"""
IntelliFile Offline Setup Script
================================
Run this script ONCE while connected to the internet to download
and cache the AI model for offline semantic search.

Usage:
    python backend/setup_offline.py
"""

import os
import sys

def main():
    print("=" * 60)
    print("  IntelliFile — Offline Model Setup")
    print("=" * 60)
    print()

    # Step 1: Download and cache sentence-transformers model
    model_name = os.getenv("IF_MODEL_PATH", "all-MiniLM-L6-v2")
    print(f"[1/2] Downloading model: {model_name}")
    print("      This may take a few minutes on first run...")

    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(model_name)

        # Verify with a test encoding
        test_embedding = model.encode("test", normalize_embeddings=True)
        print(f"      ✓ Model loaded successfully (embedding dim: {len(test_embedding)})")
    except Exception as e:
        print(f"      ✗ Failed to load model: {e}")
        sys.exit(1)

    # Step 2: Verify FAISS index and SQLite database exist
    print()
    print("[2/2] Checking data files...")

    data_dir = os.path.join(os.path.dirname(__file__), "..", "backend", "data")
    # Also check relative to CWD (common when running from project root)
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

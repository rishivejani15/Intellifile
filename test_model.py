import os
import sys

# Ensure the backend folder is in path so we can import core.model
sys.path.append(os.path.abspath('backend'))

from core.model import MODEL

if MODEL is None:
    print("? Model failed to load. Have you run the setup script?")
    sys.exit(1)

print("? Model loaded successfully!")
print(f"Embedding Dimension: {MODEL.get_embedding_dimension()}")
print(f"Sentence Embedding Dimension: {MODEL.get_sentence_embedding_dimension()}")

print("\nTesting single text encoding...")
single_emb = MODEL.encode("This is a single test sentence.")
print(f"? Single embedding generated. Shape: {single_emb.shape}")

print("\nTesting batch encoding with 100 chunks and kwargs...")
# Create 100 dummy chunks
dummy_texts = [f"This is test chunk number {i} to verify the batching logic works properly." for i in range(100)]

# Pass batch_size=32 and a random kwargs like show_progress_bar
batch_emb = MODEL.encode(dummy_texts, batch_size=32, show_progress_bar=True, another_random_kwarg="test")

print(f"? Batch embedding generated. Shape: {batch_emb.shape}")

if batch_emb.shape[0] == 100 and batch_emb.shape[1] == 384:
    print("\n?? All tests passed! The model wrapper is fully compatible with the indexer.")
else:
    print(f"\n? Shape mismatch! Expected (100, 384), got {batch_emb.shape}")

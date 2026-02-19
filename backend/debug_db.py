import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "..", "data", "chunks.db")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("--- Chunks Table ---")
cursor.execute("SELECT id, source_name, created_at FROM chunks")
rows = cursor.fetchall()
for row in rows:
    print(row)

print("\n--- Max Created At ---")
cursor.execute("SELECT MAX(created_at) FROM chunks")
print(cursor.fetchone()[0])
conn.close()

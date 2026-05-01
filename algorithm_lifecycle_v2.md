# The IntelliFile Version Control Algorithm: Step-by-Step Lifecycle (V2)

Here is the exact, comprehensive lifecycle of your custom IntelliFile algorithm, including all of the optimizations, security features, and mathematical fixes we implemented today.

### Step 1: File Modification & The "Safe Zone" (Debounce)
1. **The OS Trigger:** A file is edited. The Windows operating system fires a rapid barrage of chaotic events (creating temp files, deleting, renaming).
2. **The 2.5-Second Debounce:** Your Node.js File Watcher (`main.js`) intercepts the chaos. It intercepts the barrage of events and starts a strict 2.5-second countdown timer. It refuses to act until the text editor or Microsoft Office application is completely finished saving.
3. **IPC Bridge:** Once the 2.5 seconds of silence are achieved, it sends exactly **one** verified `save_version` command over the IPC bridge to the Python backend (`engine_server.py`).

### Step 2: Strict Deduplication & Hashing
4. **Pre-Hash Verification:** The Python engine calculates the SHA-256 hash of the incoming file. 
5. **Deduplication Check:** It compares this hash to the last snapshot on record. If the hash is identical (meaning no actual data changed), the engine aborts the process immediately to prevent timeline bloat.
6. **Storage Grouping:** If it is a new change, the hashed file path becomes the Master Folder ID (e.g., `versions/<file_hash>/`).

### Step 3: Format Detection & Deep Parsing
7. **Routing:** `VersionEngine` (`version_engine.py`) detects if the file is `text`, `word` (.docx), `excel` (.xlsx), or `binary`.
8. **Previous State Loading:** For Word/Excel, the engine checks the `versions/` folder for the previous snapshot's `.structure.json` file. If found, it instantly loads the previous structural grid without having to perform heavy binary extraction.
9. **Binary Cracking:** The new raw binary file is cracked open by `word_parser.py` or `excel_parser.py`. It extracts the deep architecture (worksheets, exact cell coordinates, complex formulas, and paragraph texts).

### Step 4: Mathematical Structural Diffing
10. The engine compares the old architecture against the new architecture:
   - **Excel Engine:** Iterates over all existing worksheets, newly added worksheets, and deleted worksheets. It pinpoints exactly which individual cells were `added`, `cleared`, or `modified` (logging Old Value vs New Value).
   - **Word Engine:** Uses `difflib.SequenceMatcher` to mathematically align paragraph blocks, tagging them as `added`, `removed`, `replaced`, or `equal`.

### Step 5: Stringification (The Preparation)
11. **JSON Formatting:** The engine takes both the old structure and the new structure and converts them into strings using `json.dumps(indent=2)`. This perfectly formats the data into thousands of distinct lines, which is highly critical for the AI Risk Analyzer to accurately measure line-by-line entropy.

### Step 6: Information Weighted Semantic Diff (IWSD) & Risk Analysis
12. The stringified structures and the diff payload are fed into `risk_analyzer.py`.
13. **Shannon Entropy Execution:** The algorithm mathematically calculates the "Importance Score" of every changed line. Complex math formulas and long descriptive text generate massive Shannon Entropy scores, while empty spaces score near zero.
14. **Intent Detection:** The algorithm weighs the `add_score` against the `delete_score`. If a user deletes highly dense mathematical data, the deletion score outweighs the addition score, and the engine permanently tags the edit intent as **"Deletion Heavy"**.
15. **Risk & Severity Flagging:** The engine calculates a normalized Risk Score (0.0 to 1.0). If the change footprint is massive compared to the original file size, it assigns a **Major Risk** severity badge.

### Step 7: True Stability Analysis
16. `stability_analyzer.py` compares the size of the semantic structures (not the raw unreadable binary zips). It returns a mathematical percentage (e.g., 0.98 for 98% stable) indicating how much the core integrity of the document fluctuated.

### Step 8: Dynamic Summarization
17. The engine dynamically builds a highly descriptive, human-readable summary. If one sheet was affected, it extracts the exact name (e.g., `Sheet 'Q3 Financials' modified (50 cells changed)`). If massive changes occurred, it aggregates them (e.g., `1 sheet added, 2 sheets modified (150 cells changed)`).

### Step 9: Atomic Storage (The 3-Part Snapshot)
18. `snapshot_manager.py` generates a collision-proof UTC timestamp ID. It saves THREE distinct files into the `<file_hash>` folder:
    - **`<timestamp>.json`**: The Metadata (Summary, Risk Score, Stability, Intent, and exact Diff Payload).
    - **`<timestamp>.structure.json`**: The raw extracted structural grid so the parser doesn't have to extract the binary next time.
    - **`<timestamp>.<ext>`**: The actual physical backup of the user's file.

### Step 10: The Ultimate Safety Net (Rollback Backup)
19. If the user ever clicks "Restore" in the UI to go back in time, `rollback_manager.py` intervenes.
20. **Integrity Check:** It checks the SHA-256 hash of the old snapshot to ensure the file hasn't corrupted over time.
21. **The Safety Clone:** Right before overwriting the user's live active file, it physically copies their current unsaved work into a new file named `filename.ext.backup` directly in their local folder. This guarantees 0% data loss if they accidentally trigger a restore.

### Step 11: Real-Time UI Sync
22. The Python backend streams the success payload back to Node.js. The Electron UI dynamically updates the visual timeline, immediately displaying the exact cell count, the custom sheet name, the Red/Green Risk Badges, and the human-readable summary!

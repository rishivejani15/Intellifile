# The IntelliFile Version Control Algorithm: Step-by-Step

Here is the exact lifecycle of how your custom version control algorithm works right now, from the moment a file is edited to the moment it is safely backed up with AI analysis.

### Step 1: File Modification Trigger
1. A file is edited. The `VersionEngine` (in `version_engine.py`) is invoked with three main arguments: `file_path`, `old_content`, and `new_content`.

### Step 2: Hashing & Identification
2. **Path Normalization:** The absolute path of the file is normalized.
3. **SHA-256 Hashing:** The normalized path is hashed using SHA-256 (`generate_sha256`).
4. **Storage Grouping:** This unique hash acts as the master folder ID for this specific file. All future versions and backups of this file will be grouped under `backend/data/storage/versions/<file_hash>/`.

### Step 3: Format Detection & Parsing
5. **Detection:** The engine checks the file extension to classify it into one of four categories: `text`, `word` (.docx), `excel` (.xlsx), or `binary`.
6. **Previous State Retrieval:** For complex formats (Word/Excel), the engine checks the storage folder to see if it already has the previous version's structural data saved as an existing `.structure.json` file.
7. **Document Parsing:** The raw binary of the *new* file is cracked open by `word_parser.py` or `excel_parser.py` and converted into a readable JSON structure (extracting paragraphs, headings, worksheets, and cell coordinates).

### Step 4: Granular Diffing (Finding what changed)
8. The engine routes the old and new data to a specific diff engine:
   - **Word (`word_diff_engine.py`):** Uses mathematical sequence matching (`difflib.SequenceMatcher`) to compare the array of old paragraphs against the new paragraphs. It tags exact chunks as `added`, `removed`, `replaced`, or `equal`.
   - **Excel (`excel_diff_engine.py`):** Iterates through worksheets and individual grid coordinates, logging exactly which cells were `added`, `modified` (with Old Value vs New Value), or `deleted`.
   - **Text (`text_diff_engine.py`):** Generates a standard developer-style hunk diff.

### Step 5: Information Weighted Semantic Diff (IWSD) & Risk Analysis
9. The diff payload and the textual representations are sent to the `risk_analyzer.py`. This algorithm mathematically calculates how "dangerous" or "important" the change was.
10. **Shannon Entropy & Importance:** For every single changed line, it calculates an "Importance Score" based on **Shannon Entropy** (how mathematically random/dense the information is), token count, and special symbol count. Code and complex sentences score higher than simple spaces or common words.
11. **Score Aggregation:** It aggregates an `add_score`, `delete_score`, and `modify_score`.
12. **Intent Detection:** If the `delete_score` is strictly greater than the `add_score`, it labels the intent as **"Deletion Heavy"**. Otherwise, it labels it as **"Addition/Modification"**.
13. **Risk Scoring:** It calculates a normalized **Risk Score** (0.0 to 1.0) by dividing the destructive changes (`delete_score`) by the total amount of changes. If a user deletes highly dense information, the risk score spikes.
14. **Severity Classifying:** Based on the total volume of changes relative to the file size, it tags the edit as **Minor**, **Moderate**, or **Major**.

### Step 6: Stability Analysis
15. `stability_analyzer.py` compares the raw file sizes. It calculates a percentage (0.0 to 1.0) of how much the structural footprint fluctuated. A stability of 1.0 means the file size barely changed, indicating structural integrity.

### Step 7: Snapshot Generation & Storage (Backup)
### Step 7: Snapshot Generation & Storage (Backup)
16. **Version ID Generation:** `snapshot_manager.py` generates a highly unique, collision-proof version ID using the exact UTC microsecond timestamp and a random 4-character suffix (e.g., `20260430164500123_x1yz`).
17. **3-Part Backup System:** Inside the secure `backend/data/storage/versions/<file_hash>/` folder, the system saves three distinct files for every single edit:
    - **The Physical Backup:** A hard copy of the raw binary (the actual `.docx`, `.xlsx`, or `.txt`) is saved as `<version_id>.<ext>`. *(Note: The code contains logic to eventually support "Delta/Diff Storage" where it only saves a full backup every 3 edits, but currently defaults to a full physical snapshot every time to ensure zero data loss).*
    - **The Structure Backup:** For Word/Excel, the raw JSON structure that was parsed in Step 3 is saved as `<version_id>.structure.json` so the algorithm doesn't have to re-parse the heavy binary next time.
    - **The Metadata Backup:** All calculated statistics (Risk Score, Intent, Severity, Stability Score, and the exact Diff Payload) are saved in a final `<version_id>.json` metadata file.
18. **Version Indexing:** The engine updates a master index file at `backend/data/storage/version_index/<file_hash>.json`. This index acts as a fast-query database so the system can instantly list all versions for the frontend without having to scan the physical storage directories.

### Step 8: Frontend Visuals (The UI)
20. When the user clicks on a file in IntelliFile, the frontend fetches the list of JSON metadata files. 
21. It visualizes the history timeline, attaching a red **Risk Badge** if the Risk Score is high or the intent was Deletion Heavy.
22. When expanding a version, `VersionDiffViewer.js` reads the diff payload and visually draws the red/green text blocks or the spreadsheet old/new tables for the user to review.

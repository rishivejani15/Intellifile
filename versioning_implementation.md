# File Versioning Implementation Theory

Based on the codebase analysis, the file versioning feature is implemented as a comprehensive version control system that handles both plain text and structured documents (Word and Excel). Here is the theory behind what has been implemented and how it works.

## 1. Storage and Snapshot Management (Backend)
**Location:** [backend/core/versioning/snapshot_manager.py](file:///c:/Users/meet1/OneDrive/Desktop/Intellifile/backend/core/versioning/snapshot_manager.py)

The core of the versioning system is the Snapshot Manager, which is responsible for safely storing file versions and their metadata.

- **File Identification:** When a file is versioned, its absolute path is normalized and hashed using SHA-256. This hash acts as a unique folder identifier to group all versions of that file together in `backend/data/storage/versions/<hash>`.
- **Versioning Strategy:** Each snapshot is saved with a unique ID based on a high-precision UTC timestamp and a random suffix (e.g., `20260315022705123456_abcd`).
- **Data Storage:**
  - **Binary Files (.docx, .xlsx, .pdf, .zip):** The raw file is copied to the storage directory.
  - **Text Files:** Standardized to `\n` line endings and saved.
  - **Metadata:** A `{timestamp}.json` file is saved alongside the snapshot containing things like file hash, summary, intent, semantic versioning info, risk level, and stability score.
  - **Structured Data:** For Word and Excel documents, structural data (paragraphs, headings, cell data) is saved separately as `{timestamp}.structure.json`.

## 2. Granular Diff Engines (Backend)
Instead of relying purely on standard line-by-line diffs, the system implements specific logic depending on the file format.

### Word Documents
**Location:** [backend/core/versioning/word_diff_engine.py](file:///c:/Users/meet1/OneDrive/Desktop/Intellifile/backend/core/versioning/word_diff_engine.py)
- Uses Python's `difflib.SequenceMatcher` to compare the paragraphs of the old and new Word document versions.
- It detects chunks that are `equal`, `replace`, `delete`, or `insert` to accurately identify what blocks of text changed.
- It also does a simple set difference on document headings and counts the delta in the number of tables.

### Excel Spreadsheets
**Location:** [backend/core/versioning/excel_diff_engine.py](file:///c:/Users/meet1/OneDrive/Desktop/Intellifile/backend/core/versioning/excel_diff_engine.py)
- Compares the internal structure of spreadsheets, sheet by sheet, checking individual cell coordinates.
- It calculates:
  - Added and removed sheets.
  - Added, deleted, and modified cells (tracking old vs new values).
  - The number of changed cell formulas.

### Text/Code Files
- Uses a standard text diff engine that produces hunk-based git-style diffs.

## 3. Visual Presentation (Frontend)
**Location:** [frontend/src/components/Versioning/VersionDiffViewer.js](file:///c:/Users/meet1/OneDrive/Desktop/Intellifile/frontend/src/components/Versioning/VersionDiffViewer.js)

The frontend consumes the diff payload from the backend and renders it visually based on whether the diff `is_structured`.

- **Word Diffs:** Renders statistics at the top (e.g., `+5 Added`, `-2 Removed`, `3 New Headings`). Then it presents a document flow showing the paragraphs, applying specific CSS classes to highlight added (green) or removed (red) text.
- **Excel Diffs:** Displays statistics on cell modifications and formula changes, followed by an intuitive table that lists out the changes row by row: `[Sheet | Cell | Old Value | New Value]`. It also highlights warnings for deleted sheets.
- **Standard Text Diffs:** Uses the `react-diff-view` library to provide a split-pane, syntax-highlighted code diff view, similar to GitHub pull requests.

## Summary
In essence, you have built an **intelligent version control system** tailored for office documents. It goes beyond treating `.docx` or [.xlsx](file:///c:/Users/meet1/OneDrive/Desktop/Intellifile/test_new.xlsx) as binary blobs by cracking them open, comparing their internal semantic structures (paragraphs, headings, worksheets, cells), and presenting those exact differences visually to the user in a highly readable format.

## 4. The Version Engine (Orchestrator)
**Location:** `backend/core/versioning/version_engine.py`

The `VersionEngine` serves as the central orchestrator for the entire versioning process whenever a file is modified.
- **Format Detection:** It automatically determines if a file is plain text, Word (`.docx`), Excel (`.xlsx`), or binary.
- **Diff Routing:** It routes the old and new file contents to the appropriate granular diff engine (Text, Word, or Excel).
- **Metadata Generation:** It coordinates the generation of the diff, and then passes the textual or structural representations to the Semantic Risk Analyzer to determine the impact of the changes.

## 5. Information Weighted Semantic Diff (IWSD) & Risk Analysis
**Location:** `backend/core/versioning/risk_analyzer.py`

Instead of relying purely on large language models for every commit, the system implements a proprietary, mathematically-driven algorithm called **IWSD v2 (Information Weighted Semantic Diff)**. This algorithm evaluates the mathematical "importance" of the changes made to a file.

- **Shannon Entropy & Token Importance:** For every added, modified, or deleted line, the algorithm calculates a mathematical "importance" score. This score is derived from:
  - **Shannon Entropy:** Measures the randomness and information density of the text.
  - **Token & Symbol Counts:** Heavily weighted towards complex symbols and token density (e.g., code or complex formulas score higher than plain prose).
  - **Relative Length:** The length of the changed line relative to the file's average line length.
- **Aggregated Scoring:** It computes discrete scores for additions (`add_score`), deletions (`delete_score`), modifications (`modify_score`), block changes (`block_score`), and overall structural similarity (`weighted_similarity`).
- **Severity Classification:** Based on the total accumulated `change_score` relative to the file's total size, it classifies the version's severity as **Minor**, **Moderate**, or **Major**.
- **Intent & Risk Detection:** 
  - **Intent:** It detects if a change is "Deletion Heavy" or an "Addition/Modification".
  - **Risk Score:** It calculates a normalized risk score (between 0.0 and 1.0) by analyzing the ratio of destructive changes (`delete_score`) against the total `change_score`. High deletions of dense information result in higher risk scores.

## 6. Stability Analysis
**Location:** `backend/core/versioning/stability_analyzer.py`

A lightweight metric that calculates a percentage-based stability score (0.0 to 1.0) evaluating how stable the file's overall footprint remains after the modification. It essentially measures the pure delta in file size. A score of 1.0 means the file size didn't fluctuate wildly, implying the file is structurally stable.

## Conclusion
Your custom algorithm is a hybrid approach. It uses deterministic, mathematically sound algorithms (Shannon Entropy, Sequence Matching, Structural Parsing) to analyze the weight and risk of changes, avoiding the latency and unreliability of purely AI-generated diffs. It uniquely understands the internal components of office documents and quantifies the "information value" of what was added or lost during an edit.
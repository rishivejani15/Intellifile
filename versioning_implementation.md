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

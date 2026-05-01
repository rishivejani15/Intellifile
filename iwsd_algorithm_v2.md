# Information Weighted Semantic Diff (IWSD) Algorithm v2.0

The IWSD algorithm is a proprietary mathematical risk engine designed for IntelliFile. Unlike standard Git-based algorithms that only count *how many* lines changed, IWSD calculates *how important* the changed data was using Shannon Entropy, Asymmetric Information Loss heuristics, and Format-Specific Dependency shields.

---

### Step 1: Base Importance Calculation
Before scoring, the engine calculates the "Density" of each line using `calculate_importance()`.

1. **Token & Symbol Scoring:** Measures word count and non-alphanumeric character frequency.
2. **Shannon Entropy:** A logarithmic measurement of character unpredictability (Code vs. Prose).
3. **🛡️ The "Base64 Illusion" Shield:**
   - Detects long, dense strings with no spaces (Encoded Blobs/Images).
   - **Penalty:** Reduces importance by **90%**.
   - **Why:** Prevents "Major Risk" false alarms when a user pastes an icon or image into a file.

---

### Step 2: Format-Specific Forensic Boosters
The algorithm adjusts its sensitivity based on the file type:

1. **📊 Excel Ripple Effect:**
   - Detects cells containing formulas (starting with `=`).
   - **Multiplier:** **5.0x Weight Boost.**
   - **Why:** Changing one formula can shift thousands of results across a sheet.
2. **🛡️ Macro-Sentry Detection:**
   - Detects hidden `vbaProject.bin` files in Office docs.
   - **Action:** Triggers a **(MACRO-ENABLED)** badge in the UI regardless of text changes.

---

### Step 3: The Scoring Engines (Asymmetric Information Loss)

#### A. The Addition Engine (Standard Risk)
- Standard **1.0x Weight Multiplier**. 
- Adding data is treated as an information upgrade.

#### B. The Modification Engine (Downgrade Penalty)
- **Information Downgrade:** If `Old Line Importance > New Line Importance`.
  - **Penalty:** Applies a **2.0x Risk Penalty** to the exact mathematical delta that was lost.
- **Information Upgrade:** If `New > Old`.
  - **Multiplier:** Standard 1.0x.

#### C. The Deletion Engine (The Core Forensic Shield)
Destroying data is strictly riskier than adding data. The engine applies an **Asymmetric Penalty**:
- **Sensitive Data Destruction:** If keywords like "api_key", "password", or patterns (Credit Cards/SSNs) are detected.
  - **Penalty:** **10.0x Massive Multiplier.**
- **Information Loss Scaling:**
  - Entropy > 3.5 (Complex Code/Math): **3.0x Multiplier.**
  - Entropy > 2.0 (Sentences): **2.5x Multiplier.**
  - Entropy < 2.0 (Basic Data): **2.0x Multiplier.**

---

### Step 4: Storage Lifecycle (Lego-Block Deduplication)
Once the risk is calculated, the **Storage Engine** manages the data footprint:
1. **The Chop Shop:** Binary files (.docx, .xlsx) are split into **512KB Chunks**.
2. **Deduplication:** Only unique chunks are saved to the "Vault." 
3. **The Recipe:** New versions only store a list of chunk IDs (The Recipe), making a 100MB edit cost only **~1MB** of real disk space.

---

### Step 5: Retention & Hygiene (The Broom)
The engine maintains its own health through an automated retention policy:
1. **🛡️ 7-Day Safety Net:** Keeps 100% of versions for the first 7 days (Zero Deletion).
2. **📉 30-Day Thinning:** Keeps only 1 version per day for versions older than 30 days.
3. **🧹 Startup Purge:** Automatically wipes the transient `cache/` folder every time the app starts to reclaim junk space.
4. **♻️ Chunk Scavenger:** When a version is deleted, the engine scans the Lego-Blocks. Any blocks that are no longer needed are permanently incinerated to reclaim disk space.

---

### Step 6: Intent & Severity Tagging
1. **Intent Extraction:**
   - If 10.0x alarm tripped -> **"Sensitive Data Deletion"**
   - Else if `delete_score > add_score` -> **"Deletion Heavy"**
   - Else -> **"Addition/Modification"**
2. **Severity Aggregation:**
   - Compares `change_score` against `total_lines * 20`.
   - **Major Risk:** Disproportionate information loss detected (Triggers Red Badge).

---

## Real-World Example: Excel Data Sheet
**Edit:** A user deletes a complex formula `=VLOOKUP(A1, B2:Z100, 5, FALSE)` and replaces it with the static number `100`.

1. **Excel Booster:** Sees the `=` sign. Boosts base importance by **5.0x**.
2. **Modification Engine:** Sees the replacement. Compares the high-entropy formula to the low-entropy static number.
3. **Penalty:** Triggers the **2.0x Information Downgrade Penalty**.
4. **Result:** Triggers a **"Major Risk"** warning because critical logic was lost.
5. **Storage:** The edit is saved as a 1KB JSON "Recipe" instead of a 10MB Word file.

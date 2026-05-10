from utils.file_hash import generate_sha256
from datetime import datetime, timezone
import os
import json
from core.versioning.snapshot_manager import list_versions
from core.paths import get_storage_dir

class VersionEngine:
    def __init__(self):
        self._ai = None

    @property
    def ai(self):
        if self._ai is None:
            try:
                from ai.ai_factory import get_ai_provider
                self._ai = get_ai_provider()
            except Exception:
                class MockAI:
                    def analyze_semantics(self, *args): return {}
                    def summarize(self, *args): return "Update detected."
                    def classify_intent(self, *args): return "Edit"
                self._ai = MockAI()
        return self._ai

    def detect_format(self, file_path):
        ext = os.path.splitext(file_path)[1].lower()
        
        TEXT_EXTENSIONS = {
            ".txt", ".md", ".json", ".csv", ".py", ".js", ".jsx", ".ts", ".tsx", 
            ".html", ".htm", ".css", ".scss", ".less", ".java", ".c", ".cpp", ".h", 
            ".hpp", ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".yml", 
            ".yaml", ".xml", ".ini", ".cfg", ".conf", ".sql", ".bat", ".ps1", 
            ".log", ".env", ".gitignore", ".toml", ".vue", ".svelte"
        }
        
        if ext in TEXT_EXTENSIONS:
            return "text"
        elif ext == ".docx":
            return "word"
        elif ext == ".xlsx":
            return "excel"
        else:
            return "binary"

    def process_version(self, file_path, old_content, new_content):
        format_type = self.detect_format(file_path)
        
        from core.versioning.risk_analyzer import analyze_semantics
        from core.versioning.stability_analyzer import calculate_stability
        
        if format_type == "text":
            from core.versioning.text_diff_engine import generate_diff
            diff = generate_diff(old_content, new_content)
            
            # Use IWSD
            semantic_results = analyze_semantics(old_content, new_content, diff)
            semantic_data = semantic_results
            intent = semantic_results["intent"]
            summary = self.ai.summarize(diff) # AI can still generate nice summaries or we fallback
        elif format_type == "word":
            from core.versioning.word_diff_engine import compare_word_structures
            from parsers.word_parser import extract_word_structure
            
            old_struct = extract_word_structure(old_content) if isinstance(old_content, str) else (old_content or {})
            new_struct = extract_word_structure(new_content) if isinstance(new_content, str) else (new_content or {})
            
            diff = compare_word_structures(old_struct, new_struct)
            diff["is_structured"] = True
            diff["format"] = "word"
            
            # Stringify for IWSD (must use indent to allow line-by-line diff fallback)
            old_str = json.dumps(old_struct, indent=2) if isinstance(old_struct, dict) else str(old_struct)
            new_str = json.dumps(new_struct, indent=2) if isinstance(new_struct, dict) else str(new_struct)
            
            semantic_results = analyze_semantics(old_str, new_str)
            semantic_data = semantic_results
            intent = semantic_results["intent"]
            
            added_count = len([p for p in diff.get('para_diff', []) if p.get('type') == 'added'])
            removed_count = len([p for p in diff.get('para_diff', []) if p.get('type') == 'removed'])
            modified_count = len([p for p in diff.get('para_diff', []) if p.get('type') == 'modified'])
            
            w_added = sum([p.get('words_added', 0) for p in diff.get('para_diff', [])])
            w_removed = sum([p.get('words_removed', 0) for p in diff.get('para_diff', [])])
            
            is_initial = len(list_versions(file_path)) <= 1 # If 0 or 1 (just saved), it's baseline
            
            summary_parts = []
            if added_count > 0: 
                label = "paragraph" if added_count == 1 else "paragraphs"
                summary_parts.append(f"{added_count} {label} added")
            if removed_count > 0: 
                label = "paragraph" if removed_count == 1 else "paragraphs"
                summary_parts.append(f"{removed_count} {label} removed")
            if modified_count > 0: 
                label = "paragraph" if modified_count == 1 else "paragraphs"
                summary_parts.append(f"{modified_count} {label} modified")
            
            # Show word detail ONLY if it's not the initial version
            detail = ""
            if not is_initial:
                w_added_label = "word" if w_added == 1 else "words"
                w_removed_label = "word" if w_removed == 1 else "words"
                detail_parts = []
                if w_added > 0: detail_parts.append(f"{w_added} {w_added_label} added")
                if w_removed > 0: detail_parts.append(f"{w_removed} {w_removed_label} removed")
                detail = f" ({', '.join(detail_parts)})" if detail_parts else ""
            
            summary = f"Word doc updated: {', '.join(summary_parts)}{detail}."
            
            # Shield 3: Hidden Macros Detection
            if diff.get("has_macros"):
                macro_note = " (MACRO-ENABLED)" if not diff.get("macro_changed") else " (MACROS MODIFIED/ADDED)"
                summary += macro_note
        elif format_type == "excel":
            from core.versioning.excel_diff_engine import compare_excel_structures
            from parsers.excel_parser import extract_excel_structure
            
            old_struct = extract_excel_structure(old_content) if isinstance(old_content, str) else (old_content or {})
            new_struct = extract_excel_structure(new_content) if isinstance(new_content, str) else (new_content or {})
            
            diff = compare_excel_structures(old_struct, new_struct)
            diff["is_structured"] = True
            diff["format"] = "excel"
            
            # Stringify for IWSD (must use indent to allow line-by-line diff fallback)
            old_str = json.dumps(old_struct, indent=2) if isinstance(old_struct, dict) else str(old_struct)
            new_str = json.dumps(new_struct, indent=2) if isinstance(new_struct, dict) else str(new_struct)
            
            semantic_results = analyze_semantics(old_str, new_str)
            semantic_data = semantic_results
            intent = semantic_results["intent"]
            
            added_sheets_count = len(diff.get('added_sheets', []))
            removed_sheets_count = len(diff.get('removed_sheets', []))
            affected_sheets = list(set([c['sheet'] for c in diff.get('changed_cells', [])]))
            
            summary_parts = []
            if added_sheets_count > 0:
                summary_parts.append(f"{added_sheets_count} sheet(s) added")
            if removed_sheets_count > 0:
                summary_parts.append(f"{removed_sheets_count} sheet(s) removed")
                
            modified_sheets = [s for s in affected_sheets if s not in diff.get('added_sheets', []) and s not in diff.get('removed_sheets', [])]
            if len(modified_sheets) > 0:
                summary_parts.append(f"{len(modified_sheets)} sheet(s) modified")
                
            if not summary_parts and len(affected_sheets) > 0:
                summary_parts.append(f"{len(affected_sheets)} sheet(s) modified")
                
            prefix = ", ".join(summary_parts) if summary_parts else "1 sheet modified"
            
            if len(affected_sheets) == 1 and not diff.get('added_sheets') and not diff.get('removed_sheets'):
                prefix = f"Sheet '{affected_sheets[0]}' modified"
            elif len(diff.get('added_sheets', [])) == 1 and not diff.get('removed_sheets') and len(modified_sheets) == 0:
                prefix = f"Sheet '{diff['added_sheets'][0]}' added"
            
            summary = f"{prefix} ({diff.get('changed_cells_count', 0)} cells changed)."
            
            # Shield 3: Hidden Macros Detection
            if diff.get("has_macros"):
                macro_note = " (MACRO-ENABLED)" if not diff.get("macro_changed") else " (MACROS MODIFIED/ADDED)"
                summary += macro_note
        else:
            diff = "Binary file change detected."
            semantic_data = {}
            semantic_results = {"severity": "Minor"} # Default array for later
            summary = "Binary file updated."
            intent = "Binary Update"
            new_struct = None
            old_str = ""
            new_str = ""

        risk = semantic_results.get("severity", "Low") if format_type != "binary" else "Low"
        
        # Calculate true semantic stability using the IWSD risk score
        current_risk = semantic_results.get("risk_score", 0.0)
        
        if format_type == "text":
            stability = calculate_stability(old_content, new_content, risk_score=current_risk)
        elif format_type in ["word", "excel"]:
            stability = calculate_stability(old_str, new_str, risk_score=current_risk)
        else:
            stability = 0.9

        return {
            "summary": summary,
            "intent": intent,
            "risk_level": risk,
            "stability_score": stability,
            "semantic": semantic_data,
            "diff": diff,
            "raw_structure": new_struct if format_type in ["word", "excel"] else None,
            "format": format_type
        }

    def process_and_save(self, file_path, old_content, new_content):
        format_type = self.detect_format(file_path)
        from core.versioning.snapshot_manager import save_snapshot, list_versions
        
        # Binary comparison logic: fetch previous structure if possible
        if format_type in ["word", "excel"] and (not old_content or old_content == new_content):
            versions = list_versions(file_path)
            if versions:
                last_version_id = versions[0]["version_id"]
                try:
                    abs_path = os.path.abspath(file_path)
                    norm_path = os.path.normpath(abs_path).lower()
                    fid = generate_sha256(norm_path)
                    
                    # Detect storage path
                    storage_root = os.path.join(get_storage_dir(), "versions")
                    
                    struct_path = os.path.join(storage_root, fid, f"{last_version_id}.structure.json")
                    if os.path.exists(struct_path):
                        with open(struct_path, "r", encoding="utf-8") as f:
                            old_content = json.load(f)
                    else:
                        # If structure is missing, we must use the previous binary file path
                        file_dir = os.path.join(storage_root, fid)
                        for f in os.listdir(file_dir):
                            if f.startswith(last_version_id) and not f.endswith(".json"):
                                old_content = os.path.join(file_dir, f)
                                break
                except Exception:
                    pass

        result = self.process_version(file_path, old_content, new_content)

        metadata = {
            "summary": result["summary"],
            "intent": result["intent"],
            "risk_level": result["risk_level"],
            "stability_score": result["stability_score"],
            "semantic": result["semantic"],
            "diff": result["diff"]
        }

        if format_type in ["word", "excel"] and result.get("raw_structure"):
            metadata["structured_data"] = result["raw_structure"]

        # Detection of first version to use original timestamp for a historically accurate timeline
        custom_timestamp = None
        if not list_versions(file_path):
            try:
                # Use the oldest possible date (minimum of creation and modification)
                # This handles cases where a file was moved/copied (which resets ctime)
                ctime = os.path.getctime(file_path)
                mtime = os.path.getmtime(file_path)
                oldest_time = min(ctime, mtime)
                
                custom_timestamp = datetime.fromtimestamp(oldest_time, timezone.utc).strftime("%Y%m%d%H%M%S%f")
            except Exception:
                pass

        version_id = save_snapshot(file_path, new_content, metadata, custom_timestamp=custom_timestamp)
        metadata["version_id"] = version_id
        return metadata
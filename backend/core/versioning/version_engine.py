from utils.file_hash import generate_sha256
from datetime import datetime, timezone
import os
import json

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
        if ext in [".txt", ".py", ".js", ".json", ".md", ".html", ".css"]:
            return "text"
        elif ext == ".docx":
            return "word"
        elif ext == ".xlsx":
            return "excel"
        else:
            return "binary"

    def process_version(self, file_path, old_content, new_content):
        format_type = self.detect_format(file_path)
        
        from core.versioning.risk_analyzer import calculate_risk
        from core.versioning.stability_analyzer import calculate_stability
        
        if format_type == "text":
            from core.versioning.text_diff_engine import generate_diff
            diff = generate_diff(old_content, new_content)
            semantic_data = self.ai.analyze_semantics(old_content, new_content)
            summary = self.ai.summarize(diff)
            intent = self.ai.classify_intent(diff)
        elif format_type == "word":
            from core.versioning.word_diff_engine import compare_word_structures
            from parsers.word_parser import extract_word_structure
            
            # Paths are passed for binary files
            old_struct = extract_word_structure(old_content) if isinstance(old_content, str) else old_content
            new_struct = extract_word_structure(new_content) if isinstance(new_content, str) else new_content
            
            diff = compare_word_structures(old_struct, new_struct)
            diff["is_structured"] = True
            diff["format"] = "word"
            
            p_len = len(new_struct.get("paragraphs", [])) if isinstance(new_struct, dict) else 0
            h_len = len(new_struct.get("headings", [])) if isinstance(new_struct, dict) else 0
            semantic_data = {"paragraphs": p_len, "headings": h_len}
            
            added_count = len([p for p in diff.get('para_diff', []) if p.get('type') == 'added'])
            removed_count = len([p for p in diff.get('para_diff', []) if p.get('type') == 'removed'])
            summary = f"Word doc updated: {added_count} added, {removed_count} removed paragraphs."
            intent = "Document Edit"
        elif format_type == "excel":
            from core.versioning.excel_diff_engine import compare_excel_structures
            from parsers.excel_parser import extract_excel_structure
            
            old_struct = extract_excel_structure(old_content) if isinstance(old_content, str) else old_content
            new_struct = extract_excel_structure(new_content) if isinstance(new_content, str) else new_content
            
            diff = compare_excel_structures(old_struct, new_struct)
            diff["is_structured"] = True
            diff["format"] = "excel"
            
            semantic_data = {"sheets": list(new_struct.keys()) if isinstance(new_struct, dict) else [], "cell_count": diff.get("changed_cells_count", 0)}
            summary = f"Excel sheet updated: {diff.get('changed_cells_count', 0)} cells changed."
            intent = "Data Update"
        else:
            diff = "Binary file change detected."
            semantic_data = {}
            summary = "Binary file updated."
            intent = "Binary Update"

        risk = calculate_risk(diff, semantic_data, format_type)
        stability = calculate_stability(old_content, new_content) if format_type == "text" else 0.9

        return {
            "summary": summary,
            "intent": intent,
            "risk_level": risk,
            "stability_score": stability,
            "semantic": semantic_data,
            "diff": diff,
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
                    PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
                    storage_root = os.path.join(PROJECT_ROOT, "backend", "data", "storage", "versions")
                    
                    struct_path = os.path.join(storage_root, fid, f"{last_version_id}.structure.json")
                    if os.path.exists(struct_path):
                        with open(struct_path, "r", encoding="utf-8") as f:
                            old_content = json.load(f)
                    else:
                        # If structure is missing, we must use the previous binary file path
                        # We can find it by checking common extensions or looking for the biggest file starting with ID
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
            "semantic": result["semantic"]
        }

        if format_type in ["word", "excel"]:
            metadata["structured_data"] = result["diff"]

        version_id = save_snapshot(file_path, new_content, metadata)
        metadata["version_id"] = version_id
        return metadata
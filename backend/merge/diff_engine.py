"""
Diff engine for semantic merge assistant.
Extracts changes and identifies merge conflicts.
"""

import difflib
from typing import List, Dict, Tuple, Optional


class Change:
    """Represents a single change (insertion, deletion, or modification)"""
    
    def __init__(self, op: str, line_num: int, old_content: str = "", new_content: str = ""):
        self.op = op  # 'insert', 'delete', 'modify'
        self.line_num = line_num
        self.old_content = old_content
        self.new_content = new_content
    
    def to_dict(self):
        return {
            'op': self.op,
            'line_num': self.line_num,
            'old_content': self.old_content,
            'new_content': self.new_content
        }


class DiffEngine:
    """Diff and merge engine"""
    
    @staticmethod
    def get_diff(base: str, current: str) -> List[Dict]:
        """
        Get changes between base and current version.
        
        Args:
            base: Base version
            current: Current version
            
        Returns:
            List of changes
        """
        base_lines = base.splitlines(keepends=False)
        current_lines = current.splitlines(keepends=False)
        
        changes = []
        differ = difflib.Differ()
        diff_lines = list(differ.compare(base_lines, current_lines))
        
        base_idx = 0
        for line in diff_lines:
            if line.startswith('- '):
                changes.append({
                    'op': 'delete',
                    'line_num': base_idx,
                    'content': line[2:]
                })
                base_idx += 1
            elif line.startswith('+ '):
                changes.append({
                    'op': 'insert',
                    'line_num': base_idx,
                    'content': line[2:]
                })
            elif line.startswith('  '):
                base_idx += 1
        
        return changes
    
    @staticmethod
    def detect_conflicts(base: str, ours: str, theirs: str) -> List[Dict]:
        """
        Detect merge conflicts in three-way merge.
        
        Args:
            base: Base version
            ours: Our version
            theirs: Their version
            
        Returns:
            List of conflicts with context
        """
        our_changes = DiffEngine.get_diff(base, ours)
        their_changes = DiffEngine.get_diff(base, theirs)
        
        conflicts = []
        
        # Find overlapping changes (conflicts)
        for our_change in our_changes:
            for their_change in their_changes:
                # Check if changes overlap
                if our_change['line_num'] == their_change['line_num'] and our_change['op'] != their_change['op']:
                    conflicts.append({
                        'line_num': our_change['line_num'],
                        'our_change': our_change,
                        'their_change': their_change
                    })
        
        return conflicts
    
    @staticmethod
    def format_unified_diff(base: str, modified: str, filename: str = "file") -> str:
        """
        Format diff in unified diff format.
        """
        base_lines = base.splitlines(keepends=True)
        mod_lines = modified.splitlines(keepends=True)
        
        diff = difflib.unified_diff(
            base_lines, mod_lines,
            fromfile=f"{filename} (base)",
            tofile=f"{filename} (modified)"
        )
        
        return ''.join(diff)

"""
Summarizer for generating concise merge suggestions.
Uses simple seq2seq-like logic for summarization.
"""

from typing import List, Dict, Optional
import re


class Summarizer:
    """Generates summaries of code changes"""
    
    KEYWORDS = {
        'function': r'\bdef\b|\bfunction\b',
        'class': r'\bclass\b',
        'variable': r'\b\w+\s*=',
        'loop': r'\bfor\b|\bwhile\b',
        'conditional': r'\bif\b|\belse\b|\belif\b',
        'return': r'\breturn\b',
        'import': r'\bimport\b|\bfrom\b'
    }
    
    @staticmethod
    def identify_change_type(change: str) -> str:
        """Identify type of change"""
        for change_type, pattern in Summarizer.KEYWORDS.items():
            if re.search(pattern, change):
                return change_type
        return 'generic'
    
    @staticmethod
    def summarize_change(change: Dict) -> str:
        """
        Generate a summary for a single change.
        
        Args:
            change: Change dictionary
            
        Returns:
            Summary string
        """
        op = change.get('op', 'unknown')
        content = change.get('content', '')[:100]  # First 100 chars
        change_type = Summarizer.identify_change_type(content)
        
        summaries = {
            'insert': f"Added {change_type}: {content.strip()}",
            'delete': f"Removed {change_type}: {content.strip()}",
            'modify': f"Modified {change_type}: {content.strip()}"
        }
        
        return summaries.get(op, f"Changed: {content.strip()}")
    
    @staticmethod
    def summarize_changes(changes: List[Dict]) -> str:
        """
        Generate a summary for a list of changes.
        
        Args:
            changes: List of changes
            
        Returns:
            Summary string
        """
        if not changes:
            return "No changes"
        
        by_type = {}
        for change in changes:
            op = change.get('op', 'unknown')
            by_type[op] = by_type.get(op, 0) + 1
        
        parts = []
        for op, count in by_type.items():
            parts.append(f"{count} {op}")
        
        return f"Total changes: {', '.join(parts)}"
    
    @staticmethod
    def generate_merge_summary(base: str, ours: str, theirs: str) -> Dict[str, str]:
        """
        Generate a summary of what will happen if we merge.
        
        Args:
            base: Base version
            ours: Our version
            theirs: Their version
            
        Returns:
            Dictionary with summaries
        """
        from .diff_engine import DiffEngine
        
        our_changes = DiffEngine.get_diff(base, ours)
        their_changes = DiffEngine.get_diff(base, theirs)
        
        return {
            'our_summary': Summarizer.summarize_changes(our_changes),
            'their_summary': Summarizer.summarize_changes(their_changes),
            'our_changes_count': len(our_changes),
            'their_changes_count': len(their_changes)
        }

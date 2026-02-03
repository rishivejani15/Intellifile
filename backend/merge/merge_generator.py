"""
Merge strategies and suggestion generator.
"""

from typing import List, Dict, Optional
from .diff_engine import DiffEngine
from .reranker import Reranker
from .summarizer import Summarizer


class MergeStrategy:
    """Different merge strategies"""
    
    @staticmethod
    def ours_strategy(base: str, ours: str, theirs: str) -> str:
        """Keep our version"""
        return ours
    
    @staticmethod
    def theirs_strategy(base: str, ours: str, theirs: str) -> str:
        """Keep their version"""
        return theirs
    
    @staticmethod
    def auto_merge_strategy(base: str, ours: str, theirs: str) -> str:
        """Automatic merge without conflicts"""
        import difflib
        differ = difflib.Differ()
        
        base_lines = base.splitlines(keepends=True)
        our_lines = ours.splitlines(keepends=True)
        their_lines = theirs.splitlines(keepends=True)
        
        # Use 3-way merge from difflib
        from difflib import SequenceMatcher
        
        # Simple 3-way merge: try to merge non-conflicting changes
        merged_lines = []
        base_len = len(base_lines)
        our_len = len(our_lines)
        their_len = len(their_lines)
        
        # This is a simplified version - in production, use proper 3-way merge
        # For now, prefer ours if it differs from base, otherwise use theirs
        for i in range(max(base_len, our_len, their_len)):
            base_line = base_lines[i] if i < base_len else ''
            our_line = our_lines[i] if i < our_len else ''
            their_line = their_lines[i] if i < their_len else ''
            
            if our_line == their_line:
                merged_lines.append(our_line)
            elif our_line == base_line:
                merged_lines.append(their_line)
            elif their_line == base_line:
                merged_lines.append(our_line)
            elif our_line:
                merged_lines.append(our_line)
        
        return ''.join(merged_lines)


class MergeGenerator:
    """Generate merge suggestions"""
    
    def __init__(self):
        self.reranker = Reranker()
        self.summarizer = Summarizer()
    
    def generate_suggestions(self, base: str, ours: str, theirs: str) -> List[Dict]:
        """
        Generate merge suggestions.
        
        Args:
            base: Base version
            ours: Our version
            theirs: Their version
            
        Returns:
            List of merge suggestions with scores
        """
        suggestions = []
        
        # Strategy 1: Keep ours
        suggestions.append({
            'strategy': 'keep_ours',
            'name': 'Keep Our Version',
            'merged_code': ours,
            'description': 'Accept all our changes, discard theirs',
            'changes_count': len(DiffEngine.get_diff(base, ours)),
            'relevance_score': 0.3,
            'source': 'ours'
        })
        
        # Strategy 2: Keep theirs
        suggestions.append({
            'strategy': 'keep_theirs',
            'name': 'Keep Their Version',
            'merged_code': theirs,
            'description': 'Accept all their changes, discard ours',
            'changes_count': len(DiffEngine.get_diff(base, theirs)),
            'relevance_score': 0.3,
            'source': 'theirs'
        })
        
        # Strategy 3: Auto merge
        try:
            auto_merged = MergeStrategy.auto_merge_strategy(base, ours, theirs)
            conflicts = DiffEngine.detect_conflicts(base, ours, theirs)
            relevance = 0.9 if not conflicts else 0.5
            
            suggestions.append({
                'strategy': 'auto_merge',
                'name': 'Auto Merge',
                'merged_code': auto_merged,
                'description': 'Automatically merge non-conflicting changes',
                'conflicts': len(conflicts),
                'relevance_score': relevance,
                'source': 'auto'
            })
        except:
            pass
        
        # Rerank suggestions
        suggestions = self.reranker.rerank(suggestions)
        
        # Add summaries
        summary_data = self.summarizer.generate_merge_summary(base, ours, theirs)
        for suggestion in suggestions:
            suggestion['summary'] = suggestion['name']
        
        return suggestions

"""
Reranker for sorting and ranking merge suggestions by relevance.
"""

from typing import List, Dict
import math


class Reranker:
    """Reranks merge suggestions based on heuristics and relevance scores"""
    
    @staticmethod
    def calculate_relevance_score(change: Dict) -> float:
        """
        Calculate relevance score for a change.
        Considers: size, scope, semantic importance.
        """
        score = 0.0
        
        # Size factor: smaller changes are often less risky
        content_len = len(change.get('content', ''))
        size_factor = 1.0 / (1.0 + math.log(content_len + 1))
        score += size_factor * 0.3
        
        # Scope factor: isolated changes score higher
        scope = change.get('scope', 'unknown')
        scope_weights = {'isolated': 1.0, 'local': 0.7, 'global': 0.3}
        score += scope_weights.get(scope, 0.5) * 0.4
        
        # Conflict factor: non-conflicting changes score higher
        has_conflict = change.get('has_conflict', False)
        score += (0.0 if has_conflict else 1.0) * 0.3
        
        return min(score, 1.0)
    
    @staticmethod
    def rerank(suggestions: List[Dict], context: Dict = None) -> List[Dict]:
        """
        Rerank suggestions by relevance score.
        
        Args:
            suggestions: List of merge suggestions
            context: Optional context for reranking
            
        Returns:
            Reranked suggestions
        """
        for suggestion in suggestions:
            suggestion['relevance_score'] = Reranker.calculate_relevance_score(suggestion)
        
        # Sort by relevance score (descending)
        sorted_suggestions = sorted(
            suggestions,
            key=lambda x: x['relevance_score'],
            reverse=True
        )
        
        return sorted_suggestions
    
    @staticmethod
    def filter_by_confidence(suggestions: List[Dict], threshold: float = 0.5) -> List[Dict]:
        """
        Filter suggestions by confidence threshold.
        """
        return [s for s in suggestions if s.get('relevance_score', 0) >= threshold]

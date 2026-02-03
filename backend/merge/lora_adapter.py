"""
LoRA adapter for personalized merge style preferences.
Stores user preferences and adjusts suggestions accordingly.
"""

import json
import os
from typing import List, Dict, Optional


class LoRAAdapter:
    """
    Low-Rank Adaptation for personalized merge preferences.
    Learns from user choices and adjusts future suggestions.
    """
    
    def __init__(self, config_path: str = ".lora_config.json"):
        self.config_path = config_path
        self.preferences = self._load_preferences()
    
    def _load_preferences(self) -> Dict:
        """Load preferences from disk"""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r') as f:
                    return json.load(f)
            except:
                return self._default_preferences()
        return self._default_preferences()
    
    def _default_preferences(self) -> Dict:
        """Default preference structure"""
        return {
            'prefer_ours': 0.0,
            'prefer_theirs': 0.0,
            'prefer_conservative': 0.0,  # Prefer fewer changes
            'prefer_aggressive': 0.0,     # Prefer more changes
            'conflict_resolution': 'manual'  # manual, ours, theirs, hybrid
        }
    
    def save_preferences(self):
        """Save preferences to disk"""
        os.makedirs(os.path.dirname(self.config_path) or '.', exist_ok=True)
        with open(self.config_path, 'w') as f:
            json.dump(self.preferences, f, indent=2)
    
    def learn_from_choice(self, suggestion: Dict, accepted: bool = True):
        """
        Learn from user's merge choice.
        
        Args:
            suggestion: The suggestion the user chose or rejected
            accepted: Whether the suggestion was accepted
        """
        weight = 0.1 if accepted else -0.05
        
        # Update preferences based on suggestion characteristics
        if suggestion.get('source') == 'ours':
            self.preferences['prefer_ours'] += weight
        elif suggestion.get('source') == 'theirs':
            self.preferences['prefer_theirs'] += weight
        
        if len(suggestion.get('changes', [])) < 3:
            self.preferences['prefer_conservative'] += weight
        else:
            self.preferences['prefer_aggressive'] += weight
        
        self.save_preferences()
    
    def adjust_suggestion(self, suggestion: Dict) -> Dict:
        """
        Adjust suggestion score based on learned preferences.
        
        Args:
            suggestion: Suggestion to adjust
            
        Returns:
            Adjusted suggestion
        """
        base_score = suggestion.get('relevance_score', 0.5)
        
        # Apply preference adjustments
        if suggestion.get('source') == 'ours':
            base_score += self.preferences['prefer_ours'] * 0.1
        elif suggestion.get('source') == 'theirs':
            base_score += self.preferences['prefer_theirs'] * 0.1
        
        changes_count = len(suggestion.get('changes', []))
        if changes_count < 3:
            base_score += self.preferences['prefer_conservative'] * 0.05
        else:
            base_score += self.preferences['prefer_aggressive'] * 0.05
        
        suggestion['lora_adjusted_score'] = min(max(base_score, 0), 1.0)
        return suggestion
    
    def adjust_suggestions(self, suggestions: List[Dict]) -> List[Dict]:
        """
        Adjust all suggestions based on learned preferences.
        """
        adjusted = [self.adjust_suggestion(s.copy()) for s in suggestions]
        # Re-sort by adjusted score
        return sorted(adjusted, key=lambda x: x.get('lora_adjusted_score', 0), reverse=True)

"""
Main API backend for semantic merge assistant.
"""

from typing import List, Dict, Optional, Tuple
from merge.merge_generator import MergeGenerator
from merge.diff_engine import DiffEngine
from merge.lora_adapter import LoRAAdapter
from merge.summarizer import Summarizer
import json
import os


class MergeAssistant:
    """Main semantic merge assistant"""
    
    def __init__(self, config_dir: str = "."):
        self.config_dir = config_dir
        self.merge_generator = MergeGenerator()
        self.lora_adapter = LoRAAdapter(os.path.join(config_dir, '.lora_config.json'))
        self.summarizer = Summarizer()
    
    def get_diff(self, base: str, modified: str) -> Dict:
        """
        Get diff between two versions.
        
        Args:
            base: Base version
            modified: Modified version
            
        Returns:
            Diff information
        """
        changes = DiffEngine.get_diff(base, modified)
        diff_text = DiffEngine.format_unified_diff(base, modified)
        
        return {
            'changes': changes,
            'diff_text': diff_text,
            'changes_count': len(changes),
            'summary': self.summarizer.summarize_changes(changes)
        }
    
    def get_merge_suggestions(self, base: str, ours: str, theirs: str, 
                             use_lora: bool = True) -> List[Dict]:
        """
        Get merge suggestions for three versions.
        
        Args:
            base: Base version
            ours: Our version
            theirs: Their version
            use_lora: Whether to use LoRA for personalization
            
        Returns:
            List of ranked merge suggestions
        """
        # Generate suggestions
        suggestions = self.merge_generator.generate_suggestions(base, ours, theirs)
        
        # Apply LoRA if enabled
        if use_lora:
            suggestions = self.lora_adapter.adjust_suggestions(suggestions)
        
        return suggestions
    
    def apply_suggestion(self, suggestion: Dict) -> str:
        """
        Apply a suggestion.
        
        Args:
            suggestion: Suggestion to apply
            
        Returns:
            Merged code
        """
        return suggestion['merged_code']
    
    def learn_from_choice(self, suggestion: Dict, accepted: bool = True):
        """
        Learn from user's choice for LoRA adaptation.
        """
        self.lora_adapter.learn_from_choice(suggestion, accepted)
    
    def detect_conflicts(self, base: str, ours: str, theirs: str) -> List[Dict]:
        """
        Detect merge conflicts.
        """
        return DiffEngine.detect_conflicts(base, ours, theirs)

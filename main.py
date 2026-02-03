"""
Semantic Merge Assistant - Main Entry Point
"""

import os
import sys
from typing import Optional

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

from configs.config import get_config
from core.parser.ast_parser import ASTParser
from core.parser.chunker import Chunker
from core.diff.change_extractor import ChangeExtractor
from core.merge.merge_generator import MergeGenerator
from core.merge.summarizer import Summarizer
from core.merge.lora_adapter import LoRAAdapter
from core.reranker.rerank import Reranker
from core.explain.explanation_builder import ExplanationBuilder
from filesystem.local_store import LocalStore
from filesystem.file_watcher import FileWatcher
from access.permissions import PermissionManager
from access.invite_tokens import InviteTokenManager
from collaboration.crdt.crdt_engine import CRDTEngine
from collaboration.sync.peer_session import PeerSession


class SemanticMergeAssistant:
	"""Main application class"""
    
	def __init__(self, user_id: str = "default_user", storage_path: Optional[str] = None):
		"""
		Initialize the semantic merge assistant
        
		Args:
			user_id: Current user ID
			storage_path: Path for file storage
		"""
		self.user_id = user_id
		self.config = get_config()
        
		# Setup storage
		if storage_path is None:
			storage_path = self.config.get('system.base_storage_path', './storage')
		self.storage_path = storage_path
        
		# Initialize components
		self.parser = ASTParser()
		self.chunker = Chunker()
		self.change_extractor = ChangeExtractor()
		self.merge_generator = MergeGenerator()
		self.summarizer = Summarizer()
		self.reranker = Reranker()
		self.explainer = ExplanationBuilder()
        
		# LoRA adapter
		lora_path = os.path.join(storage_path, '.lora_preferences.json')
		self.lora_adapter = LoRAAdapter(lora_path) if self.config.get('merge.enable_lora') else None
        
		# Storage
		from pathlib import Path
		self.local_store = LocalStore(Path(storage_path))
        
		# Access control
		perm_path = os.path.join(storage_path, '.permissions.json')
		token_path = os.path.join(storage_path, '.tokens.json')
		self.permission_manager = PermissionManager(perm_path)
		self.token_manager = InviteTokenManager(token_path)
        
		# File watcher
		self.file_watcher = None
        
		# Collaboration
		self.crdt_engine = None
		self.peer_session = None
    
	def analyze_file(self, file_path: str) -> dict:
		"""
		Analyze a file
        
		Args:
			file_path: Path to file
            
		Returns:
			Analysis results
		"""
		# Load file
		content = self.local_store.load_file(file_path)
		if content is None:
			# Try loading from filesystem
			if os.path.exists(file_path):
				with open(file_path, 'r', encoding='utf-8') as f:
					content = f.read()
			else:
				return {'error': 'File not found'}
        
		# Parse
		ast_info = self.parser.parse(content)
        
		# Chunk
		chunks = self.chunker.chunk(content)
        
		return {
			'file_path': file_path,
			'ast_info': ast_info,
			'chunks': chunks,
			'summary': self.summarizer.summarize_code_block(content)
		}
    
	def generate_merge_suggestions(self, base: str, ours: str, theirs: str, 
								   context: dict = None) -> list:
		"""
		Generate merge suggestions
        
		Args:
			base: Base version
			ours: Our version
			theirs: Their version
			context: Additional context
            
		Returns:
			List of ranked merge suggestions
		"""
		# Generate suggestions
		suggestions = self.merge_generator.generate_merge(base, ours, theirs, context)
        
		# Apply LoRA preferences
		if self.lora_adapter:
			suggestions = self.lora_adapter.adjust_suggestion_scores(suggestions)
			suggestions = self.merge_generator.apply_lora_preferences(suggestions, self.lora_adapter)
        
		# Rerank
		suggestions = self.reranker.rerank(suggestions, context)
        
		# Add explanations
		for i, suggestion in enumerate(suggestions, 1):
			suggestion['explanation'] = self.explainer.explain_suggestion(suggestion, i)
        
		return suggestions
    
	_session_code_map = {}

	def _generate_short_code(self, length=6):
		import random
		import string
		chars = string.ascii_uppercase + string.digits
		return ''.join(random.choices(chars, k=length))

	def start_collaboration_session(self, doc_id: str, session_id: str = None) -> PeerSession:
		"""
		Start a collaboration session
		Args:
			doc_id: Document ID
			session_id: Optional session ID
		Returns:
			Peer session
		"""
		if session_id is None:
			session_id = self._generate_short_code()
		# Initialize CRDT engine
		content = self.local_store.load_file(doc_id) or ""
		self.crdt_engine = CRDTEngine(self.user_id, content)
		# Create peer session
		self.peer_session = PeerSession(session_id, self.user_id, doc_id)
		self.peer_session.start()
		# Map code to session for lookup
		self._session_code_map[session_id] = self.peer_session
		return self.peer_session
    
	def start_file_watching(self, watch_path: str = None):
		"""
		Start watching files for changes
        
		Args:
			watch_path: Path to watch (defaults to storage path)
		"""
		if watch_path is None:
			watch_path = self.storage_path
        
		patterns = self.config.get('file_watcher.patterns', ['*'])
		self.file_watcher = FileWatcher(watch_path, patterns)
        
		# Set callbacks
		self.file_watcher.on_file_modified = self._on_file_modified
		self.file_watcher.on_file_created = self._on_file_created
        
		self.file_watcher.start()
    
	def _on_file_modified(self, file_path: str):
		"""Handle file modification"""
		print(f"File modified: {file_path}")
		# Could trigger auto-sync here
    
	def _on_file_created(self, file_path: str):
		"""Handle file creation"""
		print(f"File created: {file_path}")
    
	def create_invite_link(self, file_id: str, permission_level: str = "viewer",
						  expires_in_hours: float = 24) -> str:
		"""
		Create invite link for file sharing
        
		Args:
			file_id: File ID
			permission_level: Permission level to grant
			expires_in_hours: Hours until expiration
            
		Returns:
			Invite token
		"""
		token = self.token_manager.create_token(
			file_id=file_id,
			created_by=self.user_id,
			permission_level=permission_level,
			expires_in_hours=expires_in_hours
		)
        
		return token.token
    
	def accept_invite(self, invite_token: str):
		"""
		Accept an invite and join a session. Returns file info dict if successful.
		"""
		import mimetypes
		if hasattr(self, '_session_code_map') and invite_token in self._session_code_map:
			self._active_session = self._session_code_map[invite_token]
			doc_id = self._active_session.doc_id if hasattr(self._active_session, 'doc_id') else None
			if doc_id:
				file_path = os.path.join(self.storage_path, doc_id)
				file_type, _ = mimetypes.guess_type(file_path)
				if not file_type:
					file_type = 'application/octet-stream'
				return {'file_path': file_path, 'file_type': file_type}
			return None
		return None


def main():
	"""Main entry point"""
	print("Semantic Merge Assistant v1.0.0")
	print("=" * 50)
    
	# Initialize application
	app = SemanticMergeAssistant()
    
	# Example usage
	print("\nApplication initialized successfully!")
	print(f"Storage path: {app.storage_path}")
	print("\nTo start the UI, run: streamlit run ui/app.py")
	print("To use the CLI, run: python cli/merge_cli.py --help")


if __name__ == "__main__":
	main()


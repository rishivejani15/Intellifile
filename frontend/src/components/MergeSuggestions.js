import React from 'react';
import './MergeSuggestions.css';

function MergeSuggestions({ suggestions, onSelect, selected }) {
  return (
    <div className="suggestions">
      <h2>Merge Suggestions</h2>
      <div className="suggestions-list">
        {suggestions.map((suggestion, idx) => (
          <div 
            key={idx}
            className={`suggestion-card ${selected?.strategy === suggestion.strategy ? 'selected' : ''}`}
            onClick={() => onSelect(suggestion)}
          >
            <div className="suggestion-header">
              <h3>{suggestion.name}</h3>
              <span className="score">Score: {(suggestion.lora_adjusted_score || suggestion.relevance_score).toFixed(2)}</span>
            </div>
            <p className="description">{suggestion.description}</p>
            <div className="suggestion-meta">
              {suggestion.changes_count && <span>Changes: {suggestion.changes_count}</span>}
              {suggestion.conflicts && <span>Conflicts: {suggestion.conflicts}</span>}
            </div>
            <button className="select-btn">
              {selected?.strategy === suggestion.strategy ? '✓ Selected' : 'Select'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MergeSuggestions;

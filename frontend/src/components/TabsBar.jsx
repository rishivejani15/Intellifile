import React from 'react';
import './FileExplorer/FileExplorer.css';

function TabsBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }) {
  return (
    <div className="tabs-bar">
      <div className="tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSelectTab(tab)}
          >
            <span className="tab-title">{tab.title}</span>
            {tabs.length > 1 && (
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="tab-add" onClick={onNewTab} title="New tab">+</button>
    </div>
  );
}

export default TabsBar;

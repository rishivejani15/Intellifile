import "../styles/sidebar.css";

const NAV_ITEMS = [
  "Dashboard",
  "Chatbot",
  "File Explorer",
  "AI Search",
  "Document AI",
  "Duplicates",
  "Settings",
];

export default function Sidebar({ active, setActive }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">✨ IntelliFile</div>

      {NAV_ITEMS.map((item) => (
        <div
          key={item}
          className={`nav-item ${active === item ? "active" : ""}`}
          onClick={() => setActive(item)}
        >
          <span>📁</span>
          {item}
        </div>
      ))}

      <div className="sidebar-footer">
        <div className="ai-card">
          <div>AI Assistant</div>
          <small>Ready to help organize your files</small>
          <button>Ask AI</button>
        </div>
      </div>
    </aside>
  );
}

export default function FileCard({ file }) {
  const getIcon = () => {
    if (file.isDirectory) return "📁";
    if (file.name.endsWith(".pdf")) return "📕";
    if (file.name.endsWith(".doc") || file.name.endsWith(".docx")) return "📘";
    if (file.name.endsWith(".jpg") || file.name.endsWith(".png")) return "🖼️";
    if (file.name.endsWith(".js")) return "🟨";
    return "📄";
  };

  return (
    <div
      style={{
        background: "#0f172a",
        padding: 14,
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 18 }}>
          {getIcon()} {file.name}
        </div>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {(file.size / 1024).toFixed(1)} KB ·{" "}
          {new Date(file.modified).toLocaleDateString()}
        </div>

        {!file.isDirectory && (
          <div style={{ marginTop: 6 }}>
            <span style={tagStyle}>Work</span>
            <span style={tagStyle}>Important</span>
          </div>
        )}
      </div>

      <button style={btnStyle}>Open</button>
    </div>
  );
}

const tagStyle = {
  background: "#1e293b",
  padding: "4px 8px",
  borderRadius: 6,
  fontSize: 11,
  marginRight: 6,
};

const btnStyle = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  border: "none",
  color: "#fff",
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
};

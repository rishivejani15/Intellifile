import { useState } from "react";
import { analyzeDocument } from "../services/documentAI";

export default function DocumentAI() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const selectFile = async () => {
    const res = await window.electronAPI.openFile();
    if (!res) return;

    setFile(res);
    setResult(null);
  };

  const analyze = async () => {
    if (!file) return;

    setLoading(true);
    const data = await analyzeDocument(file);
    setResult(data);
    setLoading(false);
  };

  return (
    <div>
      <h1>
        Document AI <span style={badge}>AI Analysis</span>
      </h1>

      <p style={{ opacity: 0.7 }}>
        Upload documents for intelligent analysis and insights
      </p>

      {/* Upload box */}
      <div style={uploadBox} onClick={selectFile}>
        <div style={{ fontSize: 32 }}>⬆️</div>
        <p>{file ? file.filePath : "Drop your document here or click to browse"}</p>
        <button style={btnStyle}>Select File</button>
        <small>Supports PDF, DOCX, TXT and more</small>
      </div>

      {file && !result && (
        <button style={{ ...btnStyle, marginTop: 20 }} onClick={analyze}>
          Analyze Document
        </button>
      )}

      {loading && <p style={{ marginTop: 20 }}>Analyzing… 🤖</p>}

      {result && (
        <div style={{ marginTop: 30 }}>
          <Section title="Auto Summary">
            <p>{result.summary}</p>
          </Section>

          <Section title="Key Points">
            <ul>
              {result.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </Section>

          <Section title="Smart Actions">
            <ul>
              {result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

const badge = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  padding: "4px 10px",
  borderRadius: 20,
  fontSize: 12,
};

const uploadBox = {
  border: "2px dashed #1e293b",
  borderRadius: 16,
  padding: 30,
  marginTop: 20,
  textAlign: "center",
  cursor: "pointer",
};

const sectionStyle = {
  background: "#0f172a",
  padding: 20,
  borderRadius: 14,
  marginBottom: 16,
};

const btnStyle = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  border: "none",
  color: "#fff",
  padding: "10px 16px",
  borderRadius: 10,
  cursor: "pointer",
  marginTop: 10,
};

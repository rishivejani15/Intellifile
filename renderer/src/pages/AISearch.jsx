import { useState } from "react";
import FileCard from "../components/FileCard";
import { aiSearch } from "../services/aiSearch";

export default function AISearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    const res = await aiSearch(query);
    setResults(res);
    setLoading(false);
  };

  return (
    <div>
      <h1>
        AI Search <span style={badge}>AI-Powered</span>
      </h1>

      <p style={{ opacity: 0.7 }}>
        Search your files using natural language
      </p>

      <div style={searchBox}>
        <input
          placeholder="Find my resume from last year"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={inputStyle}
        />
        <button onClick={handleSearch} style={btnStyle}>
          Search
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        {loading && <p>AI is thinking… 🤖</p>}

        {results.map((file, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <FileCard file={file} />
            <small style={{ opacity: 0.6 }}>
              Why this result: {file.reason}
            </small>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30 }}>
        <p style={{ opacity: 0.6 }}>Try:</p>
        <Example text="Find my resume from last year" setQuery={setQuery} />
        <Example text="Documents about budget planning" setQuery={setQuery} />
        <Example text="All videos larger than 100MB" setQuery={setQuery} />
      </div>
    </div>
  );
}

function Example({ text, setQuery }) {
  return (
    <button
      onClick={() => setQuery(text)}
      style={{
        marginRight: 10,
        marginTop: 10,
        background: "#1e293b",
        border: "none",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: 20,
        cursor: "pointer",
      }}
    >
      {text}
    </button>
  );
}

const badge = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  padding: "4px 10px",
  borderRadius: 20,
  fontSize: 12,
};

const searchBox = {
  display: "flex",
  gap: 10,
  marginTop: 20,
};

const inputStyle = {
  flex: 1,
  padding: "12px",
  borderRadius: 10,
  border: "1px solid #1e293b",
  background: "#020617",
  color: "#fff",
};

const btnStyle = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  border: "none",
  color: "#fff",
  padding: "12px 20px",
  borderRadius: 10,
  cursor: "pointer",
};

import { useState } from "react";
import { findDuplicates } from "../services/duplicates";
import FileCard from "../components/FileCard";

export default function Duplicates() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  const scan = async () => {
    setLoading(true);
    const result = await findDuplicates();
    setGroups(result);
    setLoading(false);
  };

  return (
    <div>
      <h1>Duplicates</h1>
      <p style={{ opacity: 0.7 }}>
        Find and clean up duplicate files automatically
      </p>

      <button style={btnStyle} onClick={scan}>
        Scan for Duplicates
      </button>

      {loading && <p style={{ marginTop: 20 }}>Scanning files… 🔍</p>}

      <div style={{ marginTop: 30 }}>
        {groups.map((group, i) => (
          <div key={i} style={groupStyle}>
            <h4>Why: {group.reason}</h4>

            {group.files.map((file, j) => (
              <FileCard key={j} file={file} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const btnStyle = {
  background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
  border: "none",
  color: "#fff",
  padding: "12px 18px",
  borderRadius: 10,
  cursor: "pointer",
};

const groupStyle = {
  background: "#020617",
  padding: 16,
  borderRadius: 14,
  marginBottom: 20,
};

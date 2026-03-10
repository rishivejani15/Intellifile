import { useEffect, useState } from "react";
import FileCard from "../components/FileCard";

export default function FileExplorer() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [allFiles, setAllFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function loadRoots() {
      const roots = await window.electronAPI.getRootFolders();
      setFolders(roots);
    }
    loadRoots();
  }, []);

  const openFolder = async (folderPath) => {
    setCurrentPath(folderPath);
    setSearch("");

    const items = await window.electronAPI.readFolder(folderPath);
    setAllFiles(items);
    setFiles(items);
  };

  const handleSearch = (value) => {
    setSearch(value);

    const filtered = allFiles.filter((file) =>
      file.name.toLowerCase().includes(value.toLowerCase())
    );

    setFiles(filtered);
  };

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* LEFT */}
      <div style={{ width: 260, borderRight: "1px solid #222" }}>
        <h3>Folders</h3>
        {folders.map((f) => (
          <div
            key={f.path}
            onClick={() => openFolder(f.path)}
            style={{ cursor: "pointer", padding: "8px" }}
          >
            📁 {f.name}
          </div>
        ))}
      </div>

      {/* RIGHT */}
      <div style={{ flex: 1, padding: 20 }}>
        <h3>{currentPath || "Select a folder"}</h3>

        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 14px",
            marginBottom: 20,
            borderRadius: 10,
            border: "1px solid #1e293b",
            background: "#020617",
            color: "#fff",
          }}
        />

        {files.length === 0 && currentPath && (
          <p style={{ opacity: 0.6 }}>No files found</p>
        )}

        {files.map((file) => (
          <FileCard key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}

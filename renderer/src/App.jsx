// import { useState } from "react";
// import "./App.css";

// function App() {
//   const [fileContent, setFileContent] = useState("");

//   const openFile = async () => {
//     const result = await window.electronAPI.openFile();

//     if (!result) return;

//     setFileContent(result.content);
//   };

//   return (
//     <div>
//       <h1>Electron + React Secure 🚀</h1>

//       <button onClick={openFile}>Open File</button>

//       <pre style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>
//         {fileContent}
//       </pre>
//     </div>
//   );
// }

// export default App;


import { useState } from "react";
import AppLayout from "./layout/AppLayout";

import Dashboard from "./pages/Dashboard";
import FileExplorer from "./pages/FileExplorer";
import AISearch from "./pages/AISearch";
import DocumentAI from "./pages/DocumentAI";
import Duplicates from "./pages/Duplicates";
import Settings from "./pages/Settings";
import Chatbot from "./pages/Chatbot";

function App() {
  const [page, setPage] = useState("File Explorer");

  const renderPage = () => {
    switch (page) {
      case "Dashboard":
        return <Dashboard />;
      case "File Explorer":
        return <FileExplorer />;
      case "Chatbot":
        return <Chatbot />;
      case "AI Search":
        return <AISearch />;
      case "Document AI":
        return <DocumentAI />;
      case "Duplicates":
        return <Duplicates />;
      case "Settings":
        return <Settings />;
      default:
        return <FileExplorer />;
    }
  };

  return (
    <AppLayout page={page} setPage={setPage}>
      {renderPage()}
    </AppLayout>
  );
}

export default App;

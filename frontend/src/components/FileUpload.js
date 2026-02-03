import React from 'react';
import './FileUpload.css';

function FileUpload({ label, type, onUpload }) {
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onUpload(type, event.target.result);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="file-upload">
      <label>{label}</label>
      <input 
        type="file" 
        onChange={handleFileChange}
        accept=".txt,.py,.js,.java,.cpp,.c,.go,.rs,.md,.json,.xml,.html,.css"
      />
    </div>
  );
}

export default FileUpload;

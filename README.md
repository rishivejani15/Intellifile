# 🚀 IntelliFile Desktop App

IntelliFile is a modern **Electron + React desktop application** designed to intelligently organize, search, and analyze files using AI-powered features.

> Built with a **secure Electron architecture**, clean UI, and AI-ready design.

---

## ✨ Features

### 📁 File Explorer

* Browse real system folders
* View files with size, type, and modified date
* Beautiful file cards with icons and tags

### 🔍 Smart Search

* Instant keyword-based search
* AI Search UI using natural language (mocked, AI-ready)

### 🤖 Document AI

* Upload documents (PDF, DOCX, TXT)
* Auto summary, key points, and smart actions
* AI-ready pipeline (models plug-in later)

### ♻️ Duplicate Detection

* Scan and group duplicate files
* Clear explanation of why files are duplicates
* Ready for hash-based or AI similarity logic

### ⚙️ Settings

* AI enable/disable toggle
* Indexing scope control
* Privacy-first design (local processing by default)

---

## 🧠 Tech Stack

* **Electron** – Desktop runtime
* **React + Vite** – Frontend UI
* **Node.js (fs, path)** – File system access
* **IPC + Preload** – Secure communication
* **AI-ready architecture** – Mock services → real models later

---

## 📂 Project Structure

```
INTELLIFILE/
├── main.js            # Electron main process
├── preload.js         # Secure IPC bridge
├── renderer/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── layout/
│   ├── public/
│   ├── index.html
│   └── vite.config.js
├── package.json
└── README.md
```

---

## ▶️ Run Locally

### 1️⃣ Install dependencies

```bash
npm install
cd renderer
npm install
```

### 2️⃣ Start React (Vite)

```bash
cd renderer
npm run dev
```

### 3️⃣ Start Electron

```bash
npx electron .
```

---

## 🔐 Security

* `contextIsolation: true`
* `nodeIntegration: false`
* File system access only via preload IPC
* No direct Node access in renderer

---

## 🚧 Roadmap

* [ ] Persist settings to disk
* [ ] File indexing & background scanning
* [ ] Real AI integration (local or cloud)
* [ ] Windows installer (.exe)
* [ ] macOS & Linux builds

---

## 📜 License

MIT License

---

## 👨‍💻 Author

Built by **Rishi**
Computer Engineering | Desktop + AI Enthusiast
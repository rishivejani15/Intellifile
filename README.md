# Semantic Merge Assistant

AI-powered intelligent code merging with semantic analysis.

## Features

- **Smart Merge Suggestions**: Uses reranker + seq2seq summarizer for intelligent merge proposals
- **LoRA Personalization**: Optional Low-Rank Adaptation to learn your merge preferences
- **Multi-file Support**: Merge any text-based files (code, config, docs, etc.)
- **Electron Desktop App**: Modern cross-platform desktop application
- **Real-time Diff Viewer**: See changes side-by-side

## Architecture

### Backend (Python)
- `backend/merge/`: Core merge logic
  - `diff_engine.py`: Diff detection and conflict identification
  - `reranker.py`: Relevance scoring and suggestion ranking
  - `summarizer.py`: Change summarization
  - `lora_adapter.py`: Personalized merge preferences
  - `merge_generator.py`: Merge strategy implementation
- `backend/app.py`: Flask API server

### Frontend (React + Electron)
- Modern UI for file upload and merge visualization
- Real-time suggestion scoring
- Side-by-side diff viewer
- Merge result preview

## Installation

### Backend
```bash
cd backend
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

## Running

### Development
```bash
# Terminal 1: Start backend
cd backend
python app.py

# Terminal 2: Start frontend with Electron
cd frontend
npm run dev
```

### Production
```bash
cd frontend
npm run build
npm run electron-dev
```

## Usage

1. Open the Semantic Merge Assistant application
2. Upload three files:
   - **Base Version**: The original file
   - **Your Version**: Your changes
   - **Their Version**: Someone else's changes
3. Click "Get Merge Suggestions"
4. Review the AI-generated merge suggestions
5. Select the best merge strategy
6. Apply and save the merged result

## How It Works

1. **Diff Detection**: Identifies changes between versions
2. **Conflict Analysis**: Detects conflicting modifications
3. **Suggestion Generation**: Creates multiple merge strategies
4. **Reranking**: Scores suggestions by relevance
5. **Personalization**: LoRA adapter learns from your choices
6. **Presentation**: Shows top suggestions with confidence scores

## Technologies

- **Backend**: Python, Flask
- **Frontend**: React, Electron
- **Merge Logic**: Custom 3-way merge algorithm with semantic analysis

## License

MIT

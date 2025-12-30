# 📊 Equity News Research Assistant (Real-Time RAG System)

A real-time **Retrieval-Augmented Generation (RAG)** application that ingests PDFs, CSVs, text files, and live news URLs, indexes them using **FAISS vector search**, and enables **semantic search & question answering** through a modern **React Web UI** and a **FastAPI backend**.

This is a practical, production-style LLM system built for **financial research, news analysis, and dataset understanding**.

---

## 🚀 Features

### 🔹 1. Multi-format Document Ingestion
Instant ingestion and indexing of:
- PDF reports  
- CSV datasets (row-wise extraction)  
- TXT articles  
- Live URLs (news sites, blogs, reports)

### 🔹 2. Real-Time Ingestion (WebSockets)
Live progress updates for:
- Uploading large files  
- Scraping URLs  
- Indexing text chunks into FAISS  

### 🔹 3. Semantic Search with FAISS
Powered by:
- **SentenceTransformer:** `all-MiniLM-L6-v2`  
- **FAISS:** High-speed similarity search  
- Supports **top-k retrieval** with millisecond latency  

### 🔹 4. Clean React Frontend
Includes:
- File upload UI  
- URL ingestion UI  
- Real-time ingestion logs  
- Query/search interface  
- Recently indexed items viewer  

### 🔹 5. FastAPI Backend
Built using:
- FastAPI  
- Uvicorn  
- Sentence Transformers  
- FAISS  
- Trafilatura  
- PyPDF  

---

## 🏗️ Architecture Overview

**Flow:**  
`User Upload → Backend → Chunking → Embeddings → FAISS Index → Query → Response`

**Real-time updates:**  
`React UI <----- WebSockets -----> FastAPI`

## Architecture (High Level)
- Documents & URLs are ingested via FastAPI
- Text is chunked and converted to embeddings (MiniLM)
- Embeddings are stored in FAISS (vector database)
- Queries are embedded and matched via cosine similarity
- Results are streamed to the frontend in real-time using WebSockets


### Components:
- **Frontend:** React + WebSockets + Fetch API  
- **Backend:** FastAPI + FAISS + Embedding Model  
- **Vector DB:** FAISS  
- **Embedding Model:** MiniLM-L6-v2  

---

## 📁 Project Structure

equity-news-research-tool/
│
├── backend/
│ ├── backend.py # FastAPI API + FAISS + ingestion/search logic
│ ├── ws_manager.py # WebSocket event broadcasting
│ ├── faiss.index # Vector store
│ ├── faiss_meta.json # Metadata of stored chunks
│ └── requirements.txt
│
├── frontend/
│ ├── src/
│ │ ├── App.jsx # Main UI
│ │ ├── ws.js # WebSocket client
│ │ └── index.css
│ ├── public/
│ └── package.json
│
├── README.md
└── .gitignore


---

## 🧠 How It Works

### 1️⃣ Chunking
- Documents split into manageable chunks  
- CSV → row-wise chunks  
- PDF/TXT → sentence/paragraph-based  

### 2️⃣ Embedding
Each chunk is encoded using **MiniLM-L6-v2**.

### 3️⃣ Vector Indexing
FAISS stores normalized vectors enabling fast **approximate nearest neighbor** search.

### 4️⃣ Real-Time Notifications
Backend broadcasts steps:
- DOWNLOADING  
- EXTRACTING  
- CHUNKING  
- EMBEDDING  
- INDEXING  
- DONE  

### 5️⃣ Querying
Example query:  
> “What does the Reuters article say about Nvidia?”

Backend:
1. Embeds query  
2. Searches FAISS  
3. Returns top chunks  

---

## Example Queries
- "Summarize today’s uploaded news articles"
- "What is this CSV dataset about?"
- "What does the BBC article discuss?"


## 🖥️ Running the Backend (FastAPI)

### Setup
```bash
cd backend
python -m venv venv
venv\Scripts\activate    # Windows
pip install -r requirements.txt

Start Server
uvicorn backend:app --host 127.0.0.1 --port 8000

Backend available at:
http://127.0.0.1:8000


💻 Running the Frontend (React)
cd frontend
npm install
npm run dev

Frontend runs on:
http://localhost:5173



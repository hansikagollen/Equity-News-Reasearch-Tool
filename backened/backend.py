import os
import io
import json
import time
import re
import asyncio
from typing import List, Dict
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
import trafilatura
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
import faiss
import uvicorn

# ---------- CONFIG ----------
EMBED_MODEL = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
FAISS_INDEX_PATH = "faiss.index"
FAISS_META_PATH = "faiss_meta.json"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
# ----------------------------

# ---------- Helpers ----------
def split_text(text: str, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    if not text:
        return []
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    chunks, cur = [], ""
    for s in sentences:
        if len(cur) + len(s) <= size:
            cur = (cur + " " + s).strip()
        else:
            if cur:
                chunks.append(cur)
            if len(s) > size:
                for i in range(0, len(s), size - overlap):
                    chunks.append(s[i:i+size])
                cur = ""
            else:
                cur = s
    if cur:
        chunks.append(cur)
    return chunks

# ---------- FAISS Store ----------
class FaissStore:
    def __init__(self):
        self.index = None
        self.metadata: List[dict] = []
        self.dim = None

    def init_if_needed(self, dim):
        if self.index is None:
            self.dim = dim
            self.index = faiss.IndexFlatIP(dim)

    def add(self, embs, metas):
        if len(embs) == 0:
            return
        self.init_if_needed(embs.shape[1])
        norm = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-8)
        self.index.add(norm.astype("float32"))
        self.metadata.extend(metas)

    def search(self, q_emb, k=5):
        if self.index is None or self.index.ntotal == 0:
            return []
        qn = q_emb / (np.linalg.norm(q_emb, axis=1, keepdims=True) + 1e-8)
        D, I = self.index.search(qn.astype("float32"), k)
        out = []
        for score, idx in zip(D[0], I[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue
            m = self.metadata[idx].copy()
            m["score"] = float(score)
            out.append(m)
        return out

    def save(self):
        if self.index:
            faiss.write_index(self.index, FAISS_INDEX_PATH)
        with open(FAISS_META_PATH, "w") as f:
            json.dump(self.metadata, f, indent=2)

    def load(self):
        if os.path.exists(FAISS_META_PATH):
            with open(FAISS_META_PATH) as f:
                self.metadata = json.load(f)
            print(f"[store] Loaded metadata: {len(self.metadata)} items")

        if os.path.exists(FAISS_INDEX_PATH):
            self.index = faiss.read_index(FAISS_INDEX_PATH)
            self.dim = self.index.d
            print(f"[store] Loaded FAISS index (dim={self.dim})")


# ---------- INIT ----------
embed_model = SentenceTransformer(EMBED_MODEL)
store = FaissStore()
store.load()


# ========== WEBSOCKET MANAGER ==========
class WSManager:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active[client_id] = websocket
        print(f"[ws] connected: {client_id}")

    def disconnect(self, client_id: str):
        self.active.pop(client_id, None)
        print(f"[ws] disconnected: {client_id}")

    async def send(self, client_id: str, msg: dict):
        ws = self.active.get(client_id)
        if ws:
            await ws.send_json(msg)

ws_manager = WSManager()


# ---------- FASTAPI ----------
app = FastAPI(title="Equity Research Backend")

app.add_middleware(CORSMiddleware,
                   allow_origins=["*"],
                   allow_methods=["*"],
                   allow_headers=["*"])


# ---------- WS Route ----------
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await ws_manager.connect(client_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)


# ---------- Models ----------
class QueryRequest(BaseModel):
    query: str
    top_k: int = 5

class UrlsReq(BaseModel):
    urls: List[str]


# ---------- STATUS ----------
@app.get("/status")
def status():
    return {"ready": True, "indexed": len(store.metadata)}


# ---------- INGEST FILES ----------
@app.post("/ingest")
async def ingest(files: List[UploadFile] = File(...),
                 x_client_id: str = Header(None)):

    added_total = 0

    async def notify(event, data):
        if x_client_id:
            await ws_manager.send(x_client_id, {"event": event, **data})

    for f in files:
        name = f.filename
        b = await f.read()

        await notify("file_start", {"file": name})

        text = ""

        # PDF
        if name.lower().endswith(".pdf"):
            reader = PdfReader(io.BytesIO(b))
            text = "\n".join([p.extract_text() or "" for p in reader.pages])

        # CSV → row mode
        elif name.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(b))
            rows = []
            for _, row in df.iterrows():
                items = [f"{c}: {row[c]}" for c in df.columns]
                rows.append(" | ".join(items))

            parts = rows
            embs = embed_model.encode(parts, convert_to_numpy=True)

            metas = []
            ts = int(time.time())
            for i, t in enumerate(parts):
                metas.append({
                    "title": name,
                    "url": None,
                    "chunk_id": f"{name}_{ts}_{i}",
                    "text": t
                })

            store.add(embs, metas)
            added_total += len(parts)
            await notify("file_done", {"file": name, "added": len(parts)})
            continue

        # Text
        else:
            text = b.decode("utf-8", errors="ignore")

        parts = split_text(text)
        embs = embed_model.encode(parts, convert_to_numpy=True)

        metas = []
        ts = int(time.time())
        for i, t in enumerate(parts):
            metas.append({
                "title": name,
                "url": None,
                "chunk_id": f"{name}_{ts}_{i}",
                "text": t
            })

        store.add(embs, metas)
        added_total += len(parts)
        await notify("file_done", {"file": name, "added": len(parts)})

    store.save()
    await notify("ingest_done", {"added": added_total})
    return {"status": "ok", "added": added_total}


# ---------- INGEST URLS ----------
@app.post("/ingest/urls")
async def ingest_urls(req: UrlsReq, x_client_id: str = Header(None)):

    async def notify(event, data):
        if x_client_id:
            await ws_manager.send(x_client_id, {"event": event, **data})

    total_added = 0

    for url in req.urls:
        await notify("url_start", {"url": url})

        html = trafilatura.fetch_url(url)
        text = trafilatura.extract(html) if html else None

        if not text:
            await notify("url_error", {"url": url})
            continue

        parts = split_text(text)
        embs = embed_model.encode(parts, convert_to_numpy=True)

        metas = []
        ts = int(time.time())
        for i, t in enumerate(parts):
            metas.append({
                "title": None,
                "url": url,
                "chunk_id": f"url_{ts}_{i}",
                "text": t
            })

        store.add(embs, metas)
        total_added += len(parts)
        await notify("url_done", {"url": url, "added": len(parts)})

    store.save()
    await notify("ingest_done", {"added": total_added})
    return {"status": "ok", "added": total_added}


# ---------- QUERY ----------
@app.post("/query")
def query_endpoint(req: QueryRequest):
    q = req.query
    if not q:
        raise HTTPException(400, "Query missing")

    emb = embed_model.encode([q], convert_to_numpy=True)
    res = store.search(emb, k=req.top_k)
    return {"answers": res}


# ---------- META ----------
@app.get("/meta")
def get_meta(n: int = 20):
    return {"total": len(store.metadata), "items": store.metadata[-n:][::-1]}


if __name__ == "__main__":
    uvicorn.run("backend:app", host="0.0.0.0", port=8000)

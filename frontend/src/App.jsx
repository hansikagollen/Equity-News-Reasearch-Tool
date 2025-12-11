// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { connectWS } from "./ws";

const BACKEND = "http://127.0.0.1:8000";

function prettyNumber(n){ return (n===undefined||n===null) ? "-" : n; }

export default function App() {
  const [uploadStatus, setUploadStatus] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [filesPreview, setFilesPreview] = useState([]);
  const [metaList, setMetaList] = useState([]);
  const [urlsText, setUrlsText] = useState("");
  const [wsLogs, setWsLogs] = useState([]);
  const clientIdRef = useRef("client-" + Math.random().toString(36).slice(2, 10));
  const wsRef = useRef(null);

  // tasks keyed by id (for files: "file:{name}:{ts}", for urls: "url:{url}:{ts}")
  const [tasks, setTasks] = useState({});

  useEffect(() => {
    const clientId = clientIdRef.current;
    const ws = connectWS(clientId, handleWsMessage);
    wsRef.current = ws;
    addLog(`WS connecting as ${clientId}...`);

    return () => {
      try { ws.close(); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addLog(line){
    const time = new Date().toLocaleTimeString();
    setWsLogs(prev => [`[${time}] ${line}`, ...prev].slice(0, 300));
  }

  function handleWsMessage(msg){
    // msg is already parsed object from ws.js
    if (!msg) return;
    if (msg.event === "ws_open") { addLog("WS connected"); return; }
    if (msg.event === "ws_close") { addLog("WS disconnected"); return; }
    if (msg.event === "ws_error") { addLog("WS error: " + (msg.error || "")); return; }

    addLog(JSON.stringify(msg));

    // FILE events
    if (msg.event === "file_start") {
      const id = `file:${msg.file}:${Date.now()}`;
      setTasks(prev => ({ ...prev, [id]: { id, type: "file", name: msg.file, total: msg.chunks_to_add ?? null, added: 0, status: "processing" } }));
      setUploadStatus(`Processing ${msg.file}`);
    } else if (msg.event === "file_done") {
      // try to match by file name (latest started)
      setTasks(prev => {
        const newTasks = { ...prev };
        const keys = Object.keys(prev).filter(k => prev[k].type === "file" && prev[k].name === msg.file);
        const key = keys.length ? keys[0] : null;
        if (key) newTasks[key] = { ...newTasks[key], added: prettyNumber(msg.added ?? msg.added_chunks), status: "done" };
        return newTasks;
      });
      setUploadStatus(`File done: ${msg.file} (+${msg.added ?? msg.added_chunks})`);
    } else if (msg.event === "file_error") {
      const id = `file_err:${msg.file}:${Date.now()}`;
      setTasks(prev => ({ ...prev, [id]: { id, type: "file", name: msg.file, total: 0, added: 0, status: "error", error: msg.error } }));
      setUploadStatus(`File error: ${msg.file}`);
    }

    // URL events
    else if (msg.event === "url_start") {
      const id = `url:${msg.url}:${Date.now()}`;
      setTasks(prev => ({ ...prev, [id]: { id, type: "url", url: msg.url, total: msg.chunks ?? null, added: 0, status: "processing" } }));
      setUploadStatus(`Fetching ${msg.url}`);
    } else if (msg.event === "url_chunks") {
      // update total expected
      setTasks(prev => {
        const keys = Object.keys(prev).filter(k => prev[k].type === "url" && prev[k].url === msg.url);
        const newTasks = { ...prev };
        if (keys.length) {
          const key = keys[0];
          newTasks[key] = { ...newTasks[key], total: msg.chunks };
        }
        return newTasks;
      });
    } else if (msg.event === "url_done") {
      setTasks(prev => {
        const keys = Object.keys(prev).filter(k => prev[k].type === "url" && prev[k].url === msg.url);
        const newTasks = { ...prev };
        if (keys.length) {
          const key = keys[0];
          newTasks[key] = { ...newTasks[key], added: prettyNumber(msg.added ?? msg.added_chunks), status: "done" };
        } else {
          // create one if missing
          const id = `url:${msg.url}:${Date.now()}`;
          newTasks[id] = { id, type: "url", url: msg.url, total: msg.added ?? msg.added_chunks, added: msg.added ?? msg.added_chunks, status: "done" };
        }
        return newTasks;
      });
      setUploadStatus(`URL done: ${msg.url} (+${msg.added ?? msg.added_chunks})`);
    } else if (msg.event === "url_error") {
      const id = `url_err:${msg.url}:${Date.now()}`;
      setTasks(prev => ({ ...prev, [id]: { id, type: "url", url: msg.url, total: 0, added: 0, status: "error", error: msg.error } }));
      setUploadStatus(`URL error: ${msg.url}`);
    } else if (msg.event === "ingest_done") {
      setUploadStatus(`Ingest finished — added ${msg.added ?? msg.added_chunks}. Total indexed: ${msg.total_indexed ?? ""}`);
      // refresh metadata
      fetchMeta();
    }
  }

  const onFilesChange = (e) => {
    setFilesPreview(Array.from(e.target.files).map(f => f.name));
  };

  const uploadFiles = async () => {
    const input = document.getElementById("fileInput");
    const files = input?.files;
    if (!files || files.length === 0) {
      alert("Select files to upload.");
      return;
    }
    setUploadStatus("Uploading...");
    const form = new FormData();
    for (let f of files) form.append("files", f);

    try {
      const res = await fetch(`${BACKEND}/ingest`, {
        method: "POST",
        body: form,
        headers: { "x-client-id": clientIdRef.current } // tell backend which WS to notify
      });
      const json = await res.json();
      // backend will send live events; fallback display now
      setUploadStatus(`Server response: added ${json.added} chunks`);
      fetchMeta();
    } catch (err) {
      setUploadStatus("Upload failed: " + String(err));
    }
  };

  const ingestUrls = async () => {
    const urls = urlsText.split("\n").map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) { alert("Add at least one URL (one per line)"); return; }
    setUploadStatus("Fetching & ingesting URLs...");
    try {
      const res = await fetch(`${BACKEND}/ingest/urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-id": clientIdRef.current },
        body: JSON.stringify({ urls })
      });
      const j = await res.json();
      setUploadStatus(`Server response: added ${j.added} chunks`);
      fetchMeta();
    } catch (e) {
      setUploadStatus("URL ingest failed: " + String(e));
    }
  };

  const fetchMeta = async () => {
    try {
      const res = await fetch(`${BACKEND}/meta?n=20`);
      const j = await res.json();
      setMetaList(j.items || []);
    } catch (e) {
      addLog("Failed to fetch meta: " + e);
    }
  };

  const ask = async () => {
    if (!query.trim()) { alert("Enter a question"); return; }
    setResults([{ loading: true }]);
    try {
      const res = await fetch(`${BACKEND}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query, top_k: 6 }),
      });
      const json = await res.json();
      setResults(json.answers || []);
    } catch (err) {
      setResults([{ error: String(err) }]);
    }
  };

  // render helpers
  const renderProgress = (t) => {
    const pct = (t.total && t.added) ? Math.min(100, Math.round((t.added / t.total) * 100)) : null;
    return (
      <div style={{display:"flex", alignItems:"center", gap:12}}>
        <div style={{flex:1}}>
          <div style={{fontSize:13, color:"#333", marginBottom:6}}>
            {t.type === "file" ? <strong>{t.name}</strong> : <strong>{t.url}</strong>}
            {" "}
            <span style={{color:"#666", fontSize:12}}> — {t.status}</span>
          </div>
          <div style={{height:8, background:"#eee", borderRadius:6, overflow:"hidden"}}>
            <div style={{
              width: pct != null ? `${pct}%` : (t.status==="done" ? "100%" : "6%"),
              height:"100%",
              background: t.status==="error" ? "#ff6b6b" : "#06f",
              transition:"width 300ms ease"
            }} />
          </div>
          <div style={{fontSize:12, color:"#666", marginTop:6}}>
            {t.added} / {t.total ?? "?"} chunks {t.error ? ` — ${t.error}` : ""}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Equity Research Assistant — Realtime</h1>

      <div style={styles.card}>
        <h3>Upload documents (PDF / CSV / TXT)</h3>
        <div style={{display:"flex", gap:10, alignItems:"center"}}>
          <input id="fileInput" type="file" multiple onChange={onFilesChange} />
          <button style={styles.button} onClick={uploadFiles}>Ingest Files</button>
        </div>
        <div style={{marginTop:8}}><b>Selected:</b> {filesPreview.join(", ") || "none"}</div>

        <div style={{marginTop:14}}>
          <label>Ingest URLs (one per line)</label>
          <textarea rows={4} style={styles.textarea} value={urlsText} onChange={(e)=>setUrlsText(e.target.value)} placeholder="https://example.com/article1"></textarea>
          <div style={{display:"flex", gap:10, marginTop:8}}>
            <button style={styles.button} onClick={ingestUrls}>Ingest URLs</button>
            <button style={styles.secondary} onClick={fetchMeta}>Show latest indexed rows</button>
          </div>
        </div>

        <div style={{marginTop:12, color:"#0b63ff"}}>{uploadStatus}</div>
      </div>

      <div style={styles.card}>
        <h3>Realtime progress</h3>
        <div style={{display:"grid", gap:10}}>
          {Object.values(tasks).length === 0 ? <div style={{color:"#666"}}>No active tasks yet — start an ingest to see live progress</div> :
            Object.values(tasks).map(t => (
              <div key={t.id} style={{padding:8, border:"1px solid #eee", borderRadius:8, background:"#fff"}}>
                {renderProgress(t)}
              </div>
            ))
          }
        </div>

        <div style={{marginTop:12}}>
          <h4>Logs</h4>
          <div style={{whiteSpace:"pre-wrap", maxHeight:220, overflowY:"auto", background:"#fafafa", padding:10, borderRadius:6, border:"1px solid #eee"}}>
            {wsLogs.map((l, i) => <div key={i} style={{fontSize:13, marginBottom:6}}>{l}</div>)}
          </div>
          <div style={{marginTop:8, color:"#444"}}>Client ID: <code>{clientIdRef.current}</code></div>
        </div>
      </div>

      <div style={styles.card}>
        <h3>Ask a question</h3>
        <textarea rows={4} style={styles.textarea} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="e.g., What movies are in movies.csv?" />
        <div style={{display:"flex", gap:10, marginTop:10}}>
          <button style={styles.button} onClick={ask}>Search</button>
          <button style={styles.secondary} onClick={() => { setQuery("Summarize the contents of the uploaded CSV files."); ask(); }}>Quick summarize</button>
        </div>

        <div style={{marginTop:12}}>
          {results.map((r,i) =>
            r.loading ? <p key={i}>Searching...</p> :
            r.error ? <div key={i} style={styles.error}>Error: {r.error}</div> :
            <div key={i} style={styles.resultBox}>
              <div style={{fontSize:13}}><strong>Score:</strong> {r.score?.toFixed(4)}</div>
              <div style={{fontSize:13, color:"#666"}}><strong>Source:</strong> {r.title || r.url || r.source || "unknown"}</div>
              <div style={{marginTop:8}}>{r.text}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{height:40}} />
    </div>
  );
}

// small styles (feel free to replace with Tailwind or CSS file)
const styles = {
  container: { fontFamily: "Inter, Arial, sans-serif", padding: 20, background: "#f4f6f9", minHeight: "100vh" },
  title: { textAlign: "center", marginBottom: 12 },
  card: { background: "#fff", margin: "20px auto", padding: 16, maxWidth: 980, borderRadius: 10, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" },
  button: { padding: "10px 14px", background: "#0066ff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  secondary: { padding: "8px 12px", background: "#eee", color: "#222", border: "none", borderRadius: 8, cursor: "pointer" },
  textarea: { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" },
  resultBox: { marginTop: 12, padding: 12, background: "#fff", borderLeft: "4px solid #0066ff", borderRadius: 6 },
  error: { color: "red" }
};

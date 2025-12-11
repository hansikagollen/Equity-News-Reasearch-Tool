// src/ws.js
// Simple WS helper with auto-reconnect and heartbeat.
// Usage: const ws = connectWS(clientId, onMessage)

export function connectWS(clientId, onMessage, opts = {}) {
  const url = (opts.secure ? "wss" : "ws") + `://${opts.host || "127.0.0.1:8000"}/ws/${clientId}`;
  let ws = null;
  let closedByUser = false;
  let reconnectTimer = null;
  let pingTimer = null;

  function start() {
    closedByUser = false;
    ws = new WebSocket(url);

    ws.onopen = () => {
      // heartbeat ping
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch (e) {}
      }, 20000);
      // notify app
      onMessage && onMessage({ event: "ws_open" });
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onMessage && onMessage(msg);
      } catch (e) {
        // non-json or parse fail -> pass raw
        onMessage && onMessage({ event: "ws_raw", data: ev.data });
      }
    };

    ws.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      onMessage && onMessage({ event: "ws_close" });
      if (!closedByUser) scheduleReconnect();
    };

    ws.onerror = (err) => {
      onMessage && onMessage({ event: "ws_error", error: String(err) });
      // errors will trigger onclose; let reconnect logic handle it
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start();
    }, 2500 + Math.random() * 2000);
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function close() {
    closedByUser = true;
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { ws && ws.close(); } catch (e) {}
  }

  // start immediately
  start();

  return { send, close };
}

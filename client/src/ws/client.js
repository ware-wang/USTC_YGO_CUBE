/**
 * WebSocket client for USTC-OnlineCube
 * ES module — auto-connecting with reconnect support
 */

const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';

let handlers = {};
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let connected = false;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  let socket = null;
  try { socket = new WebSocket(WS_URL); } catch (e) { scheduleReconnect(); return; }
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    connected = true;
    reconnectDelay = 1000;
    emit('connected', {});
  };

  socket.onmessage = (ev) => {
    if (ws !== socket) return;
    try {
      const msg = JSON.parse(ev.data);
      emit(msg.type, msg);
    } catch (e) { /* ignore malformed */ }
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    connected = false;
    emit('disconnected', {});
    scheduleReconnect();
  };

  socket.onerror = (e) => {
    if (ws !== socket) return;
    console.error('[WS] Error:', e);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  }, reconnectDelay);
}

function emit(type, data) {
  const list = handlers[type];
  if (list) {
    for (let i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { /* handler error */ }
    }
  }
}

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload: payload || {} }));
  }
}

function on(type, fn) {
  if (!handlers[type]) handlers[type] = [];
  handlers[type].push(fn);
}

function isConnected() {
  return connected && ws && ws.readyState === WebSocket.OPEN;
}

export const wsClient = {
  connect,
  send,
  on,
  isConnected,
};

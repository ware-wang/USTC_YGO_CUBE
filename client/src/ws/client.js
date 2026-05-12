/**
 * WebSocket client for Cube Draft
 * ES module — auto-connecting with reconnect support
 */

const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';

let handlers = {};
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let connected = false;

function connect() {
  try { ws = new WebSocket(WS_URL); } catch (e) { scheduleReconnect(); return; }

  ws.onopen = () => {
    connected = true;
    reconnectDelay = 1000;
    emit('connected', {});
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      emit(msg.type, msg);
    } catch (e) { /* ignore malformed */ }
  };

  ws.onclose = () => {
    connected = false;
    emit('disconnected', {});
    scheduleReconnect();
  };

  ws.onerror = (e) => {
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

// Auto-connect
connect();
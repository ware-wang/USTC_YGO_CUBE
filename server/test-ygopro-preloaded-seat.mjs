import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CTOS_JOIN_GAME,
  CTOS_PLAYER_INFO,
  STOC_TYPE_CHANGE,
  decodePackets,
  encodePacket,
} from './src/duel-bridge/protocol-adapter.js';
import { handleYgoproConnection, registerPreloadedDecks } from './src/duel-bridge/ygopro-ws.js';

const passWd = `seat_${Date.now().toString(36)}`;

registerPreloadedDecks(passWd, [
  { main: Array(40).fill(89631139), extra: [], side: [] },
  { main: Array(40).fill(46986414), extra: [], side: [] },
], {
  players: [
    { id: 'alice-id', name: 'Alice' },
    { id: 'bob-id', name: 'Bob' },
  ],
  testMode: true,
});

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', ws => handleYgoproConnection(ws, {}));

await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
const { port } = httpServer.address();

const bob = await openClient(`ws://127.0.0.1:${port}`);
bob.send(makePlayerInfo('#pid:bob-id'));
bob.send(makeJoinGame(passWd));

const typeChange = await bob.waitForProto(STOC_TYPE_CHANGE);
const selfType = typeChange.exData.readUInt8(0) & 0x0f;
assert.equal(selfType, 1, 'seat1 player must keep position 1 even when joining first');

await closeWs(bob.ws);
await closeWss(wss);
await closeServer(httpServer);

console.log('[test-ygopro-preloaded-seat] ok');

async function openClient(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const client = {
    ws,
    packets: [],
    waiters: [],
    send(buffer) {
      ws.send(buffer);
    },
    waitForProto(proto, timeoutMs = 1000) {
      const existing = this.packets.find(packet => packet.proto === proto);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter(waiter => waiter.resolve !== resolve);
          reject(new Error(`Timed out waiting for proto ${proto}`));
        }, timeoutMs);
        this.waiters.push({ proto, resolve, timer });
      });
    },
  };

  ws.on('message', raw => {
    for (const packet of decodePackets(raw)) {
      client.packets.push(packet);
      for (const waiter of [...client.waiters]) {
        if (waiter.proto !== packet.proto) continue;
        clearTimeout(waiter.timer);
        client.waiters = client.waiters.filter(w => w !== waiter);
        waiter.resolve(packet);
      }
    }
  });

  return client;
}

function makePlayerInfo(name) {
  const buf = Buffer.alloc(40);
  writeUtf16(buf, 0, name, 20);
  return encodePacket(CTOS_PLAYER_INFO, buf);
}

function makeJoinGame(passWd) {
  const buf = Buffer.alloc(48);
  buf.writeUInt16LE(0x1353, 0);
  buf.writeUInt16LE(0, 2);
  buf.writeUInt32LE(0, 4);
  writeUtf16(buf, 8, passWd, 20);
  return encodePacket(CTOS_JOIN_GAME, buf);
}

function writeUtf16(buf, offset, text, maxChars) {
  const chars = Array.from(String(text || '')).slice(0, maxChars);
  for (let i = 0; i < chars.length; i++) {
    buf.writeUInt16LE(chars[i].charCodeAt(0), offset + i * 2);
  }
}

function closeWs(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    timer.unref?.();
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.close();
  });
}

function closeWss(server) {
  return new Promise(resolve => server.close(resolve));
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { cardDB } from './src/card-db/index.js';
import { DuelManager } from './src/duel-manager/index.js';
import { RoomManager } from './src/room/index.js';

process.env.DRAFT_PICK_TIMEOUT_MS = '80';
process.env.DRAFT_DISCONNECT_GRACE_MS = '40';

await cardDB.init();
const { createWSServer } = await import('./src/ws/index.js');

const roomManager = new RoomManager();
const duelManager = new DuelManager();
const httpServer = createServer();
const wsServers = createWSServer(httpServer, roomManager, duelManager, null, {});

await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
const { port } = httpServer.address();
const wsUrl = `ws://127.0.0.1:${port}/ws`;

const room = roomManager.createRoom(
  'test',
  [89631139, 46986414, 22091647, 55144522],
  2,
  1,
  2,
  null,
  true,
);

const alice = await openClient(wsUrl);
const bob = await openClient(wsUrl);

alice.send('join_room', { roomId: room.id, playerName: 'Alice' });
bob.send('join_room', { roomId: room.id, playerName: 'Bob' });
await alice.waitFor('joined');
await bob.waitFor('joined');

alice.send('start_draft', { roomId: room.id });
await alice.waitFor('pack');
await bob.waitFor('pack');

bob.ws.close();

const complete = await alice.waitFor('draft_complete', 1500);
const pools = complete.payload.pools;
assert.equal(pools[alice.playerId].cardIds.length, 2);
assert.equal(pools[bob.playerId].cardIds.length, 2);
assert.equal(room.draft.state, 'complete');

await closeWs(alice.ws);
await closeWs(bob.ws);
await closeWss(wsServers.jsonWss);
await closeWss(wsServers.ygoproWss);
await closeServer(httpServer);
console.log('[test-draft-timeout-ws] ok');
process.exit(0);

async function openClient(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const client = {
    ws,
    messages: [],
    waiters: [],
    playerId: null,
    send(type, payload) {
      ws.send(JSON.stringify({ type, payload }));
    },
    waitFor(type, timeoutMs = 1000) {
      const existing = this.messages.find(msg => msg.type === type);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter(waiter => waiter.resolve !== resolve);
          reject(new Error(`Timed out waiting for ${type}`));
        }, timeoutMs);
        this.waiters.push({ type, resolve, reject, timer });
      });
    },
  };

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    client.messages.push(msg);
    if (msg.type === 'joined') client.playerId = msg.payload.playerId;

    for (const waiter of [...client.waiters]) {
      if (waiter.type !== msg.type) continue;
      clearTimeout(waiter.timer);
      client.waiters = client.waiters.filter(w => w !== waiter);
      waiter.resolve(msg);
    }
  });

  return client;
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
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    } else {
      clearTimeout(timer);
      resolve();
    }
  });
}

function closeWss(wss) {
  return new Promise(resolve => wss.close(resolve));
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

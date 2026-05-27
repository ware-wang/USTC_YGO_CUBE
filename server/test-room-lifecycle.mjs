/**
 * Room lifecycle smoke test.
 *
 * Verifies:
 * - a created room remains available before the first WS join
 * - a joined player is marked connected
 * - a disconnected idle-room player is marked disconnected
 * - the disconnected player is eventually cleaned up
 * - explicit leave removes the player immediately and broadcasts updates
 *
 * Run with:
 *   BASE_URL=http://localhost:3131 node test-room-lifecycle.mjs
 */

import { WebSocket } from 'ws';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3131';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';
const CLEANUP_WAIT_MS = parseInt(process.env.CLEANUP_WAIT_MS || '17000', 10);

async function main() {
  const roomId = await createRoom('Alice');
  let room = await getRoom(roomId);
  assert(Array.isArray(room.players), 'created room should be queryable before WS join');
  assert(room.players.length === 0, 'created room should start empty');

  const ws = await openWs();
  ws.send(JSON.stringify({ type: 'join_room', payload: { roomId, playerName: 'Alice' } }));
  await wait(300);

  room = await getRoom(roomId);
  assert(room.players.length === 1, 'room should contain Alice after join');
  assert(room.players[0].connected === true, 'joined player should be marked connected');

  ws.close();
  await wait(400);

  room = await getRoom(roomId);
  assert(room.players.length === 1, 'idle room should retain player briefly after disconnect');
  assert(room.players[0].connected === false, 'disconnected player should be marked disconnected');

  await wait(CLEANUP_WAIT_MS);
  room = await getRoom(roomId, true);
  assert(
    room.error === 'Room not found' || (Array.isArray(room.players) && room.players.length === 0),
    'idle disconnected player should be cleaned up after grace period',
  );

  const roomId2 = await createRoom('Host');
  const host = await openWs();
  const guest = await openWs();
  let hostUpdates = 0;

  host.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'room_update') hostUpdates++;
  });

  host.send(JSON.stringify({ type: 'join_room', payload: { roomId: roomId2, playerName: 'Host' } }));
  guest.send(JSON.stringify({ type: 'join_room', payload: { roomId: roomId2, playerName: 'Guest' } }));
  await wait(300);
  guest.send(JSON.stringify({ type: 'leave_room', payload: { roomId: roomId2 } }));
  await wait(400);

  room = await getRoom(roomId2);
  assert(hostUpdates >= 2, 'host should receive room updates for join and leave');
  assert(room.players.length === 1, 'explicit leave should remove the guest immediately');
  assert(room.players[0].name === 'Host', 'host should remain in room after guest leaves');

  host.close();
  guest.close();
  console.log('room lifecycle test passed');
}

async function createRoom(playerName) {
  const res = await fetch(BASE_URL + '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerName,
      cubeName: 'sample',
      maxPlayers: 4,
      packsPerPlayer: 1,
      cardsPerPack: 5,
      testMode: true,
    }),
  });
  const body = await res.json();
  assert(res.ok, `create room failed: ${JSON.stringify(body)}`);
  return body.roomId;
}

async function getRoom(roomId, allow404 = false) {
  const res = await fetch(BASE_URL + '/api/rooms/' + roomId);
  const body = await res.json();
  if (!allow404) {
    assert(res.ok, `get room failed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function openWs() {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

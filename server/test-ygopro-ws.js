/**
 * Quick integration test: ygopro binary WS protocol
 *
 * Simulates two neos-ts clients connecting, joining a room, and starting a duel.
 * Run with: node test-ygopro-ws.js
 */

import { WebSocket } from 'ws'; // requires installing ws package

const WS_URL = 'ws://localhost:3131/ws-duel';
const ROOM_PASS = 'testroom';

// ── Packet helpers (mirrors protocol-adapter) ──

function mkPacket(proto, exData) {
  const packetLen = (exData ? exData.length : 0) + 1;
  const buf = Buffer.alloc(2 + packetLen);
  buf.writeUInt16LE(packetLen, 0);
  buf.writeUInt8(proto, 2);
  if (exData && exData.length > 0) exData.copy(buf, 3);
  return buf;
}

function mkPlayerInfo(name) {
  const buf = Buffer.alloc(40); // 20 * uint16 LE
  for (let i = 0; i < 20; i++) {
    buf.writeUInt16LE(i < name.length ? name.charCodeAt(i) : 0, i * 2);
  }
  return mkPacket(0x10, buf);
}

function mkJoinGame(passWd) {
  const buf = Buffer.alloc(48); // 2+2+4+40
  buf.writeUInt16LE(0x1362, 0); // version
  // align: 0
  // gameId: 0
  for (let i = 0; i < 20; i++) {
    buf.writeUInt16LE(i < passWd.length ? passWd.charCodeAt(i) : 0, 8 + i * 2);
  }
  return mkPacket(0x12, buf);
}

function mkUpdateDeck(mainCards) {
  const mainLen = mainCards.length;
  const buf = Buffer.alloc(8 + mainLen * 4);
  buf.writeInt32LE(mainLen, 0);
  buf.writeInt32LE(0, 4); // sideLen = 0
  for (let i = 0; i < mainLen; i++) {
    buf.writeInt32LE(mainCards[i], 8 + i * 4);
  }
  return mkPacket(0x02, buf);
}

function mkHsReady() {
  return mkPacket(0x22, Buffer.alloc(0));
}

function decodePacket(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const packets = [];
  let offset = 0;
  while (offset + 3 <= buf.length) {
    const len = buf.readUInt16LE(offset);
    const proto = buf.readUInt8(offset + 2);
    const exData = buf.slice(offset + 3, offset + 3 + len - 1);
    packets.push({ proto, exData, exDataHex: exData.toString('hex').slice(0, 40) });
    offset += 2 + len;
  }
  return packets;
}

const PROTO_NAMES = {
  0x01: 'STOC_GAME_MSG',
  0x12: 'STOC_JOIN_GAME',
  0x13: 'STOC_TYPE_CHANGE',
  0x15: 'STOC_DUEL_START',
  0x16: 'STOC_DUEL_END',
  0x20: 'STOC_HS_PLAYER_ENTER',
  0x21: 'STOC_HS_PLAYER_CHANGE',
  0x02: 'STOC_ERROR_MSG',
  0x19: 'STOC_CHAT',
};

// ── Test flow ──

async function test() {
  console.log('=== YGOPro WS Protocol Integration Test ===\n');

  const p1 = new WebSocket(WS_URL);
  const p2 = new WebSocket(WS_URL);

  const messages1 = [];
  const messages2 = [];

  p1.on('message', (data) => {
    const pkts = decodePacket(data);
    for (const p of pkts) {
      messages1.push(p);
      console.log(`[P1] ← ${PROTO_NAMES[p.proto] || '0x' + p.proto.toString(16)} ${p.exDataHex}`);
    }
  });

  p2.on('message', (data) => {
    const pkts = decodePacket(data);
    for (const p of pkts) {
      messages2.push(p);
      console.log(`[P2] ← ${PROTO_NAMES[p.proto] || '0x' + p.proto.toString(16)} ${p.exDataHex}`);
    }
  });

  // Wait for both to connect
  await Promise.all([
    new Promise(r => p1.on('open', r)),
    new Promise(r => p2.on('open', r)),
  ]);

  console.log('\n--- Both connected, sending protocol handshake ---\n');

  // Send PLAYER_INFO + JOIN_GAME
  p1.send(mkPlayerInfo('Alice'));
  p1.send(mkJoinGame(ROOM_PASS));

  p2.send(mkPlayerInfo('Bob'));
  p2.send(mkJoinGame(ROOM_PASS));

  await sleep(500);

  // Send UPDATE_DECK with some real card IDs
  // Just use a few random card IDs for test (they won't form a valid deck but will test the flow)
  const testDeck = [
    89631139, // Blue-Eyes White Dragon
    46986414, // Dark Magician
    38033121, // Dark Magician Girl
    23995346, // Red-Eyes B. Dragon
    40374923, // Dark Hole
    5318639,  // Pot of Avarice
    81439173, // Swords of Revealing Light
    44095762, // Mirror Force
  ];

  p1.send(mkUpdateDeck(testDeck));
  p2.send(mkUpdateDeck(testDeck));

  await sleep(300);

  // Send HS_READY from both
  p1.send(mkHsReady());
  p2.send(mkHsReady());

  await sleep(1000);

  // Check what messages we got
  console.log('\n--- Messages received ---');
  console.log(`P1: ${messages1.length} messages`);
  for (const m of messages1) {
    const name = PROTO_NAMES[m.proto] || ('0x' + m.proto.toString(16));
    console.log(`  ${name}`);
  }

  console.log(`P2: ${messages2.length} messages`);
  for (const m of messages2) {
    const name = PROTO_NAMES[m.proto] || ('0x' + m.proto.toString(16));
    console.log(`  ${name}`);
  }

  p1.close();
  p2.close();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

test().then(() => {
  console.log('\n=== Test complete ===');
  process.exit(0);
}).catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
import { WebSocketServer } from 'ws';
import { DRAFT_STATES } from '../draft/index.js';

/** Map ws → { roomId, playerId, playerName } */
const clients = new Map();

let duelManagerRef = null;

export function createWSServer(httpServer, roomManager, duelManager) {
  duelManagerRef = duelManager;

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] New connection');

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }
      handleMessage(ws, msg, roomManager);
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

function handleMessage(ws, msg, roomManager) {
  const { type, payload = {} } = msg;

  switch (type) {
    case 'join_room': return handleJoin(ws, payload, roomManager);
    case 'start_draft': return handleStart(ws, payload, roomManager);
    case 'confirm_pick': return handleConfirmPick(ws, payload, roomManager);
    case 'get_pack': return handleGetPack(ws, payload, roomManager);
    case 'get_ydk': return handleGetYdk(ws, payload, roomManager);
    case 'leave_room': return handleLeave(clients.get(ws), roomManager);
    case 'swap_seat': return handleSwapSeat(ws, payload, roomManager);
    case 'chat': return handleChat(ws, payload, roomManager);
    case 'duel_join_table': return handleDuelJoin(ws, payload);
    case 'duel_submit_deck': return handleDuelSubmit(ws, payload);
    case 'duel_start': return handleDuelStart(ws, payload);
    case 'duel_respond': return handleDuelRespond(ws, payload);
    case 'duel_get_state': return handleDuelGetState(ws, payload);
    case 'battle_create_tables': return handleBattleCreate(ws, payload, roomManager);
    case 'battle_join_table': return handleDuelJoin(ws, payload);
    case 'battle_submit_deck': return handleDuelSubmit(ws, payload);
    case 'battle_start': return handleDuelStart(ws, payload);
    case 'battle_respond': return handleDuelRespond(ws, payload);
    case 'battle_get_state': return handleDuelGetState(ws, payload);
    default:
      console.log('[WS] Unknown:', type);
      send(ws, { type: 'error', payload: { message: '未知消息类型: ' + type } });
  }
}

/* ==================== ROOM / DRAFT HANDLERS ==================== */

function handleJoin(ws, { roomId, playerName, password }, rm) {
  const result = rm.addPlayer(roomId, playerName, password || null);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const { player, room } = result;
  clients.set(ws, { roomId: room.id, playerId: player.id, playerName });

  const pub = rm.getRoomPublic(roomId);
  send(ws, { type: 'joined', payload: { playerId: player.id, playerName: player.name, room: pub, reconnected: !!result.reconnected } });

  if (pub.chat?.length) send(ws, { type: 'chat_history', payload: { messages: pub.chat } });

  broadcast(roomId, rm, ws, { type: 'room_update', payload: { room: rm.getRoomPublic(roomId) } });
}

function handleStart(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const result = rm.startDraft(roomId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const room = rm.getRoom(roomId);
  broadcast(roomId, rm, null, { type: 'draft_started', payload: { totalRounds: room.packsPerPlayer, cardsPerPack: room.cardsPerPack } });

  for (const p of room.players) {
    const pack = room.draft.getCurrentPack(p.id);
    const pws = findPlayerWs(roomId, p.id);
    if (pws) send(pws, { type: 'pack', payload: { ...pack, picked: room.draft.playerPools.get(p.id)?.length || 0 } });
  }
}

function handleConfirmPick(ws, { roomId, cardIndex }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });

  const result = room.draft.confirmPick(client.playerId, cardIndex);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  send(ws, { type: 'pick_result', payload: { pickedCardId: result.pickedCardId, success: true, confirmedCount: result.confirmedCount, totalPlayers: result.totalPlayers } });

  const who = [];
  for (const id of room.draft.confirmedThisRound) {
    const p = room.players.find(pl => pl.id === id);
    if (p) who.push(p.name);
  }
  broadcast(roomId, rm, null, { type: 'confirm_update', payload: { confirmedCount: room.draft.confirmedThisRound.size, totalPlayers: room.players.length, whoConfirmed: who } });

  if (!result.allConfirmed) return;

  if (result.draftComplete) {
    // Create battle tables
    const tables = duelManagerRef.createBattleTables(room);
    broadcast(roomId, rm, null, { type: 'draft_complete', payload: { pools: room.draft.getPlayerPools(), tables: tables.map(t => ({
      id: t.id, roomId: t.roomId, state: t.state, seats: t.seats,
    })) } });
    room.state = DRAFT_STATES.COMPLETE;
    return;
  }

  for (const p of room.players) {
    const pack = room.draft.getCurrentPack(p.id);
    const pws = findPlayerWs(roomId, p.id);
    if (pws) send(pws, { type: 'pack', payload: pack });
  }

  broadcast(roomId, rm, null, { type: 'round_update', payload: { packIndex: room.draft.packIndex, totalPacks: room.draft.packsPerPlayer, direction: room.draft.direction } });
}

function handleGetPack(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const room = rm.getRoom(roomId);
  if (!room) return;
  const pack = room.draft.getCurrentPack(client.playerId);
  send(ws, { type: 'pack', payload: { ...pack, picked: room.draft.playerPools.get(client.playerId)?.length || 0 } });
}

function handleGetYdk(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const room = rm.getRoom(roomId);
  if (!room) return;
  send(ws, { type: 'ydk', payload: { content: room.draft.generateYdk(client.playerId), playerName: client.playerName, fileName: `${client.playerName}_draft.ydk` } });
}

function handleSwapSeat(ws, { roomId, targetSeat }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const result = rm.swapSeats(roomId, client.playerId, targetSeat);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  broadcast(roomId, rm, null, { type: 'room_update', payload: { room: rm.getRoomPublic(roomId) } });
}

function handleChat(ws, { roomId, text }, rm) {
  const client = clients.get(ws);
  if (!client || !text?.trim()) return;
  const msg = rm.addChat(roomId, client.playerName, text.trim().slice(0, 500));
  if (!msg) return;
  broadcast(roomId, rm, null, { type: 'chat', payload: { name: msg.name, text: msg.text, time: msg.time } });
}

function handleLeave(client, rm) {
  if (!client) return;
  rm.removePlayer(client.roomId, client.playerId);
}

function handleBattleCreate(ws, { roomId }, rm) {
  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: 'Room not found' } });

  // Idempotent: if tables already exist for this room, return them
  const existing = duelManagerRef.getRoomTables(roomId);
  if (existing.length > 0) {
    return send(ws, { type: 'battle_tables_ready', payload: { tables: existing } });
  }

  const tables = duelManagerRef.createBattleTables(room);
  send(ws, { type: 'battle_tables_ready', payload: { tables: tables.map(t => ({
    id: t.id, roomId: t.roomId, state: t.state, seats: t.seats,
  })) } });
}

/* ==================== DUEL HANDLERS ==================== */

async function handleDuelJoin(ws, { tableId, seatIndex }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const result = duelManagerRef.joinTable(tableId, client.playerId, seatIndex ?? 0);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
  send(ws, { type: 'duel_table_joined', payload: pub });
  broadcastDuel(tableId, null, { type: 'duel_table_update', payload: pub });
}

async function handleDuelSubmit(ws, { tableId, ydkContent }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const result = duelManagerRef.submitDeck(tableId, client.playerId, ydkContent);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  send(ws, { type: 'duel_deck_submitted', payload: { success: true, bothReady: result.bothReady } });
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
  broadcastDuel(tableId, null, { type: 'duel_table_update', payload: pub });
  if (result.bothReady) {
    broadcastDuel(tableId, null, { type: 'duel_both_ready', payload: { tableId, message: '双方卡组已提交，可以开始对战！' } });
  }
}

async function handleDuelStart(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const result = await duelManagerRef.startDuel(tableId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
  broadcastDuel(tableId, null, { type: 'duel_started', payload: pub });
  broadcastDuel(tableId, null, { type: 'duel_table_update', payload: pub });
}

async function handleDuelRespond(ws, { tableId, intValue }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const result = await duelManagerRef.respond(tableId, client.playerId, intValue ?? 0);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
  broadcastDuel(tableId, null, { type: 'duel_table_update', payload: pub });
}

function handleDuelGetState(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  send(ws, { type: 'duel_table_update', payload: duelManagerRef.getTablePublic(tableId, client.playerId) });
}

/* ==================== UTILS ==================== */

function findPlayerWs(roomId, playerId) {
  for (const [ws, c] of clients) if (c.roomId === roomId && c.playerId === playerId) return ws;
  return null;
}

function broadcast(roomId, rm, excludeWs, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function broadcastDuel(tableId, excludeWs, msg) {
  const data = JSON.stringify(msg);
  const table = duelManagerRef.tables.get(tableId);
  if (!table) return;
  // Broadcast to EVERYONE in the room — not just seated players.
  // Non-seated players need to see table updates so they can pick available seats.
  for (const [ws, c] of clients) {
    if (c.roomId === table.roomId && ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
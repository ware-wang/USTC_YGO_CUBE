/**
 * WebSocket server for Cube Draft.
 *
 * Uses manual upgrade handling (noServer mode) because multiple
 * WebSocketServer instances sharing one HTTP server with 'path'
 * option causes frame corruption in ws 8.x.
 */

import { WebSocketServer } from 'ws';
import { parse as parseUrl, fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { DRAFT_STATES } from '../draft/index.js';
import { handleYgoproConnection } from '../duel-bridge/ygopro-ws.js';

// Paths for ocgcore resources
const YGO_SCRIPT_PATH = path.join(__dirname, '..', '..', '..', '..', 'ygopro', 'script');
const CARDS_CDB_PATH = path.join(__dirname, '..', '..', 'data');

/** Map ws → { roomId, playerId, playerName, duelSessionId?, duelPosition? } */
const clients = new Map();

let duelManagerRef = null;
let duelBridgeRef = null;

export function createWSServer(httpServer, roomManager, duelManager, duelBridge) {
  duelManagerRef = duelManager;
  duelBridgeRef = duelBridge;

  // ── Manual upgrade routing (noServer mode) ──
  const jsonWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const ygoproWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  jsonWss.on('connection', (ws) => {
    console.log('[WS] New connection');
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }
      handleMessage(ws, msg, roomManager);
    });
    ws.on('close', () => {
      const client = clients.get(ws);
      if (!client) return;

      clients.delete(ws);
      const room = roomManager.disconnectPlayer(client.roomId, client.playerId);
      if (room) {
        broadcast(client.roomId, roomManager, null, {
          type: 'room_update',
          payload: { room: roomManager.getRoomPublic(client.roomId) },
        });
      }
    });
  });

  ygoproWss.on('connection', (ws) => {
    console.log('[WS-Duel] New ygopro binary connection');
    handleYgoproConnection(ws, {
      scriptPath: process.env.YGOPRO_SCRIPT_PATH || YGO_SCRIPT_PATH,
      cardsCdbPath: process.env.YGOPRO_CDB_PATH || CARDS_CDB_PATH,
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = parseUrl(request.url);
    if (pathname === '/ws') {
      jsonWss.handleUpgrade(request, socket, head, (ws) => {
        jsonWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws-duel') {
      ygoproWss.handleUpgrade(request, socket, head, (ws) => {
        ygoproWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  return { jsonWss, ygoproWss };
}

// ── Message routing ──────────────────────────

function handleMessage(ws, msg, roomManager) {
  const { type, payload = {} } = msg;
  switch (type) {
    case 'join_room': return handleJoin(ws, payload, roomManager);
    case 'start_draft': return handleStart(ws, payload, roomManager);
    case 'confirm_pick': return handleConfirmPick(ws, payload, roomManager);
    case 'get_pack': return handleGetPack(ws, payload, roomManager);
    case 'get_ydk': return handleGetYdk(ws, payload, roomManager);
    case 'leave_room': return handleLeave(ws, roomManager);
    case 'swap_seat': return handleSwapSeat(ws, payload, roomManager);
    case 'chat': return handleChat(ws, payload, roomManager);
    case 'duel_join_table': return handleDuelJoin(ws, payload);
    case 'duel_submit_deck': return handleDuelSubmit(ws, payload);
    case 'duel_start': return handleDuelStart(ws, payload);
    case 'duel_respond': return handleDuelRespond(ws, payload);
    case 'duel_get_state': return handleDuelGetState(ws, payload);
    case 'duel_join': return handleDuelNewJoin(ws, payload, roomManager);
    case 'duel_response': return handleDuelResponse(ws, payload);
    case 'duel_surrender': return handleDuelSurrender(ws, payload);
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

// ── Utilities ────────────────────────────────

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(roomId, rm, exclude, msg) {
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && ws !== exclude && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

function broadcastDuel(tableId, exclude, msg) {
  // Broadcast to both players at a duel table
  const table = duelManagerRef?.getTablePublic?.(tableId);
  if (!table) return;
  for (const [ws, c] of clients) {
    if (c.roomId === table.roomId && ws !== exclude && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

function findPlayerWs(roomId, playerId) {
  for (const [ws, c] of clients)
    if (c.roomId === roomId && c.playerId === playerId && ws.readyState === 1) return ws;
  return null;
}

function findClientByPlayer(roomId, playerId) {
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && c.playerId === playerId) return c;
  }
  return null;
}

// ── Room / Draft handlers ────────────────────

function handleJoin(ws, { roomId, playerName, password }, rm) {
  const result = rm.addPlayer(roomId, playerName, password || null);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const { player, room } = result;
  const previousWs = findPlayerWs(room.id, player.id);
  if (previousWs && previousWs !== ws) {
    clients.delete(previousWs);
    try { previousWs.close(4000, 'replaced by reconnect'); }
    catch {}
  }

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

function handleLeave(ws, rm) {
  const client = clients.get(ws);
  if (!client) return;
  clients.delete(ws);
  const room = rm.removePlayer(client.roomId, client.playerId);
  if (room) {
    broadcast(client.roomId, rm, null, {
      type: 'room_update',
      payload: { room: rm.getRoomPublic(client.roomId) },
    });
  }
  try { ws.close(1000, 'leave_room'); }
  catch {}
}

// ── Battle / Duel handlers ───────────────────

function handleBattleCreate(ws, { roomId }, rm) {
  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: 'Room not found' } });
  const tables = duelManagerRef.createBattleTables(room);
  const payload = { tables: tables.map(t => ({ id: t.id, roomId: t.roomId, state: t.state, seats: t.seats })) };
  // Emit both names for compatibility: older clients listen for
  // battle_tables_ready while newer code may expect battle_tables_created.
  broadcast(roomId, rm, null, { type: 'battle_tables_ready', payload });
  broadcast(roomId, rm, null, { type: 'battle_tables_created', payload });
}

function handleDuelJoin(ws, { tableId, seatIndex }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const result = duelManagerRef.joinTable(tableId, client.playerId, seatIndex);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
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
    await launchNeosDuel(tableId, client.roomId);
  }
}

async function launchNeosDuel(tableId, roomId) {
  const tableDecks = duelManagerRef.getTableDecks(tableId);
  if (!tableDecks) {
    console.warn(`[launchNeosDuel] No decks for table ${tableId}`);
    return;
  }

  const passWd = `cube_${tableId.replace(/\W/g, '').slice(0, 14)}`;

  try {
    const { registerPreloadedDecks } = await import('../duel-bridge/ygopro-ws.js');
    registerPreloadedDecks(passWd, [
      { main: tableDecks.players[0].deck.main || [], extra: tableDecks.players[0].deck.extra || [], side: [] },
      { main: tableDecks.players[1].deck.main || [], extra: tableDecks.players[1].deck.extra || [], side: [] },
    ]);

    const neosUrl = '/neos/duelroom';
    const p1Name = findClientByPlayer(roomId, tableDecks.players[0].id)?.playerName || 'Player1';
    const p2Name = findClientByPlayer(roomId, tableDecks.players[1].id)?.playerName || 'Player2';

    console.log(`[launchNeosDuel] Room "${passWd}" created for table ${tableId}`);

    broadcastDuel(tableId, null, {
      type: 'duel_launch_neos',
      payload: {
        passWd,
        neosUrl,
        tableId,
        players: [p1Name, p2Name],
        instructions: `打开链接后会自动带入房间密码 ${passWd} 并尝试连接当前服务器；如果失败，可在页面里手动重连。`,
      },
    });
  } catch (e) {
    console.error('[launchNeosDuel] Failed:', e.message);
    broadcastDuel(tableId, null, {
      type: 'duel_launch_neos',
      payload: { error: '启动对战房间失败: ' + e.message },
    });
  }
}

function handleDuelStart(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  if (typeof duelManagerRef?.startDuel !== 'function') {
    return send(ws, {
      type: 'error',
      payload: { message: '当前版本不再通过 duel_start 手动开局；双方提交卡组后会自动启动浏览器对战。' },
    });
  }

  const result = duelManagerRef.startDuel(tableId, client.playerId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  broadcastDuel(tableId, null, { type: 'duel_started', payload: { tableId, state: result.state } });
}

function handleDuelRespond(ws, { tableId, response }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  if (typeof duelManagerRef?.handleResponse !== 'function') {
    return send(ws, {
      type: 'error',
      payload: { message: '当前版本不再通过 duel_respond 走房间内协议；请在 neos 对战窗口中操作。' },
    });
  }

  const result = duelManagerRef.handleResponse(tableId, client.playerId, response);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
}

function handleDuelGetState(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return;
  const pub = duelManagerRef.getTablePublic(tableId, client.playerId);
  send(ws, { type: 'duel_table_update', payload: pub });
}

// ── New OCG core duel handlers (from duel-bridge) ──

function handleDuelNewJoin(ws, { roomId, position }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  client.duelPosition = position;
  const room = rm.getRoom(roomId);
  if (!room) return;
  send(ws, { type: 'duel_joined', payload: { position } });
}

function handleDuelResponse(ws, { sessionId, response }) {
  const client = clients.get(ws);
  if (!client) return;
  duelBridgeRef.sendResponse(sessionId, client.duelPosition || 0, response);
}

function handleDuelSurrender(ws, { sessionId }) {
  const client = clients.get(ws);
  if (!client) return;
  duelBridgeRef.surrender(sessionId, client.duelPosition || 0);
}

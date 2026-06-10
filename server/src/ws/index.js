/**
 * WebSocket server for Cube Draft.
 *
 * Uses manual upgrade handling (noServer mode) because multiple
 * WebSocketServer instances sharing one HTTP server with 'path'
 * option causes frame corruption in ws 8.x.
 */

import { WebSocketServer } from 'ws';
import { parse as parseUrl } from 'url';
import { DRAFT_STATES } from '../draft/index.js';
import { handleYgoproConnection } from '../duel-bridge/ygopro-ws.js';
import { getCardScriptStatus } from '../duel-bridge/card-script-status.js';
import { getConnectionInfo, logRoomEvent } from '../draft-log/index.js';

/** Map ws → { roomId, playerId, playerName, duelSessionId?, duelPosition? } */
const clients = new Map();
const connectionInfoByWs = new Map();
const DRAFT_PICK_TIMEOUT_MS = parseInt(process.env.DRAFT_PICK_TIMEOUT_MS || '60000', 10);
const DRAFT_DISCONNECT_GRACE_MS = parseInt(process.env.DRAFT_DISCONNECT_GRACE_MS || '60000', 10);
const draftRoundTimers = new Map();
const draftDisconnectTimers = new Map();
const flipTurnTimers = new Map();

let duelManagerRef = null;
let duelBridgeRef = null;
let duelResourceOptionsRef = {};

export function createWSServer(httpServer, roomManager, duelManager, duelBridge, duelResourceOptions = {}) {
  duelManagerRef = duelManager;
  duelBridgeRef = duelBridge;
  duelResourceOptionsRef = duelResourceOptions || {};
  roomManager.onRoomDeleted?.((room, reason) => {
    clearDraftRoundTimer(room.id);
    clearRoomDisconnectedDraftPicks(room.id);
    clearFlipTurnTimer(room.id);
    logRoomEvent(room.id, 'room_deleted', {
      reason: reason || null,
      room: summarizeRoom(room),
      players: summarizePlayers(room),
      draft: summarizeDraft(room),
    });
    duelManagerRef?.deleteRoomTables?.(room.id);
    closeRoomClients(room.id, reason);
  });

  // ── Manual upgrade routing (noServer mode) ──
  const jsonWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const ygoproWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  jsonWss.on('connection', (ws, request) => {
    connectionInfoByWs.set(ws, getConnectionInfo(request));
    console.log('[WS] New connection');
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }
      handleMessage(ws, msg, roomManager);
    });
    ws.on('close', (code, reasonBuffer) => {
      const client = clients.get(ws);
      connectionInfoByWs.delete(ws);
      if (!client) return;

      clients.delete(ws);
      const room = roomManager.disconnectPlayer(client.roomId, client.playerId);
      if (room) {
        logRoomEvent(client.roomId, 'player_disconnected', {
          player: summarizePlayer(room.players.find(p => p.id === client.playerId), client),
          connection: client.connection,
          close: {
            code,
            reason: reasonBuffer ? reasonBuffer.toString() : '',
          },
          draft: summarizeDraft(room),
        });
        broadcast(client.roomId, roomManager, null, {
          type: 'room_update',
          payload: { room: roomManager.getRoomPublic(client.roomId) },
        });
        scheduleDisconnectedDraftPick(client.roomId, client.playerId, roomManager, room);
      }
    });
  });

  ygoproWss.on('connection', (ws) => {
    console.log('[WS-Duel] New ygopro binary connection');
    handleYgoproConnection(ws, {
      scriptPath: duelResourceOptions.scriptPath || null,
      cardsCdbPath: duelResourceOptions.cardsCdbPath || null,
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
    case 'flip_buy_card': return handleFlipBuyCard(ws, payload, roomManager);
    case 'flip_pass_turn': return handleFlipPassTurn(ws, payload, roomManager);
    case 'flip_get_state': return handleFlipGetState(ws, payload, roomManager);
    case 'get_ydk': return handleGetYdk(ws, payload, roomManager);
    case 'save_deck': return handleSaveDeck(ws, payload, roomManager);
    case 'leave_room': return handleLeave(ws, roomManager);
    case 'swap_seat': return handleSwapSeat(ws, payload, roomManager);
    case 'chat': return handleChat(ws, payload, roomManager);
    case 'duel_join_table': return handleDuelJoin(ws, payload);
    case 'duel_leave_table': return handleDuelLeave(ws, payload);
    case 'duel_rematch_table': return handleDuelRematch(ws, payload);
    case 'duel_submit_deck': return handleDuelSubmit(ws, payload, roomManager);
    case 'duel_start': return handleDuelStart(ws, payload);
    case 'duel_respond': return handleDuelRespond(ws, payload);
    case 'duel_get_state': return handleDuelGetState(ws, payload);
    case 'duel_join': return handleDuelNewJoin(ws, payload, roomManager);
    case 'duel_response': return handleDuelResponse(ws, payload);
    case 'duel_surrender': return handleDuelSurrender(ws, payload);
    case 'battle_create_tables': return handleBattleCreate(ws, payload, roomManager);
    case 'battle_join_table': return handleDuelJoin(ws, payload);
    case 'battle_leave_table': return handleDuelLeave(ws, payload);
    case 'battle_rematch_table': return handleDuelRematch(ws, payload);
    case 'battle_submit_deck': return handleDuelSubmit(ws, payload, roomManager);
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

function getWsConnection(ws) {
  return connectionInfoByWs.get(ws) || {
    ip: null,
    forwardedFor: null,
    realIp: null,
    cfIp: null,
    remoteAddress: null,
    userAgent: null,
  };
}

function summarizePlayer(player, client = null) {
  if (!player && !client) return null;
  return {
    id: player?.id || client?.playerId || null,
    name: player?.name || client?.playerName || null,
    seatIndex: Number.isInteger(player?.seatIndex) ? player.seatIndex : null,
    connected: player ? !player.disconnectedAt : null,
  };
}

function summarizePlayers(room) {
  return (room?.players || []).map(player => summarizePlayer(player));
}

function summarizeRoom(room) {
  if (!room) return null;
  return {
    id: room.id,
    name: room.name,
    cubeName: room.cubeName,
    state: room.state,
    maxPlayers: room.maxPlayers,
    packsPerPlayer: room.packsPerPlayer,
    cardsPerPack: room.cardsPerPack,
    draftMode: room.draftMode || 'classic',
    flipTargetCards: room.flipTargetCards || null,
    flipMarketRowSize: room.flipMarketRowSize || null,
    testMode: room.testMode === true,
  };
}

function summarizeDraft(room) {
  const draft = room?.draft;
  if (!draft) return null;
  if (room?.draftMode === 'flip') {
    const activePlayer = draft.getActivePlayer?.();
    return {
      mode: 'flip',
      state: draft.state,
      turnNumber: draft.turnNumber,
      pickRound: draft.pickRound,
      activePlayerId: activePlayer?.id || null,
      activePlayerName: activePlayer?.name || null,
      remainingFunds: draft.remainingFunds,
      turnBoughtCount: draft.turnBoughtCount || 0,
      turnFunds: draft.turnFunds,
      targetCards: draft.targetCards,
      rowSize: draft.rowSize,
      drawRemaining: draft.drawPile?.length || 0,
      trashCount: draft.trash?.length || 0,
      cubeExhausted: draft.cubeExhausted === true,
      totalPlayers: draft.players?.length || room?.players?.length || 0,
    };
  }
  return {
    mode: 'classic',
    state: draft.state,
    packIndex: draft.packIndex,
    totalPacks: draft.packsPerPlayer,
    pickRound: draft.pickRound,
    direction: draft.direction,
    confirmedCount: draft.confirmedThisRound?.size || 0,
    totalPlayers: draft.players?.length || room?.players?.length || 0,
  };
}

function summarizeCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    name: card.name || null,
    type: card.type || 0,
    packSlot: Number.isInteger(card.packSlot) ? card.packSlot : null,
    marketSlot: Number.isInteger(card.marketSlot) ? card.marketSlot : null,
    cost: Number.isInteger(card.cost) ? card.cost : null,
  };
}

function summarizePack(pack) {
  if (!pack) return null;
  return {
    packIndex: pack.packIndex,
    totalPacks: pack.totalPacks,
    remaining: pack.remaining,
    direction: pack.direction,
    confirmed: pack.confirmed === true,
    picked: pack.picked || 0,
    cards: (pack.cards || []).map(summarizeCard),
  };
}

function findPackCard(pack, cardIndex, fallbackCardId = null) {
  const cards = pack?.cards || [];
  const slot = cardIndex === null || cardIndex === undefined ? NaN : Number(cardIndex);
  return (Number.isInteger(slot) ? cards.find(card => card.packSlot === slot) : null) ||
    cards.find(card => Number(card.id) === Number(fallbackCardId)) ||
    null;
}

function lastPickedCard(room, playerId, fallbackCardId = null) {
  const cards = room?.draft?.getPlayerPoolCards(playerId) || [];
  return cards[cards.length - 1] || (fallbackCardId ? { id: fallbackCardId } : null);
}

function summarizePools(room) {
  const pools = room?.draft?.getPlayerPools?.() || {};
  const result = {};
  for (const [playerId, pool] of Object.entries(pools)) {
    result[playerId] = {
      name: pool.name,
      cardIds: pool.cardIds,
      count: pool.cardIds?.length || 0,
    };
  }
  return result;
}

function summarizeBattleTable(tableId) {
  const table = duelManagerRef?.getTablePublic?.(tableId);
  if (!table) return { id: tableId };
  return {
    id: table.id,
    roomId: table.roomId,
    state: table.state,
    seats: table.seats,
    winner: table.winner ?? null,
    winnerSeat: table.winnerSeat ?? null,
  };
}

function broadcast(roomId, rm, exclude, msg) {
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && ws !== exclude && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

function broadcastDuel(tableId, exclude, msg) {
  // Broadcast table status to everyone in the draft room so the lobby stays in sync.
  const table = duelManagerRef?.getTablePublic?.(tableId);
  if (!table) return;
  for (const [ws, c] of clients) {
    if (c.roomId === table.roomId && ws !== exclude && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

function broadcastRoomBattleTables(roomId) {
  const tables = duelManagerRef?.getRoomTables?.(roomId) || [];
  broadcast(roomId, null, null, {
    type: 'battle_tables_ready',
    payload: { tables },
  });
}

function serializeBattleTable(t) {
  return {
    id: t.id,
    roomId: t.roomId,
    state: t.state,
    seats: t.seats,
    winner: t.winner ?? null,
    winnerSeat: t.winnerSeat ?? null,
  };
}

function getOrCreateBattleTables(room) {
  const existing = duelManagerRef?.getRoomTables?.(room.id) || [];
  if (existing.length > 0) return existing;
  return (duelManagerRef?.createBattleTables?.(room) || []).map(serializeBattleTable);
}

function handleNeosDuelEnded({ tableId, winnerPosition }) {
  if (!tableId) return;
  const table = duelManagerRef?.markTableFinished?.(tableId, winnerPosition);
  if (!table) return;
  logRoomEvent(table.roomId, 'duel_finished', {
    table: serializeBattleTable(table),
    winnerPosition: Number.isInteger(winnerPosition) ? winnerPosition : null,
  });
  broadcastRoomBattleTables(table.roomId);
}

function sendDuelToTablePlayers(tableId, msg) {
  const table = duelManagerRef?.getTablePublic?.(tableId);
  if (!table) return;

  const playerIds = new Set(
    (table.seats || [])
      .map(seat => typeof seat === 'object' ? seat?.id : seat)
      .filter(Boolean),
  );

  for (const [ws, c] of clients) {
    if (
      c.roomId === table.roomId &&
      playerIds.has(c.playerId) &&
      ws.readyState === 1
    ) {
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

function isDraftingRoom(room) {
  return room?.state === DRAFT_STATES.DRAFTING && room.draft?.state === DRAFT_STATES.DRAFTING;
}

function isClassicDraftingRoom(room) {
  return isDraftingRoom(room) && (room.draftMode || 'classic') === 'classic';
}

function isFlipDraftingRoom(room) {
  return isDraftingRoom(room) && room.draftMode === 'flip';
}

function draftDisconnectKey(roomId, playerId) {
  return `${roomId}:${playerId}`;
}

function clearDraftRoundTimer(roomId) {
  const timer = draftRoundTimers.get(roomId);
  if (timer) clearTimeout(timer.timeout);
  draftRoundTimers.delete(roomId);
}

function clearDisconnectedDraftPick(roomId, playerId) {
  const key = draftDisconnectKey(roomId, playerId);
  const timer = draftDisconnectTimers.get(key);
  if (timer) clearTimeout(timer.timeout);
  draftDisconnectTimers.delete(key);
}

function clearRoomDisconnectedDraftPicks(roomId) {
  for (const [key, timer] of draftDisconnectTimers) {
    if (key.startsWith(`${roomId}:`)) {
      clearTimeout(timer.timeout);
      draftDisconnectTimers.delete(key);
    }
  }
}

function clearFlipTurnTimer(roomId) {
  const timer = flipTurnTimers.get(roomId);
  if (timer) clearTimeout(timer.timeout);
  flipTurnTimers.delete(roomId);
}

function closeRoomClients(roomId, reason) {
  for (const [ws, c] of clients) {
    if (c.roomId !== roomId) continue;
    clients.delete(ws);
    connectionInfoByWs.delete(ws);
    send(ws, { type: 'error', payload: { message: '房间已关闭' } });
    try { ws.close(4001, `room deleted: ${reason || 'cleanup'}`); }
    catch {}
  }
}

function scheduleFlipTurnTimer(roomId, rm, room = null) {
  room = room || rm.getRoom(roomId);
  if (!isFlipDraftingRoom(room)) return;

  clearFlipTurnTimer(roomId);
  const activePlayer = room.draft.getActivePlayer?.();
  if (!activePlayer) return;

  const turnNumber = room.draft.turnNumber;
  const pickRound = room.draft.pickRound;
  const activePlayerId = activePlayer.id;
  const elapsedMs = room.draft.turnStartedAt ? Date.now() - room.draft.turnStartedAt : 0;
  const delayMs = Math.max(0, DRAFT_PICK_TIMEOUT_MS - elapsedMs);
  const timeout = setTimeout(() => {
    flipTurnTimers.delete(roomId);
    autoPassFlipTurn(roomId, rm, turnNumber, pickRound, activePlayerId, 'timeout');
  }, delayMs);
  timeout.unref?.();
  flipTurnTimers.set(roomId, { timeout, turnNumber, pickRound, activePlayerId });
}

function autoPassFlipTurn(roomId, rm, turnNumber, pickRound, activePlayerId, reason) {
  const room = rm.getRoom(roomId);
  if (!isFlipDraftingRoom(room)) return;
  if (room.draft.turnNumber !== turnNumber || room.draft.pickRound !== pickRound) return;
  const activePlayer = room.draft.getActivePlayer?.();
  if (!activePlayer || activePlayer.id !== activePlayerId) return;

  const stateBefore = room.draft.getPublicState(activePlayerId, { turnTimeoutMs: DRAFT_PICK_TIMEOUT_MS });
  const affordableCards = (stateBefore.market?.rows || [])
    .flatMap(row => row.cards || [])
    .filter(card => card.cost <= stateBefore.remainingFunds);
  if (affordableCards.length > 0) {
    const card = affordableCards[Math.floor(Math.random() * affordableCards.length)];
    const result = room.draft.buyCard(activePlayerId, card.marketSlot, card.id);
    if (result.error) {
      logRoomEvent(roomId, 'flip_auto_buy_failed', {
        reason,
        error: result.error,
        player: summarizePlayer(room.players.find(p => p.id === activePlayerId)),
        draft: summarizeDraft(room),
        state: summarizeFlipState(stateBefore),
        card: summarizeCard(card),
      });
      return;
    }

    room.lastActive = Date.now();
    logRoomEvent(roomId, 'flip_card_bought', {
      automatic: true,
      reason,
      player: summarizePlayer(room.players.find(p => p.id === activePlayerId)),
      draft: summarizeDraft(room),
      card: summarizeCard(card),
      result: {
        pickedCardId: result.pickedCardId,
        spent: result.spent,
        remainingFunds: result.remainingFunds,
        turnAdvanced: result.turnAdvanced === true,
        marketRefreshed: result.marketRefreshed === true,
        draftComplete: result.draftComplete === true,
        picked: result.picked,
      },
    });
    handleFlipAdvanced(roomId, rm, room, result, 'timeout_auto_buy');
    return;
  }

  const result = room.draft.passTurn(activePlayerId);
  if (result.error) {
    logRoomEvent(roomId, 'flip_pass_failed', {
      automatic: true,
      reason,
      error: result.error,
      player: summarizePlayer(room.players.find(p => p.id === activePlayerId)),
      draft: summarizeDraft(room),
    });
    return;
  }

  room.lastActive = Date.now();
  logRoomEvent(roomId, 'flip_turn_passed', {
    automatic: true,
    reason,
    player: summarizePlayer(room.players.find(p => p.id === activePlayerId)),
    draft: summarizeDraft(room),
    result: {
      turnAdvanced: result.turnAdvanced === true,
      marketRefreshed: result.marketRefreshed === true,
      draftComplete: result.draftComplete === true,
    },
  });
  handleFlipAdvanced(roomId, rm, room, result);
}

function scheduleDraftRoundTimer(roomId, rm, room = null) {
  room = room || rm.getRoom(roomId);
  if (!isClassicDraftingRoom(room)) return;

  clearDraftRoundTimer(roomId);
  const round = room.draft.pickRound;
  const timeout = setTimeout(() => {
    draftRoundTimers.delete(roomId);
    autoPickUnconfirmed(roomId, rm, round, 'timeout');
  }, DRAFT_PICK_TIMEOUT_MS);
  timeout.unref?.();
  draftRoundTimers.set(roomId, { timeout, round });
}

function scheduleDisconnectedDraftPick(roomId, playerId, rm, room = null) {
  room = room || rm.getRoom(roomId);
  if (!isClassicDraftingRoom(room)) return;
  if (room.draft.confirmedThisRound?.has(playerId)) return;

  const player = room.players.find(p => p.id === playerId);
  if (!player?.disconnectedAt) return;

  clearDisconnectedDraftPick(roomId, playerId);
  const round = room.draft.pickRound;
  const key = draftDisconnectKey(roomId, playerId);
  const timeout = setTimeout(() => {
    draftDisconnectTimers.delete(key);
    const currentRoom = rm.getRoom(roomId);
    if (!isClassicDraftingRoom(currentRoom)) return;
    if (currentRoom.draft.pickRound !== round) return;
    if (currentRoom.draft.confirmedThisRound?.has(playerId)) return;

    const currentPlayer = currentRoom.players.find(p => p.id === playerId);
    if (!currentPlayer?.disconnectedAt) return;

    autoPickPlayer(roomId, rm, currentRoom, playerId, 'disconnect');
  }, DRAFT_DISCONNECT_GRACE_MS);
  timeout.unref?.();
  draftDisconnectTimers.set(key, { timeout, round });
}

function scheduleDisconnectedDraftPicksForRoom(roomId, rm, room = null) {
  room = room || rm.getRoom(roomId);
  if (!isClassicDraftingRoom(room)) return;
  for (const player of room.players) {
    if (player.disconnectedAt) scheduleDisconnectedDraftPick(roomId, player.id, rm, room);
  }
}

function autoPickUnconfirmed(roomId, rm, round, reason) {
  const room = rm.getRoom(roomId);
  if (!isClassicDraftingRoom(room)) return;
  if (room.draft.pickRound !== round) return;

  logRoomEvent(roomId, 'auto_pick_unconfirmed_started', {
    reason,
    draft: summarizeDraft(room),
    unconfirmedPlayers: (room.draft.players || room.players)
      .filter(player => !room.draft.confirmedThisRound.has(player.id))
      .map(player => summarizePlayer(room.players.find(p => p.id === player.id) || player)),
  });

  const players = room.draft.players || room.players;
  for (const player of players) {
    if (room.draft.pickRound !== round) break;
    if (room.draft.confirmedThisRound.has(player.id)) continue;
    const result = autoPickPlayer(roomId, rm, room, player.id, reason);
    if (result?.allConfirmed) break;
  }
}

function autoPickPlayer(roomId, rm, room, playerId, reason) {
  const player = room.players.find(p => p.id === playerId);
  const draftBefore = summarizeDraft(room);
  const packBefore = room.draft.getCurrentPack(playerId);
  const result = room.draft.autoPick(playerId);
  if (result.error) {
    logRoomEvent(roomId, 'auto_pick_failed', {
      reason,
      error: result.error,
      player: summarizePlayer(player),
      connection: player?.lastConnection || null,
      draft: draftBefore,
      pack: summarizePack(packBefore),
    });
    console.warn(`[Draft] Auto-pick failed room=${roomId} player=${playerId}: ${result.error}`);
    return result;
  }

  room.lastActive = Date.now();
  logRoomEvent(roomId, 'card_picked', {
    automatic: true,
    reason,
    player: summarizePlayer(player),
    connection: player?.lastConnection || null,
    draft: draftBefore,
    card: summarizeCard(findPackCard(packBefore, null, result.pickedCardId) || lastPickedCard(room, playerId, result.pickedCardId)),
    result: {
      pickedCardId: result.pickedCardId,
      allConfirmed: result.allConfirmed === true,
      confirmedCount: result.confirmedCount,
      totalPlayers: result.totalPlayers,
      draftComplete: result.draftComplete === true,
    },
  });
  sendPickResult(roomId, room, playerId, result, true, reason);
  broadcastConfirmState(roomId, rm, room, result);

  if (result.allConfirmed) {
    handleDraftAdvanced(roomId, rm, room, result);
  }

  return result;
}

function sendPickResult(roomId, room, playerId, result, autoPicked = false, reason = null) {
  const pws = findPlayerWs(roomId, playerId);
  if (!pws) return;

  send(pws, {
    type: 'pick_result',
    payload: {
      pickedCardId: result.pickedCardId,
      success: true,
      confirmedCount: result.confirmedCount,
      totalPlayers: result.totalPlayers,
      pickedCards: room.draft.getPlayerPoolCards(playerId),
      autoPicked,
      reason,
    },
  });
}

function broadcastConfirmState(roomId, rm, room, result = null) {
  const allConfirmed = result?.allConfirmed === true;
  const players = room.draft.players || room.players;
  const confirmedIds = allConfirmed
    ? players.map(p => p.id)
    : [...room.draft.confirmedThisRound];
  const namesById = new Map(room.players.map(p => [p.id, p.name]));
  const who = confirmedIds
    .map(id => namesById.get(id) || players.find(p => p.id === id)?.name)
    .filter(Boolean);

  broadcast(roomId, rm, null, {
    type: 'confirm_update',
    payload: {
      confirmedCount: allConfirmed ? players.length : room.draft.confirmedThisRound.size,
      totalPlayers: players.length,
      whoConfirmed: who,
    },
  });
}

function sendCurrentPacks(roomId, room, reason = 'round_advance') {
  const players = room.draft.players || room.players;
  for (const p of players) {
    const pack = room.draft.getCurrentPack(p.id);
    const pws = findPlayerWs(roomId, p.id);
    if (pws && pack) {
      const client = clients.get(pws);
      send(pws, { type: 'pack', payload: pack });
      logRoomEvent(roomId, 'pack_sent', {
        reason,
        player: summarizePlayer(room.players.find(player => player.id === p.id), client),
        connection: client?.connection || null,
        draft: summarizeDraft(room),
        pack: summarizePack(pack),
      });
    }
  }
}

function sendFlipState(roomId, room, playerId, reason = 'state_update') {
  const pws = findPlayerWs(roomId, playerId);
  if (!pws || typeof room.draft.getPublicState !== 'function') return;
  const client = clients.get(pws);
  const payload = room.draft.getPublicState(playerId, {
    turnTimeoutMs: DRAFT_PICK_TIMEOUT_MS,
  });
  send(pws, { type: 'flip_state', payload });
  logRoomEvent(roomId, 'flip_state_sent', {
    reason,
    player: summarizePlayer(room.players.find(player => player.id === playerId), client),
    connection: client?.connection || null,
    draft: summarizeDraft(room),
    state: summarizeFlipState(payload),
  });
}

function broadcastFlipState(roomId, rm, room, reason = 'state_update') {
  for (const player of room.players) {
    sendFlipState(roomId, room, player.id, reason);
  }
}

function summarizeFlipState(state) {
  if (!state) return null;
  return {
    activePlayerId: state.activePlayerId,
    activePlayerName: state.activePlayerName,
    remainingFunds: state.remainingFunds,
    turnBoughtCount: state.turnBoughtCount,
    drawRemaining: state.drawRemaining,
    trashCount: state.trashCount,
    cubeExhausted: state.cubeExhausted === true,
    picked: state.picked,
    rows: (state.market?.rows || []).map(row => ({
      cost: row.cost,
      count: row.cards?.length || 0,
      cards: (row.cards || []).map(summarizeCard),
    })),
    progress: state.playerProgress || [],
  };
}

function buildDraftStartedPayload(room) {
  if (room?.draftMode === 'flip') {
    return {
      mode: 'flip',
      targetCards: room.flipTargetCards || room.draft?.targetCards || 45,
      rowSize: room.flipMarketRowSize || room.draft?.rowSize || 4,
      turnFunds: room.draft?.turnFunds || 4,
    };
  }
  return {
    mode: 'classic',
    totalRounds: room?.packsPerPlayer,
    totalPacks: room?.packsPerPlayer,
    cardsPerPack: room?.cardsPerPack,
  };
}

function handleDraftAdvanced(roomId, rm, room, result) {
  clearDraftRoundTimer(roomId);
  clearRoomDisconnectedDraftPicks(roomId);
  room.lastActive = Date.now();

  if (result.draftComplete) {
    room.state = DRAFT_STATES.COMPLETE;
    const tables = getOrCreateBattleTables(room);
    logRoomEvent(roomId, 'draft_completed', {
      draft: summarizeDraft(room),
      pools: summarizePools(room),
      tables,
    });
    broadcast(roomId, rm, null, {
      type: 'draft_complete',
      payload: { mode: room.draftMode || 'classic', pools: room.draft.getPlayerPools(), tables },
    });
    return;
  }

  logRoomEvent(roomId, 'round_advanced', {
    draft: summarizeDraft(room),
  });
  sendCurrentPacks(roomId, room, 'round_advance');
  broadcast(roomId, rm, null, { type: 'round_update', payload: { packIndex: room.draft.packIndex, totalPacks: room.draft.packsPerPlayer, direction: room.draft.direction } });
  scheduleDraftRoundTimer(roomId, rm, room);
  scheduleDisconnectedDraftPicksForRoom(roomId, rm, room);
}

function handleFlipAdvanced(roomId, rm, room, result, reason = 'state_update') {
  clearFlipTurnTimer(roomId);
  room.lastActive = Date.now();

  if (result.draftComplete) {
    room.state = DRAFT_STATES.COMPLETE;
    const tables = getOrCreateBattleTables(room);
    logRoomEvent(roomId, 'draft_completed', {
      draft: summarizeDraft(room),
      pools: summarizePools(room),
      tables,
    });
    broadcast(roomId, rm, null, {
      type: 'draft_complete',
      payload: { mode: room.draftMode || 'classic', pools: room.draft.getPlayerPools(), tables },
    });
    return;
  }

  logRoomEvent(roomId, 'flip_turn_updated', {
    reason,
    draft: summarizeDraft(room),
  });
  broadcastFlipState(roomId, rm, room, reason);
  scheduleFlipTurnTimer(roomId, rm, room);
}

// ── Room / Draft handlers ────────────────────

function handleJoin(ws, { roomId, playerName, password }, rm) {
  const result = rm.addPlayer(roomId, playerName, password || null);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const { player, room } = result;
  const connection = getWsConnection(ws);
  const previousWs = findPlayerWs(room.id, player.id);
  if (previousWs && previousWs !== ws) {
    const previousClient = clients.get(previousWs);
    logRoomEvent(room.id, 'player_connection_replaced', {
      player: summarizePlayer(player),
      previousConnection: previousClient?.connection || getWsConnection(previousWs),
      newConnection: connection,
      draft: summarizeDraft(room),
    });
    clients.delete(previousWs);
    try { previousWs.close(4000, 'replaced by reconnect'); }
    catch {}
  }

  player.lastConnection = connection;
  clients.set(ws, { roomId: room.id, playerId: player.id, playerName, connection });
  clearDisconnectedDraftPick(room.id, player.id);
  logRoomEvent(room.id, result.reconnected ? 'player_reconnected' : 'player_joined', {
    player: summarizePlayer(player),
    connection,
    room: summarizeRoom(room),
    draft: summarizeDraft(room),
  });

  const pub = rm.getRoomPublic(roomId);
  send(ws, { type: 'joined', payload: { playerId: player.id, playerName: player.name, room: pub, reconnected: !!result.reconnected } });

  if (pub.chat?.length) send(ws, { type: 'chat_history', payload: { messages: pub.chat } });

  broadcast(roomId, rm, ws, { type: 'room_update', payload: { room: rm.getRoomPublic(roomId) } });

  if (isDraftingRoom(room)) {
    send(ws, {
      type: 'draft_started',
      payload: buildDraftStartedPayload(room),
    });
    if (room.draftMode === 'flip') {
      sendFlipState(room.id, room, player.id, 'join_during_draft');
      scheduleFlipTurnTimer(room.id, rm, room);
    } else {
      const pack = room.draft.getCurrentPack(player.id);
      if (pack) {
        send(ws, { type: 'pack', payload: pack });
        logRoomEvent(room.id, 'pack_sent', {
          reason: 'join_during_draft',
          player: summarizePlayer(player),
          connection,
          draft: summarizeDraft(room),
          pack: summarizePack(pack),
        });
      }
    }
  } else if (room.state === DRAFT_STATES.COMPLETE || room.draft?.state === DRAFT_STATES.COMPLETE) {
    const tables = getOrCreateBattleTables(room);
    send(ws, {
      type: 'draft_complete',
      payload: {
        mode: room.draftMode || 'classic',
        pools: room.draft.getPlayerPools(),
        savedDeck: room.playerDecks?.get(player.id) || null,
        tables,
        resumeView: 'battleLobby',
      },
    });
  }
}

function handleStart(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const result = rm.startDraft(roomId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const room = rm.getRoom(roomId);
  logRoomEvent(roomId, 'draft_started', {
    host: summarizePlayer(room.players.find(p => p.id === client.playerId), client),
    connection: client.connection,
    room: summarizeRoom(room),
    players: summarizePlayers(room),
    draft: summarizeDraft(room),
  });
  broadcast(roomId, rm, null, { type: 'draft_started', payload: buildDraftStartedPayload(room) });

  if (room.draftMode === 'flip') {
    broadcastFlipState(roomId, rm, room, 'draft_start');
    scheduleFlipTurnTimer(roomId, rm, room);
  } else {
    sendCurrentPacks(roomId, room, 'draft_start');
    scheduleDraftRoundTimer(roomId, rm, room);
    scheduleDisconnectedDraftPicksForRoom(roomId, rm, room);
  }
}

function handleConfirmPick(ws, { roomId, cardIndex, cardId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });
  if (room.draftMode === 'flip') {
    return send(ws, { type: 'error', payload: { message: '翻翻乐模式请使用公共池购买' } });
  }
  const player = room.players.find(p => p.id === client.playerId);
  const draftBefore = summarizeDraft(room);
  const packBefore = room.draft.getCurrentPack(client.playerId);
  const requestedCard = findPackCard(packBefore, cardIndex, cardId);
  const expectedCardId = Number(cardId);
  if (!Number.isInteger(expectedCardId) || expectedCardId <= 0) {
    logRoomEvent(roomId, 'pick_rejected', {
      reason: 'invalid_client_card_id',
      player: summarizePlayer(player, client),
      connection: client.connection,
      draft: draftBefore,
      request: { cardIndex, cardId },
      pack: summarizePack(packBefore),
    });
    return send(ws, { type: 'error', payload: { message: '客户端版本过旧，请刷新页面后重新选择' } });
  }

  const result = room.draft.confirmPick(client.playerId, cardIndex, expectedCardId);
  if (result.error) {
    logRoomEvent(roomId, 'pick_rejected', {
      reason: 'draft_engine_error',
      error: result.error,
      player: summarizePlayer(player, client),
      connection: client.connection,
      draft: draftBefore,
      request: { cardIndex, cardId: expectedCardId },
      requestedCard: summarizeCard(requestedCard),
      pack: summarizePack(packBefore),
    });
    return send(ws, { type: 'error', payload: { message: result.error } });
  }
  room.lastActive = Date.now();
  clearDisconnectedDraftPick(roomId, client.playerId);
  logRoomEvent(roomId, 'card_picked', {
    automatic: false,
    reason: 'manual',
    player: summarizePlayer(player, client),
    connection: client.connection,
    draft: draftBefore,
    request: { cardIndex, cardId: expectedCardId },
    card: summarizeCard(requestedCard || lastPickedCard(room, client.playerId, result.pickedCardId)),
    result: {
      pickedCardId: result.pickedCardId,
      allConfirmed: result.allConfirmed === true,
      confirmedCount: result.confirmedCount,
      totalPlayers: result.totalPlayers,
      draftComplete: result.draftComplete === true,
    },
  });

  sendPickResult(roomId, room, client.playerId, result);
  broadcastConfirmState(roomId, rm, room, result);

  if (!result.allConfirmed) return;
  handleDraftAdvanced(roomId, rm, room, result);
}

function handleGetPack(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const room = rm.getRoom(roomId);
  if (!room) return;
  if (room.draftMode === 'flip') {
    sendFlipState(roomId, room, client.playerId, 'client_request');
    return;
  }
  const pack = room.draft.getCurrentPack(client.playerId);
  if (!pack) return;
  const payload = { ...pack, picked: room.draft.playerPools.get(client.playerId)?.length || 0 };
  send(ws, { type: 'pack', payload });
  logRoomEvent(roomId, 'pack_sent', {
    reason: 'client_request',
    player: summarizePlayer(room.players.find(player => player.id === client.playerId), client),
    connection: client.connection,
    draft: summarizeDraft(room),
    pack: summarizePack(payload),
  });
}

function handleFlipBuyCard(ws, { roomId, marketSlot, cardId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (roomId && roomId !== client.roomId) {
    return send(ws, { type: 'error', payload: { message: '房间不匹配' } });
  }
  const room = rm.getRoom(client.roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });
  if (room.draftMode !== 'flip') {
    return send(ws, { type: 'error', payload: { message: '当前房间不是翻翻乐模式' } });
  }

  const expectedCardId = Number(cardId);
  if (!Number.isInteger(expectedCardId) || expectedCardId <= 0) {
    return send(ws, { type: 'error', payload: { message: '客户端版本过旧，请刷新页面后重新选择' } });
  }

  const draftBefore = summarizeDraft(room);
  const stateBefore = room.draft.getPublicState(client.playerId, { turnTimeoutMs: DRAFT_PICK_TIMEOUT_MS });
  const requestedCard = findFlipMarketCard(stateBefore, marketSlot, expectedCardId);
  const result = room.draft.buyCard(client.playerId, marketSlot, expectedCardId);
  const player = room.players.find(p => p.id === client.playerId);
  if (result.error) {
    logRoomEvent(client.roomId, 'flip_buy_rejected', {
      error: result.error,
      player: summarizePlayer(player, client),
      connection: client.connection,
      draft: draftBefore,
      request: { marketSlot, cardId: expectedCardId },
      requestedCard: summarizeCard(requestedCard),
      state: summarizeFlipState(stateBefore),
    });
    return send(ws, { type: 'error', payload: { message: result.error } });
  }

  room.lastActive = Date.now();
  logRoomEvent(client.roomId, 'flip_card_bought', {
    automatic: false,
    player: summarizePlayer(player, client),
    connection: client.connection,
    draft: draftBefore,
    request: { marketSlot, cardId: expectedCardId },
    card: summarizeCard(requestedCard),
    result: {
      pickedCardId: result.pickedCardId,
      spent: result.spent,
      remainingFunds: result.remainingFunds,
      turnAdvanced: result.turnAdvanced === true,
      marketRefreshed: result.marketRefreshed === true,
      draftComplete: result.draftComplete === true,
      picked: result.picked,
    },
  });

  handleFlipAdvanced(client.roomId, rm, room, result, 'card_bought');
}

function handleFlipPassTurn(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (roomId && roomId !== client.roomId) {
    return send(ws, { type: 'error', payload: { message: '房间不匹配' } });
  }
  const room = rm.getRoom(client.roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });
  if (room.draftMode !== 'flip') {
    return send(ws, { type: 'error', payload: { message: '当前房间不是翻翻乐模式' } });
  }

  const draftBefore = summarizeDraft(room);
  const result = room.draft.passTurn(client.playerId);
  const player = room.players.find(p => p.id === client.playerId);
  if (result.error) {
    logRoomEvent(client.roomId, 'flip_pass_rejected', {
      error: result.error,
      player: summarizePlayer(player, client),
      connection: client.connection,
      draft: draftBefore,
    });
    return send(ws, { type: 'error', payload: { message: result.error } });
  }

  room.lastActive = Date.now();
  logRoomEvent(client.roomId, 'flip_turn_passed', {
    automatic: false,
    player: summarizePlayer(player, client),
    connection: client.connection,
    draft: draftBefore,
    result: {
      turnAdvanced: result.turnAdvanced === true,
      marketRefreshed: result.marketRefreshed === true,
      draftComplete: result.draftComplete === true,
    },
  });
  handleFlipAdvanced(client.roomId, rm, room, result, 'turn_passed');
}

function handleFlipGetState(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  if (roomId && roomId !== client.roomId) return;
  const room = rm.getRoom(client.roomId);
  if (!room || room.draftMode !== 'flip') return;
  sendFlipState(client.roomId, room, client.playerId, 'client_request');
}

function findFlipMarketCard(state, marketSlot, fallbackCardId = null) {
  const slot = Number(marketSlot);
  const rows = state?.market?.rows || [];
  for (const row of rows) {
    const found = (row.cards || []).find(card => card.marketSlot === slot);
    if (found) return found;
  }
  for (const row of rows) {
    const found = (row.cards || []).find(card => Number(card.id) === Number(fallbackCardId));
    if (found) return found;
  }
  return fallbackCardId ? { id: fallbackCardId } : null;
}

function handleGetYdk(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const room = rm.getRoom(roomId);
  if (!room) return;
  send(ws, { type: 'ydk', payload: { content: room.draft.generateYdk(client.playerId), playerName: client.playerName, fileName: `${client.playerName}_draft.ydk` } });
}

function handleSaveDeck(ws, { roomId, deck }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (roomId && roomId !== client.roomId) {
    return send(ws, { type: 'error', payload: { message: '房间不匹配，无法保存卡组' } });
  }
  const room = rm.getRoom(client.roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });
  if (room.state !== DRAFT_STATES.COMPLETE) return;

  const normalized = normalizeSavedDeck(deck, room.draft?.playerPools?.get(client.playerId) || []);
  if (!normalized) {
    return send(ws, { type: 'error', payload: { message: '保存卡组失败：卡组内容和轮抽卡池不一致' } });
  }
  room.playerDecks ||= new Map();
  room.playerDecks.set(client.playerId, normalized);
  room.lastActive = Date.now();
  logRoomEvent(client.roomId, 'deck_saved', {
    player: summarizePlayer(room.players.find(player => player.id === client.playerId), client),
    connection: client.connection,
    counts: {
      main: normalized.main.length,
      extra: normalized.extra.length,
      side: normalized.side.length,
      pool: normalized.pool.length,
    },
  });
}

function normalizeSavedDeck(deck, ownedPool) {
  const sections = ['main', 'extra', 'side', 'pool'];
  const normalized = {};
  for (const section of sections) {
    if (!Array.isArray(deck?.[section])) return null;
    normalized[section] = deck[section]
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0);
  }

  const ownedCounts = countCards(ownedPool);
  const submittedCounts = countCards(sections.flatMap(section => normalized[section]));
  if (ownedCounts.size !== submittedCounts.size) return null;
  for (const [id, count] of ownedCounts) {
    if (submittedCounts.get(id) !== count) return null;
  }
  return normalized;
}

function countCards(cards) {
  const counts = new Map();
  for (const raw of cards || []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function parseYdkCountsForLog(content) {
  const counts = { main: 0, extra: 0, side: 0 };
  let section = 'main';
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#extra')) { section = 'extra'; continue; }
    if (trimmed.startsWith('!side') || trimmed.startsWith('#side')) { section = 'side'; continue; }
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const id = parseInt(trimmed, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    counts[section]++;
  }
  return counts;
}

function handleSwapSeat(ws, { roomId, targetSeat }, rm) {
  const client = clients.get(ws);
  if (!client) return;
  const beforeRoom = rm.getRoom(roomId);
  const beforePlayer = beforeRoom?.players?.find(player => player.id === client.playerId);
  const fromSeat = beforePlayer?.seatIndex ?? null;
  const result = rm.swapSeats(roomId, client.playerId, targetSeat);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const player = result.room?.players?.find(p => p.id === client.playerId);
  logRoomEvent(roomId, 'seat_swapped', {
    player: summarizePlayer(player, client),
    connection: client.connection,
    fromSeat,
    toSeat: player?.seatIndex ?? targetSeat,
  });
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

  const currentRoom = rm.getRoom(client.roomId);
  if (currentRoom?.state !== DRAFT_STATES.IDLE) {
    const room = rm.disconnectPlayer(client.roomId, client.playerId);
    if (room) {
      logRoomEvent(client.roomId, 'player_left_non_idle_marked_disconnected', {
        player: summarizePlayer(room.players.find(player => player.id === client.playerId), client),
        connection: client.connection,
        room: summarizeRoom(room),
        draft: summarizeDraft(room),
      });
      broadcast(client.roomId, rm, null, {
        type: 'room_update',
        payload: { room: rm.getRoomPublic(client.roomId) },
      });
      if (isDraftingRoom(room)) {
        scheduleDisconnectedDraftPick(client.roomId, client.playerId, rm, room);
      }
    }
    try { ws.close(1000, 'leave_room'); }
    catch {}
    return;
  }

  logRoomEvent(client.roomId, 'player_left', {
    player: summarizePlayer(currentRoom?.players?.find(player => player.id === client.playerId), client),
    connection: client.connection,
    room: summarizeRoom(currentRoom),
  });
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
  const tables = getOrCreateBattleTables(room);
  const client = clients.get(ws);
  logRoomEvent(roomId, 'battle_tables_ready', {
    player: client ? summarizePlayer(room.players.find(p => p.id === client.playerId), client) : null,
    connection: client?.connection || null,
    tables,
  });
  const payload = { tables };
  // Emit both names for compatibility: older clients listen for
  // battle_tables_ready while newer code may expect battle_tables_created.
  broadcast(roomId, rm, null, { type: 'battle_tables_ready', payload });
  broadcast(roomId, rm, null, { type: 'battle_tables_created', payload });
}

function handleDuelJoin(ws, { tableId, seatIndex }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (!duelManagerRef.tableBelongsToRoom(tableId, client.roomId)) {
    return send(ws, { type: 'error', payload: { message: '对战桌不属于当前房间' } });
  }
  const result = duelManagerRef.joinTable(tableId, client.playerId, seatIndex);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  logRoomEvent(client.roomId, 'battle_table_joined', {
    player: summarizePlayer(null, client),
    connection: client.connection,
    table: summarizeBattleTable(tableId),
    seatIndex,
  });
  broadcastRoomBattleTables(client.roomId);
}

function handleDuelLeave(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (!duelManagerRef.tableBelongsToRoom(tableId, client.roomId)) {
    return send(ws, { type: 'error', payload: { message: '对战桌不属于当前房间' } });
  }
  const result = duelManagerRef.leaveTable(tableId, client.playerId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  logRoomEvent(client.roomId, 'battle_table_left', {
    player: summarizePlayer(null, client),
    connection: client.connection,
    table: summarizeBattleTable(tableId),
  });
  broadcastRoomBattleTables(client.roomId);
}

function handleDuelRematch(ws, { tableId }) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (!duelManagerRef.tableBelongsToRoom(tableId, client.roomId)) {
    return send(ws, { type: 'error', payload: { message: '对战桌不属于当前房间' } });
  }
  const result = duelManagerRef.rematchTable(tableId, client.playerId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  logRoomEvent(client.roomId, 'battle_table_rematch', {
    player: summarizePlayer(null, client),
    connection: client.connection,
    table: summarizeBattleTable(tableId),
  });
  broadcastRoomBattleTables(client.roomId);
}

async function handleDuelSubmit(ws, { tableId, ydkContent }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (!duelManagerRef.tableBelongsToRoom(tableId, client.roomId)) {
    return send(ws, { type: 'error', payload: { message: '对战桌不属于当前房间' } });
  }
  const room = rm.getRoom(client.roomId);
  const result = duelManagerRef.submitDeck(tableId, client.playerId, ydkContent, room);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });
  const counts = parseYdkCountsForLog(ydkContent);
  logRoomEvent(client.roomId, 'battle_deck_submitted', {
    player: summarizePlayer(room?.players?.find(p => p.id === client.playerId), client),
    connection: client.connection,
    table: summarizeBattleTable(tableId),
    counts,
    bothReady: result.bothReady === true,
    justBecameReady: result.justBecameReady === true,
  });
  send(ws, { type: 'duel_deck_submitted', payload: { success: true, bothReady: result.bothReady } });
  broadcastRoomBattleTables(client.roomId);

  if (result.justBecameReady) {
    await launchNeosDuel(tableId, client.roomId);
  }
}

async function launchNeosDuel(tableId, roomId) {
  const tableDecks = duelManagerRef.getTableDecks(tableId);
  if (!tableDecks) {
    console.warn(`[launchNeosDuel] No decks for table ${tableId}`);
    return;
  }

  const deckValidationError = validateNeosDecks(tableDecks);
  if (deckValidationError) {
    logRoomEvent(roomId, 'duel_launch_failed', {
      table: summarizeBattleTable(tableId),
      error: deckValidationError,
      phase: 'deck_validation',
    });
    sendDuelToTablePlayers(tableId, {
      type: 'duel_launch_neos',
      payload: { error: deckValidationError },
    });
    return;
  }

  const scriptValidationError = validateNeosDeckScripts(tableDecks);
  if (scriptValidationError) {
    logRoomEvent(roomId, 'duel_launch_failed', {
      table: summarizeBattleTable(tableId),
      error: scriptValidationError,
      phase: 'script_validation',
    });
    sendDuelToTablePlayers(tableId, {
      type: 'duel_launch_neos',
      payload: { error: scriptValidationError },
    });
    return;
  }

  const passWd = `cube_${tableId.replace(/\W/g, '').slice(0, 14)}`;

  try {
    const expectedPlayers = tableDecks.players.map((player, index) => ({
      id: player.id,
      name: findClientByPlayer(roomId, player.id)?.playerName || `Player${index + 1}`,
    }));
    const { registerPreloadedDecks } = await import('../duel-bridge/ygopro-ws.js');
    registerPreloadedDecks(passWd, [
      { main: tableDecks.players[0].deck.main || [], extra: tableDecks.players[0].deck.extra || [], side: [] },
      { main: tableDecks.players[1].deck.main || [], extra: tableDecks.players[1].deck.extra || [], side: [] },
    ], {
      players: expectedPlayers,
      testMode: tableDecks.testMode === true,
      tableId,
      roomId,
      onDuelEnd: handleNeosDuelEnded,
    });

    const neosUrl = '/neos/duelroom';
    const p1Name = expectedPlayers[0]?.name || 'Player1';
    const p2Name = expectedPlayers[1]?.name || 'Player2';

    console.log(`[launchNeosDuel] Room "${passWd}" created for table ${tableId}`);

    duelManagerRef.markTableDueling(tableId, { passWd });
    logRoomEvent(roomId, 'duel_launched', {
      table: summarizeBattleTable(tableId),
      passWd,
      players: tableDecks.players.map(player => ({
        id: player.id,
        deck: {
          main: player.deck?.main?.length || 0,
          extra: player.deck?.extra?.length || 0,
          side: player.deck?.side?.length || 0,
        },
      })),
    });
    broadcastRoomBattleTables(roomId);

    sendDuelToTablePlayers(tableId, {
      type: 'duel_launch_neos',
      payload: {
        passWd,
        neosUrl,
        tableId,
        playerIds: tableDecks.players.map(p => p.id),
        players: [p1Name, p2Name],
        instructions: `打开链接后会自动带入房间密码 ${passWd} 并尝试连接当前服务器；如果失败，可在页面里手动重连。`,
      },
    });
  } catch (e) {
    console.error('[launchNeosDuel] Failed:', e.message);
    logRoomEvent(roomId, 'duel_launch_failed', {
      table: summarizeBattleTable(tableId),
      error: e.message,
      phase: 'launch',
    });
    sendDuelToTablePlayers(tableId, {
      type: 'duel_launch_neos',
      payload: { error: '启动对战房间失败: ' + e.message },
    });
  }
}

function validateNeosDecks(tableDecks) {
  for (let i = 0; i < tableDecks.players.length; i++) {
    const deck = tableDecks.players[i]?.deck;
    const mainCount = deck?.main?.length || 0;
    const extraCount = deck?.extra?.length || 0;
    const sideCount = deck?.side?.length || 0;

    if (mainCount < 40 || mainCount > 60) {
      return `玩家${i + 1} 的主卡组需要 40-60 张，当前为 ${mainCount} 张。`;
    }
    if (extraCount > 15) {
      return `玩家${i + 1} 的额外卡组最多 15 张，当前为 ${extraCount} 张。`;
    }
    if (sideCount > 15) {
      return `玩家${i + 1} 的副卡组最多 15 张，当前为 ${sideCount} 张。`;
    }
  }
  return null;
}

function validateNeosDeckScripts(tableDecks) {
  const scriptPath = duelResourceOptionsRef.scriptPath;
  if (!scriptPath) return 'YGO_SCRIPT_PATH 未配置，无法检查卡片脚本';

  for (let i = 0; i < tableDecks.players.length; i++) {
    const deck = tableDecks.players[i]?.deck;
    const main = deck?.main || [];
    const extra = deck?.extra || [];
    const mainStatuses = main.map((code) => getCardScriptStatus(code, scriptPath));
    const extraStatuses = extra.map((code) => getCardScriptStatus(code, scriptPath));
    const unusableMain = mainStatuses.filter((status) => !status.loadable);
    const unusableExtra = extraStatuses.filter((status) => !status.loadable);
    const usableMain = mainStatuses.length - unusableMain.length;

    if (unusableMain.length > 0) {
      return `玩家${i + 1} 的主卡组有 ${unusableMain.length} 张无法装载的卡。通常怪兽可以没有 Lua 脚本，但效果怪兽、魔法、陷阱等仍需要脚本；示例：${formatCardStatusList(unusableMain)}。`;
    }
    if (unusableExtra.length > 0) {
      return `玩家${i + 1} 的额外卡组有 ${unusableExtra.length} 张无法装载的卡。额外卡组怪兽需要 Lua 脚本；示例：${formatCardStatusList(unusableExtra)}。`;
    }
    if (usableMain < 40) {
      return `玩家${i + 1} 的主卡组只有 ${usableMain} 张可装载卡，无法开局。请重新组卡或检查 cards.cdb / ygopro/script 是否完整。`;
    }
  }

  return null;
}

function formatCardStatusList(statuses) {
  return statuses
    .slice(0, 8)
    .map((status) => `${status.name || status.id}(${status.id})`)
    .join('、') || '无';
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

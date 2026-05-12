import { WebSocketServer } from 'ws';
import { DRAFT_STATES } from '../draft/index.js';

/** Map ws → { roomId, playerId, playerName } */
const clients = new Map();

export function createWSServer(httpServer, roomManager) {
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
      const client = clients.get(ws);
      // Don't remove player from room — allow reconnection on page refresh.
      // Only clean up the WS→client mapping.
      if (client) clients.delete(ws);
    });
  });

  return wss;
}

function handleMessage(ws, msg, roomManager) {
  const { type, payload = {} } = msg;

  switch (type) {
    case 'join_room':
      return handleJoin(ws, payload, roomManager);
    case 'start_draft':
      return handleStart(ws, payload, roomManager);
    case 'confirm_pick':
      return handleConfirmPick(ws, payload, roomManager);
    case 'get_pack':
      return handleGetPack(ws, payload, roomManager);
    case 'get_ydk':
      return handleGetYdk(ws, payload, roomManager);
    case 'leave_room':
      return handleLeave(clients.get(ws), roomManager);
    case 'swap_seat':
      return handleSwapSeat(ws, payload, roomManager);
    case 'chat':
      return handleChat(ws, payload, roomManager);
    default:
      console.log('[WS] Unknown message type:', type);
      send(ws, { type: 'error', payload: { message: '未知消息类型: ' + type } });
  }
}

function handleJoin(ws, { roomId, playerName, password }, rm) {
  const result = rm.addPlayer(roomId, playerName, password || null);
  if (result.error) {
    return send(ws, { type: 'error', payload: { message: result.error } });
  }

  const { player, room } = result;
  clients.set(ws, { roomId: room.id, playerId: player.id, playerName });

  // Send joined + chat history
  const pub = rm.getRoomPublic(roomId);
  send(ws, {
    type: 'joined',
    payload: {
      playerId: player.id,
      playerName: player.name,
      room: pub,
      reconnected: !!result.reconnected,
    },
  });

  // Send chat history
  if (pub.chat && pub.chat.length > 0) {
    send(ws, {
      type: 'chat_history',
      payload: { messages: pub.chat },
    });
  }

  // Broadcast player list update
  broadcast(roomId, rm, ws, {
    type: 'room_update',
    payload: { room: rm.getRoomPublic(roomId) },
  });
}

function handleStart(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (client.roomId !== roomId) return send(ws, { type: 'error', payload: { message: '房间不匹配' } });

  const result = rm.startDraft(roomId);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  const room = rm.getRoom(roomId);
  broadcast(roomId, rm, null, {
    type: 'draft_started',
    payload: {
      totalRounds: room.packsPerPlayer,
      cardsPerPack: room.cardsPerPack,
    },
  });

  // Send first pack to each player
  for (const player of room.players) {
    const pack = room.draft.getCurrentPack(player.id);
    const playerWs = findPlayerWs(roomId, player.id);
    if (playerWs) {
      send(playerWs, {
        type: 'pack',
        payload: { ...pack, picked: room.draft.playerPools.get(player.id)?.length || 0 },
      });
    }
  }
}

function handleConfirmPick(ws, { roomId, cardIndex }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });

  const result = room.draft.confirmPick(client.playerId, cardIndex);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  // Confirm to the picker
  send(ws, {
    type: 'pick_result',
    payload: {
      pickedCardId: result.pickedCardId,
      success: true,
      confirmedCount: result.confirmedCount,
      totalPlayers: result.totalPlayers,
    },
  });

  // Broadcast who has confirmed
  const whoConfirmed = [];
  for (const id of room.draft.confirmedThisRound) {
    const p = room.players.find(pl => pl.id === id);
    if (p) whoConfirmed.push(p.name);
  }
  broadcast(roomId, rm, null, {
    type: 'confirm_update',
    payload: {
      confirmedCount: room.draft.confirmedThisRound.size,
      totalPlayers: room.players.length,
      whoConfirmed,
    },
  });

  if (!result.allConfirmed) return;

  // -- All confirmed, packs have been rotated --
  if (result.draftComplete) {
    const pools = room.draft.getPlayerPools();
    broadcast(roomId, rm, null, { type: 'draft_complete', payload: { pools } });
    room.state = DRAFT_STATES.COMPLETE;
    return;
  }

  // Send new packs to every player
  for (const player of room.players) {
    const pack = room.draft.getCurrentPack(player.id);
    const playerWs = findPlayerWs(roomId, player.id);
    if (playerWs) {
      send(playerWs, {
        type: 'pack',
        payload: pack,
      });
    }
  }

  // Broadcast pack index / direction update
  broadcast(roomId, rm, null, {
    type: 'round_update',
    payload: {
      packIndex: room.draft.packIndex,
      totalPacks: room.draft.packsPerPlayer,
      direction: room.draft.direction,
    },
  });
}

function handleGetPack(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });

  const pack = room.draft.getCurrentPack(client.playerId);
  send(ws, {
    type: 'pack',
    payload: { ...pack, picked: room.draft.playerPools.get(client.playerId)?.length || 0 },
  });
}

function handleGetYdk(ws, { roomId }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const room = rm.getRoom(roomId);
  if (!room) return send(ws, { type: 'error', payload: { message: '房间不存在' } });

  const ydk = room.draft.generateYdk(client.playerId);
  send(ws, {
    type: 'ydk',
    payload: {
      content: ydk,
      playerName: client.playerName,
      fileName: `${client.playerName}_draft.ydk`,
    },
  });
}

function handleSwapSeat(ws, { roomId, targetSeat }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });

  const result = rm.swapSeats(roomId, client.playerId, targetSeat);
  if (result.error) return send(ws, { type: 'error', payload: { message: result.error } });

  // Broadcast updated room to everyone
  broadcast(roomId, rm, null, {
    type: 'room_update',
    payload: { room: rm.getRoomPublic(roomId) },
  });
}

function handleChat(ws, { roomId, text }, rm) {
  const client = clients.get(ws);
  if (!client) return send(ws, { type: 'error', payload: { message: '未加入房间' } });
  if (!text || !text.trim()) return;

  const trimmed = text.trim().slice(0, 500);
  const msg = rm.addChat(roomId, client.playerName, trimmed);
  if (!msg) return;

  // Broadcast to all in room
  broadcast(roomId, rm, null, {
    type: 'chat',
    payload: { name: msg.name, text: msg.text, time: msg.time },
  });
}

function handleLeave(client, rm) {
  if (!client) return;
  rm.removePlayer(client.roomId, client.playerId);
}

function findPlayerWs(roomId, playerId) {
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && c.playerId === playerId) return ws;
  }
  return null;
}

function broadcast(roomId, rm, excludeWs, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, c] of clients) {
    if (c.roomId === roomId && ws !== excludeWs && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
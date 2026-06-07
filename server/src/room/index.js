import { v4 as uuid } from 'uuid';
import { DraftEngine, DRAFT_STATES } from '../draft/index.js';

const EMPTY_ROOM_GRACE_MS = 60_000;
const CLEANUP_INTERVAL_MS = 15_000;

export class RoomManager {
  constructor() {
    this.rooms = new Map();  // roomId → Room
    this.roomDeleteListeners = new Set();
    this.cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onRoomDeleted(listener) {
    if (typeof listener !== 'function') return () => {};
    this.roomDeleteListeners.add(listener);
    return () => this.roomDeleteListeners.delete(listener);
  }

  createRoom(cubeName, cubeCardIds, maxPlayers, packsPerPlayer, cardsPerPack, password, testMode, roomName = null) {
    const id = uuid().slice(0, 8);
    const draft = new DraftEngine(cubeCardIds);
    const room = {
      id,
      name: sanitizeRoomName(roomName) || `房间 ${id}`,
      cubeName,
      password: password || null,
      players: [],
      everHadPlayers: false,
      maxPlayers,
      packsPerPlayer,
      cardsPerPack,
      testMode: testMode === true,
      checkDeckSize: true,
      draft,
      playerDecks: new Map(),
      state: DRAFT_STATES.IDLE,
      chat: [],  // Array<{name, text, time}>
      created: Date.now(),
      lastActive: Date.now(),
    };
    this.rooms.set(id, room);
    this._cleanup();
    return room;
  }

  addPlayer(roomId, playerName, password) {
    this._cleanup();
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.password && room.password !== password) return { error: '密码错误' };

    // Check for reconnection: same name already in room
    const existing = room.players.find(p => p.name === playerName);
    if (existing) {
      existing.disconnectedAt = null;
      room.everHadPlayers = true;
      room.lastActive = Date.now();
      return { player: existing, room, reconnected: true };
    }

    if (room.state !== DRAFT_STATES.IDLE) {
      return { error: room.state === DRAFT_STATES.DRAFTING ? '轮抽已开始，无法加入' : '轮抽已结束，无法加入' };
    }

    if (room.players.length >= room.maxPlayers) return { error: '房间已满' };

    // Find first available seat
    const takenSeats = new Set(room.players.map(p => p.seatIndex));
    let seatIndex = 0;
    while (takenSeats.has(seatIndex)) seatIndex++;

    const playerId = uuid().slice(0, 8);
    const player = {
      id: playerId,
      name: playerName,
      seatIndex,
      ws: null,
      disconnectedAt: null,
    };
    room.players.push(player);
    room.everHadPlayers = true;
    room.lastActive = Date.now();
    return { player, room };
  }

  removePlayer(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx >= 0) room.players.splice(idx, 1);
    room.lastActive = Date.now();

    if (room.players.length === 0) {
      this._deleteRoom(roomId, 'empty');
      return null;
    }
    return room;
  }

  disconnectPlayer(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return room;

    player.disconnectedAt = Date.now();
    room.lastActive = Date.now();
    return room;
  }

  startDraft(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.players.length < 2) return { error: '至少需要2名玩家' };
    if (room.state === DRAFT_STATES.DRAFTING) return { error: '轮抽已开始' };
    if (room.state === DRAFT_STATES.COMPLETE) return { error: '轮抽已结束' };

    room.draft.init(room.players, room.packsPerPlayer, {
      cardsPerPack: room.cardsPerPack,
    });
    room.state = DRAFT_STATES.DRAFTING;
    room.lastActive = Date.now();
    return { success: true };
  }

  pickCard(roomId, playerId, cardIndex) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    const result = room.draft.pickCard(playerId, cardIndex);
    room.lastActive = Date.now();

    if (result.packCirculated) {
      room.draft.rotatePacks();
    }

    return { ...result, state: room.draft.state, currentRound: room.draft.currentRound };
  }

  swapSeats(roomId, playerId, targetSeatIndex) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.state !== DRAFT_STATES.IDLE) return { error: '只能在轮抽开始前换座' };

    const player = room.players.find(p => p.id === playerId);
    if (!player) return { error: '玩家不存在' };
    if (targetSeatIndex < 0 || targetSeatIndex >= room.maxPlayers) return { error: '无效的座位' };

    const occupying = room.players.find(p => p.seatIndex === targetSeatIndex);

    const oldSeat = player.seatIndex;
    if (occupying) {
      occupying.seatIndex = oldSeat;
    }
    player.seatIndex = targetSeatIndex;
    room.lastActive = Date.now();

    return { success: true, room };
  }

  addChat(roomId, playerName, text) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const msg = { name: playerName, text, time: Date.now() };
    room.chat.push(msg);
    // Keep only last 200 messages
    if (room.chat.length > 200) room.chat = room.chat.slice(-200);
    room.lastActive = Date.now();
    return msg;
  }

  getRoom(id) {
    this._cleanup();
    return this.rooms.get(id) || null;
  }

  getRoomPublic(id) {
    this._cleanup();
    const room = this.rooms.get(id);
    if (!room) return null;
    return {
      id: room.id,
      name: room.name,
      cubeName: room.cubeName,
      hasPassword: !!room.password,
      checkDeckSize: room.checkDeckSize,
      testMode: room.testMode,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        connected: !p.disconnectedAt,
      })),
      maxPlayers: room.maxPlayers,
      packsPerPlayer: room.packsPerPlayer,
      cardsPerPack: room.cardsPerPack,
      state: room.state,
      chat: (room.chat || []).slice(-50),
    };
  }

  listRoomsPublic() {
    this._cleanup();
    return [...this.rooms.values()]
      .map(room => {
        const connectedCount = countConnectedPlayers(room);
        return {
          id: room.id,
          name: room.name,
          cubeName: room.cubeName,
          hasPassword: !!room.password,
          playerCount: room.players.length,
          connectedCount,
          maxPlayers: room.maxPlayers,
          packsPerPlayer: room.packsPerPlayer,
          cardsPerPack: room.cardsPerPack,
          testMode: room.testMode,
          state: room.state,
          canJoin: room.state === DRAFT_STATES.IDLE && room.players.length < room.maxPlayers,
          created: room.created,
          lastActive: room.lastActive,
        };
      })
      .filter(room => room.connectedCount > 0)
      .sort((a, b) => b.lastActive - a.lastActive);
  }

  _cleanup() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (
        room.players.length === 0 &&
        (room.everHadPlayers || now - (room.lastActive || room.created) > EMPTY_ROOM_GRACE_MS)
      ) {
        this._deleteRoom(id, 'empty');
        continue;
      }
      // Keep rooms with participant identities even if everyone is currently
      // disconnected; reconnect uses room id + player name.
    }
  }

  _deleteRoom(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    this.rooms.delete(roomId);
    for (const listener of this.roomDeleteListeners) {
      try {
        listener(room, reason);
      } catch (err) {
        console.warn(`[RoomManager] room delete listener failed: ${err?.message || err}`);
      }
    }
    return room;
  }
}

function sanitizeRoomName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function countConnectedPlayers(room) {
  return room.players.filter(player => !player.disconnectedAt).length;
}

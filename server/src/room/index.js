import { v4 as uuid } from 'uuid';
import { DraftEngine, DRAFT_STATES } from '../draft/index.js';

const ROOM_EXPIRY_MS = 30 * 60_000; // rooms cleanup after 30min idle

export class RoomManager {
  constructor() {
    this.rooms = new Map();  // roomId → Room
  }

  createRoom(cubeName, cubeCardIds, maxPlayers, packsPerPlayer, cardsPerPack, password) {
    const id = uuid().slice(0, 8);
    const draft = new DraftEngine(cubeCardIds);
    const room = {
      id,
      cubeName,
      password: password || null,
      players: [],
      maxPlayers,
      packsPerPlayer,
      cardsPerPack,
      draft,
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
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.state === DRAFT_STATES.DRAFTING) return { error: '轮抽已开始，无法加入' };
    if (room.password && room.password !== password) return { error: '密码错误' };

    // Check for reconnection: same name already in room
    const existing = room.players.find(p => p.name === playerName);
    if (existing) {
      room.lastActive = Date.now();
      return { player: existing, room, reconnected: true };
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
    };
    room.players.push(player);
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
      this.rooms.delete(roomId);
      return null;
    }
    return room;
  }

  startDraft(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.players.length < 2) return { error: '至少需要2名玩家' };
    if (room.state === DRAFT_STATES.DRAFTING) return { error: '轮抽已开始' };

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
    return this.rooms.get(id) || null;
  }

  getRoomPublic(id) {
    const room = this.rooms.get(id);
    if (!room) return null;
    return {
      id: room.id,
      cubeName: room.cubeName,
      hasPassword: !!room.password,
      players: room.players.map(p => ({ id: p.id, name: p.name, seatIndex: p.seatIndex })),
      maxPlayers: room.maxPlayers,
      packsPerPlayer: room.packsPerPlayer,
      cardsPerPack: room.cardsPerPack,
      state: room.state,
      chat: (room.chat || []).slice(-50),
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (now - room.lastActive > ROOM_EXPIRY_MS) {
        this.rooms.delete(id);
      }
    }
  }
}
/**
 * DuelManager — manages battle tables.
 * Creates tables, handles player seating and deck submission.
 * Actual dueling is handled externally (e.g. ygopro client).
 */
import { v4 as uuid } from 'uuid';
import cardDB from '../card-db/index.js';

const T_EXTRA = 0x40 | 0x2000 | 0x800000 | 0x4000000;

export class DuelManager {
  constructor() {
    this.tables = new Map();
  }

  createBattleTables(room) {
    const tables = [];
    const count = Math.ceil(room.players.length / 2);
    this._cleanup(room.id);

    for (let i = 0; i < count; i++) {
      const tid = uuid().slice(0, 6);
      const table = {
        id: tid, roomId: room.id,
        seats: [null, null], decks: [null, null],
        state: 'waiting', winner: null,
        checkDeckSize: true,
        testMode: room.testMode === true,
      };
      this.tables.set(tid, table);
      tables.push(table);
    }
    return tables;
  }

  joinTable(tableId, playerId, seatIndex) {
    const t = this.tables.get(tableId);
    if (!t) return { error: '对战桌不存在' };
    if (t.state !== 'waiting') return { error: '对战已开始或结束' };
    if (seatIndex < 0 || seatIndex > 1) return { error: '无效座位' };
    if (t.seats[seatIndex]) return { error: '座位已有人' };
    for (const [, ot] of this.tables) {
      if (ot.roomId !== t.roomId) continue;
      for (let i = 0; i < 2; i++) if (ot.seats[i] === playerId) ot.seats[i] = null;
    }
    t.seats[seatIndex] = playerId;
    return { success: true, table: t };
  }

  tableBelongsToRoom(tableId, roomId) {
    const t = this.tables.get(tableId);
    return Boolean(t && t.roomId === roomId);
  }

  submitDeck(tableId, playerId, ydk, room = null) {
    const t = this.tables.get(tableId);
    if (!t) return { error: '对战桌不存在' };
    const si = t.seats.indexOf(playerId);
    if (si < 0) return { error: '你不在该对战桌' };
    const wasReady = Boolean(t.decks[0] && t.decks[1]);
    if (wasReady) return { error: '双方卡组已提交并准备启动，请不要重复提交；如需换卡组，请重新创建对战桌' };
    const deck = parseYdk(ydk);
    const validationError = validateDeck(deck, {
      room,
      playerId,
      requirePoolSubset: t.testMode === true,
    });
    if (validationError) return { error: validationError };
    t.decks[si] = deck;
    const bothReady = Boolean(t.decks[0] && t.decks[1]);
    if (bothReady) t.state = 'ready';
    return { success: true, bothReady, justBecameReady: bothReady && !wasReady };
  }

  getTablePublic(tableId, playerId) {
    const t = this.tables.get(tableId);
    if (!t) return null;
    const si = t.seats.indexOf(playerId);
    return {
      id: t.id, roomId: t.roomId, state: t.state, winner: t.winner,
      seats: t.seats.map(id => id ? { id } : null),
      mySeat: si >= 0 ? si : -1,
    };
  }

  getRoomTables(roomId) {
    const list = [];
    for (const t of this.tables.values())
      if (t.roomId === roomId)
        list.push({ id: t.id, state: t.state, seats: t.seats.map(id => id ? { id } : null), winner: t.winner });
    return list;
  }

  getTableSeatIds(tableId) {
    const t = this.tables.get(tableId);
    return t ? [...t.seats] : [];
  }

  markTableDueling(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return null;
    t.state = 'dueling';
    return t;
  }

  /**
   * Get the table's YDK decks and player IDs for neos-ts launch.
   * Returns null if both decks are not submitted.
   */
  getTableDecks(tableId) {
    const t = this.tables.get(tableId);
    if (!t || !t.decks || !t.decks[0] || !t.decks[1]) return null;
    return {
      testMode: t.testMode === true,
      players: [
        { id: t.seats[0], deck: t.decks[0] },
        { id: t.seats[1], deck: t.decks[1] },
      ],
    };
  }

  _cleanup(roomId) {
    for (const [id, t] of this.tables)
      if (t.roomId === roomId) this.tables.delete(id);
  }
}

/* ── helpers ── */

function parseYdk(content) {
  const r = { main: [], extra: [], side: [] };
  let sec = 'main';
  for (const line of (content || '').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#extra') || t.startsWith('!extra')) { sec = 'extra'; continue; }
    if (t.startsWith('#side') || t.startsWith('!side')) { sec = 'side'; continue; }
    if (t.startsWith('#') || t.startsWith('!')) continue;
    const id = parseInt(t);
    if (id > 0) r[sec].push(id);
  }
  return r;
}

function validateDeck(deck, { room, playerId, requirePoolSubset }) {
  if (deck.main.length < 40 || deck.main.length > 60) {
    return `主卡组40-60张（当前${deck.main.length}张）`;
  }
  if (deck.extra.length > 15) {
    return `额外卡组最多15张（当前${deck.extra.length}张）`;
  }
  if (deck.side.length > 15) {
    return `副卡组最多15张（当前${deck.side.length}张）`;
  }

  const sectionError = validateDeckSections(deck);
  if (sectionError) return sectionError;

  if (requirePoolSubset) {
    const poolError = validateDeckIsFromDraftPool(deck, room, playerId);
    if (poolError) return poolError;
  }

  return null;
}

function validateDeckSections(deck) {
  for (const code of deck.main) {
    const cardType = getCardType(code);
    if (cardType.error) return cardType.error;
    if (isExtraType(cardType.type)) {
      return `卡片 ${code} 是额外卡组类型，不能放入主卡组`;
    }
  }
  for (const code of deck.extra) {
    const cardType = getCardType(code);
    if (cardType.error) return cardType.error;
    if (!isExtraType(cardType.type)) {
      return `卡片 ${code} 不是额外卡组类型，不能放入额外卡组`;
    }
  }
  return null;
}

function getCardType(code) {
  const card = cardDB.getCardFull(code);
  if (!card) {
    return { error: `卡片数据库中找不到 ${code}` };
  }
  return { type: card.type };
}

function isExtraType(type) {
  return (type & T_EXTRA) !== 0;
}

function validateDeckIsFromDraftPool(deck, room, playerId) {
  const pool = room?.draft?.playerPools?.get(playerId);
  if (!pool) {
    return '找不到你的轮抽卡池，无法生成测试卡组';
  }

  const available = countCards(pool);
  const submitted = countCards([...deck.main, ...deck.extra, ...deck.side]);

  for (const [code, count] of submitted) {
    const owned = available.get(code) || 0;
    if (count > owned) {
      return `测试卡组必须来自你的轮抽卡池：卡片 ${code} 提交 ${count} 张，但卡池只有 ${owned} 张`;
    }
  }

  return null;
}

function countCards(cards) {
  const counts = new Map();
  for (const code of cards) {
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
}

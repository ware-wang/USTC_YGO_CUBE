/**
 * DuelManager — manages battle tables.
 * Creates tables, handles player seating and deck submission.
 * Actual dueling is handled externally (e.g. ygopro client).
 */
import { v4 as uuid } from 'uuid';

const TEST_MODE_FALLBACK_MAIN_IDS = [
  38033121, // Dark Magician Girl
  71413901, // Breaker the Magical Warrior
  77585513, // Jinzo
  74131780, // Exiled Force
  15341821, // Dandylion
  29587993, // Mist Valley Apex Avian
  47606319, // Gigantes
  70095154, // Cyber Dragon
  78010363, // Witch of the Black Forest
  59793705, // Elemental HERO Bladedge
  66768175, // Performapal Bot-Eyes Lizard
  72989439, // Black Luster Soldier - Envoy of the Beginning
  94689206, // Block Dragon
  86676862, // Evil HERO Malicious Edge
  5318639,  // Pot of Avarice
  83764718, // Monster Reborn
  12580477, // Raigeki
  81439173, // Swords of Revealing Light
  44095762, // Mirror Force
  14087893, // Book of Moon
];

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
        checkDeckSize: room.checkDeckSize !== false,
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
    for (const [, ot] of this.tables)
      for (let i = 0; i < 2; i++) if (ot.seats[i] === playerId) ot.seats[i] = null;
    t.seats[seatIndex] = playerId;
    return { success: true, table: t };
  }

  submitDeck(tableId, playerId, ydk) {
    const t = this.tables.get(tableId);
    if (!t) return { error: '对战桌不存在' };
    const si = t.seats.indexOf(playerId);
    if (si < 0) return { error: '你不在该对战桌' };
    const p = parseYdk(ydk);
    const deck = t.testMode ? normalizeDeckForTestMode(p) : p;
    if (t.checkDeckSize && (p.main.length < 40 || p.main.length > 60))
      return { error: `主卡组40-60张（当前${p.main.length}张）` };
    t.decks[si] = deck;
    const both = t.decks[0] && t.decks[1];
    if (both) t.state = 'ready';
    return { success: true, bothReady: both };
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
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#extra') || t.startsWith('!extra')) { sec = 'extra'; continue; }
    if (t.startsWith('#side') || t.startsWith('!side')) { sec = 'side'; continue; }
    if (t.startsWith('#') || t.startsWith('!')) continue;
    const id = parseInt(t);
    if (id > 0) r[sec].push(id);
  }
  return r;
}

function normalizeDeckForTestMode(deck) {
  const main = deck.main.length >= 40 ? [...deck.main] : [];
  const extra = deck.extra.slice(0, 15);
  const side = deck.side.slice(0, 15);
  const fillers = TEST_MODE_FALLBACK_MAIN_IDS;

  while (main.length < 40) {
    main.push(fillers[main.length % fillers.length]);
  }

  return {
    main: main.slice(0, 60),
    extra,
    side,
  };
}

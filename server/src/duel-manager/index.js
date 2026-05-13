/**
 * DuelManager — manages multiple duel instances via spawn(duel-runner).
 * Response encoding: value & 0xffff = command type, value >> 16 = index
 */
import { createDuelProcess } from '../duel-bridge/index.js';
import { cardDB } from '../card-db/index.js';
import { v4 as uuid } from 'uuid';

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
        duel: null, events: [], lastPrompt: null,
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
    if (t.checkDeckSize && (p.main.length < 40 || p.main.length > 60))
      return { error: `主卡组40-60张（当前${p.main.length}张）` };
    t.decks[si] = p;
    const both = t.decks[0] && t.decks[1];
    if (both) t.state = 'ready';
    return { success: true, bothReady: both };
  }

  async startDuel(tableId) {
    const t = this.tables.get(tableId);
    if (!t) return { error: '对战桌不存在' };
    if (t.state !== 'ready') return { error: '双方尚未就绪' };
    try {
      const dp = await createDuelProcess();
      await dp.create(Date.now());
      await dp.loadDeck(0, t.decks[0].main, t.decks[0].extra);
      await dp.loadDeck(1, t.decks[1].main, t.decks[1].extra);
      t.duel = dp;
      t.state = 'dueling';
      const result = await dp.start(8000, 5, 1);
      _applyResult(t, result);
      return { success: true };
    } catch (err) {
      console.error('[DuelMgr] startDuel error:', err);
      return { error: '决斗启动失败: ' + err.message };
    }
  }

  async respond(tableId, playerId, value) {
    const t = this.tables.get(tableId);
    if (!t) return { error: '对战桌不存在' };
    if (!t.duel) return { error: '对局未开始' };
    try {
      const result = await t.duel.respond(value);
      _applyResult(t, result);
      return { success: true };
    } catch (err) {
      console.error('[DuelMgr] respond error:', err);
      return { error: '响应失败: ' + err.message };
    }
  }

  getTablePublic(tableId, playerId) {
    const t = this.tables.get(tableId);
    if (!t) return null;
    const si = t.seats.indexOf(playerId);
    return {
      id: t.id, roomId: t.roomId, state: t.state, winner: t.winner,
      seats: t.seats.map(id => id ? { id } : null),
      mySeat: si >= 0 ? si : -1,
      events: t.events.slice(-50),
      lastPrompt: t.lastPrompt ? _enrich(t.lastPrompt) : null,
    };
  }

  getRoomTables(roomId) {
    const list = [];
    for (const t of this.tables.values())
      if (t.roomId === roomId)
        list.push({ id: t.id, state: t.state, seats: t.seats.map(id => id ? { id } : null), winner: t.winner });
    return list;
  }

  _cleanup(roomId) {
    for (const [id, t] of this.tables)
      if (t.roomId === roomId) { if (t.duel) try { t.duel.quit(); } catch {} this.tables.delete(id); }
  }
}

/* ── helpers ── */

function _applyResult(table, result) {
  if (result.events && result.events.length > 0)
    table.events.push(...result.events);

  if (result.type === 'waiting') {
    table.lastPrompt = result;
  } else if (result.type === 'end') {
    table.state = 'completed';
    table.lastPrompt = result;
    if (table.duel) try { table.duel.quit(); } catch {}
  }
}

function _enrich(prompt) {
  if (!prompt || !prompt.message) return prompt;
  const m = prompt.message;

  // Add card names to various card lists
  const addNames = (arr, codeKey = 'c') => {
    if (!arr) return;
    for (const item of arr) {
      const code = item[codeKey];
      if (code && !item.name) {
        const card = cardDB.getCardFull(code);
        if (card) item.name = card.name;
      }
    }
  };

  // IDLE_CMD lists
  addNames(m.summonable);
  addNames(m.spsum);
  addNames(m.repos);
  addNames(m.mset);
  addNames(m.sset);
  addNames(m.chains);

  // Other prompts
  if (m.cmds) addNames(m.cmds, 'c');
  if (m.commands) addNames(m.commands, 'c');
  if (m.cards) addNames(m.cards);
  if (m.chs) addNames(m.chs);

  return prompt;
}

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
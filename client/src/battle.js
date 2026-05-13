/**
 * battle.js — Duel field renderer & state machine
 *
 * Tracks field state from engine events (DRAW, MOVE, NEW_TURN, etc.)
 * and renders the game field with interactive action buttons.
 */

/* ======================== CONSTANTS ======================== */
const LOC_DECK = 0x01, LOC_HAND = 0x02, LOC_MZONE = 0x04, LOC_SZONE = 0x08,
      LOC_GRAVE = 0x10, LOC_REMOVED = 0x20, LOC_EXTRA = 0x40, LOC_OVERLAY = 0x80;

const PHASE_NAMES = { 0x01: '抽牌阶段', 0x02: '准备阶段', 0x04: '主要阶段1',
  0x08: '战斗阶段', 0x10: '主要阶段2', 0x200: '结束阶段' };

/* ======================== FIELD STATE ======================== */
function makeZone() { return Array.from({ length: 5 }, () => null); }

export function createFieldState() {
  return {
    lp: [8000, 8000],
    turn: 0,
    turnPlayer: 0,
    phase: 0x04,
    players: [
      { hand: [], monsters: makeZone(), spellTrap: makeZone(), deck: 0, grave: 0 },
      { hand: [], monsters: makeZone(), spellTrap: makeZone(), deck: 0, grave: 0 },
    ],
    prompt: null,
    lastPhase: 0,
  };
}

const field = createFieldState();

export function getField() { return field; }

/**
 * Process an array of engine events to update field model.
 * Events are { t, p, c, l, s, cards, ... } from the runner.
 */
export function processEvents(events) {
  if (!events?.length) return;

  for (const ev of events) {
    const t = ev.t;
    if (t === 90) { // MSG_DRAW
      const p = ev.p ?? 0;
      const cards = ev.cards || [];
      for (const code of cards) {
        field.players[p].hand.push({ code, controller: p, location: LOC_HAND, sequence: field.players[p].hand.length });
      }
    } else if (t === 55) { // MSG_MOVE
      const pl = field.players[ev.pp ?? ev.pc ?? ev.c1 ?? 0];
      const cl = field.players[ev.cp ?? ev.cc ?? ev.c2 ?? 0];
      const code = ev.c;
      // Remove from previous location
      _removeCard(pl, ev.pl ?? ev.prev_loc ?? LOC_DECK, ev.ps ?? ev.prev_seq ?? 0);
      // Add to current (new) location
      if (code) {
        const card = { code, controller: ev.cc ?? 0, location: ev.cl ?? ev.cur_loc ?? 0, sequence: ev.cs ?? ev.cur_seq ?? 0 };
        _addCard(cl, card.location, card);
      }
    } else if (t === 60) { // MSG_SUMMONING
      const idx = (ev.cs ?? ev.s ?? 0);
      const code = ev.c;
      // Card moves from hand to monster zone
      const p = field.players[ev.cc ?? 0];
      _removeCard(p, LOC_HAND);
      if (code >= 0 && idx < 5) {
        p.monsters[idx] = { code, controller: ev.cc ?? 0, location: LOC_MZONE, sequence: idx };
      }
    } else if (t === 61) { // MSG_SPSUMMONING
      const idx = (ev.cs ?? ev.s ?? 0);
      const code = ev.c;
      const p = field.players[ev.cc ?? ev.cp ?? 0];
      _removeCard(p, LOC_HAND);
      if (idx < 5) p.monsters[idx] = { code, controller: ev.cc ?? 0, location: LOC_MZONE, sequence: idx };
    } else if (t === 63) { // MSG_SET
      const idx = (ev.cs ?? ev.s ?? 0);
      const code = ev.c;
      const p = field.players[ev.cc ?? 0];
      _removeCard(p, LOC_HAND);
      if (code) {
        p.spellTrap[idx] = { code, controller: ev.cc ?? 0, location: LOC_SZONE, sequence: idx, facedown: true };
      }
    } else if (t === 40) { // MSG_NEW_TURN
      field.turnPlayer = ev.p ?? 0;
      field.turn++;
    } else if (t === 41) { // MSG_NEW_PHASE
      field.phase = ev.phase ?? 0x04;
      field.lastPhase = 0;
    } else if (t === 2) { // MSG_HINT
      if (ev.ht === 11 && ev.v !== undefined) { // HINT_LP_UPDATE
        field.lp[ev.tp ?? 0] = ev.v;
      }
    }
  }

  // Update hand from the latest prompt
  if (field.prompt?.type === 'waiting' && field.prompt?.message?.t === 11) {
    const m = field.prompt.message;
    if (m.summonable?.length > 0) {
      const p = field.players[m.p ?? 0];
      // Rebuild hand from summonable cards (most accurate source during IDLE)
      const codes = new Set(p.hand.map(c => c.code));
      for (const card of m.summonable) {
        if (!codes.has(card.c)) {
          p.hand.push({ code: card.c, controller: m.p ?? 0, location: LOC_HAND, sequence: p.hand.length });
        }
      }
    }
  }
}

function _removeCard(pl, loc, seq) {
  if (!pl) return;
  if (loc === LOC_HAND) {
    const i = pl.hand.findIndex(c => c.sequence === seq);
    if (i >= 0) pl.hand.splice(i, 1);
  }
}

function _addCard(pl, loc, card) {
  if (!pl || !card) return;
  if (loc === LOC_MZONE && card.sequence < 5) {
    pl.monsters[card.sequence] = card;
  } else if (loc === LOC_SZONE && card.sequence < 5) {
    pl.spellTrap[card.sequence] = card;
  } else if (loc === LOC_HAND) {
    pl.hand.push(card);
  } else if (loc === LOC_GRAVE) {
    pl.grave++;
  } else if (loc === LOC_DECK) {
    pl.deck++;
  }
}

/**
 * Update the prompt from a duel_table_update
 */
export function setPrompt(prompt) {
  field.prompt = prompt;
}

/**
 * Build a respond value from an action.
 * action: { type: 'summon'|'set'|'activate'|'bp'|'end', index?: number }
 */
export function buildResponse(action) {
  const t = action.type;
  if (t === 'summon') return (action.index ?? 0) << 16; // t=0
  if (t === 'spsum')   return 1 | ((action.index ?? 0) << 16);
  if (t === 'repos')   return 2 | ((action.index ?? 0) << 16);
  if (t === 'set')     return 3 | ((action.index ?? 0) << 16); // t=3 mset
  if (t === 'sset')    return 4 | ((action.index ?? 0) << 16);
  if (t === 'chain')   return 5 | ((action.index ?? 0) << 16);
  if (t === 'bp')      return 6;
  if (t === 'end')     return 7;
  if (t === 'shuffle') return 8;
  if (t === 'cancel')  return -1;
  return 0;
}

/**
 * Extract available actions from current prompt
 */
export function getPromptActions() {
  const m = field.prompt?.type === 'waiting' ? field.prompt.message : null;
  if (!m) return [];

  const actions = [];

  if (m.t === 11) { // IDLE_CMD
    if (m.summonable?.length) actions.push({ type: 'summon', label: '通常召唤', cards: m.summonable, index: 0 });
    if (m.spsum?.length)    actions.push({ type: 'spsum', label: '特殊召唤', cards: m.spsum, index: 0 });
    if (m.repos?.length)    actions.push({ type: 'repos', label: '变更表示', cards: m.repos, index: 0 });
    if (m.mset?.length)     actions.push({ type: 'set', label: '放置', cards: m.mset, index: 0 });
    if (m.sset?.length)     actions.push({ type: 'sset', label: '盖魔法', cards: m.sset, index: 0 });
    if (m.bp)               actions.push({ type: 'bp', label: '进战阶' });
    if (m.ep)               actions.push({ type: 'end', label: '结束回合' });
    if (m.shuffle)          actions.push({ type: 'shuffle', label: '洗牌' });
  } else if (m.t === 16) { // SELECT_CHAIN
    if (m.fd === 0)         actions.push({ type: 'cancel', label: '取消' });
    if (m.chs) {
      m.chs.forEach((ch, i) => actions.push({ type: 'chain', label: '发动效果', index: i }));
    }
  } else if (m.t === 10) { // SELECT_BATTLECMD
    if (m.atk?.length)      actions.push({ type: 'battle', label: '攻击宣言', atkCards: m.atk });
    actions.push({ type: 'bp_action', label: '进M2', code: 2 });
    actions.push({ type: 'end', label: '结束回合', code: 3 });
  } else if (m.t === 12 || m.t === 20) { // SELECT_CARD, SELECT_TRIBUTE
    if (m.cards?.length) {
      m.cards.forEach((c, i) => actions.push({ type: 'select_card', label: c.name || `卡${i}`, index: i }));
    }
  } else if (m.t === 14) { // SELECT_POSITION
    actions.push({ type: 'pos', label: '攻击表示', val: 1 });
    actions.push({ type: 'pos', label: '守备表示', val: 2 });
    actions.push({ type: 'pos', label: '里侧守备', val: 4 });
  } else if (m.t === 19) { // SELECT_EFFECTYN
    actions.push({ type: 'yes', label: '发动', val: 1 });
    actions.push({ type: 'no', label: '不发动', val: 0 });
  } else if (m.t === 18) { // SELECT_YESNO
    actions.push({ type: 'yes', label: '是', val: 1 });
    actions.push({ type: 'no', label: '否', val: 0 });
  }

  return actions;
}

/**
 * Get the response value for a chosen action
 */
export function getActionValue(action) {
  if (typeof action.val !== 'undefined') return action.val;
  if (action.code !== undefined) return action.code;
  return buildResponse(action);
}
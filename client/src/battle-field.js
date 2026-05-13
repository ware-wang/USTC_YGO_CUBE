/**
 * battle-field.js — DOM-based game field renderer
 *
 * Layout:
 *   P1: [D][G][E] [S/T×5] [MZ×5]
 *   ──────── Center (LP/Phase) ────────
 *   P0: [MZ×5] [S/T×5] [D][G][E]
 *   Hand: [cards]
 *   Actions: buttons
 */
import { getField, getPromptActions, getActionValue, buildResponse } from './battle.js';

export const CARD_IMG_BASE = 'https://images.ygoprodeck.com/images/cards/';
const PHASE_NAMES = { 0x01:'DP', 0x02:'SP', 0x04:'MP1', 0x08:'BP', 0x10:'MP2', 0x200:'EP' };

/**
 * Full field render into #battleField
 */
export function renderField() {
  const container = document.getElementById('battleField');
  if (!container) return;
  const f = getField();
  container.innerHTML = '';

  container.appendChild(_buildP1(f));
  container.appendChild(_buildCenter(f));
  container.appendChild(_buildP0(f));
  container.appendChild(_buildActions(f));
}

/* ── Player 1 (opponent, top) ── */
function _buildP1(f) {
  const wrap = document.createElement('div');
  wrap.className = 'bf-zone bf-p1';

  const row = document.createElement('div');
  row.className = 'bf-row';

  // Deck / Grave / Extra on left
  row.appendChild(_sideWidget(1, f));

  // Spell/Trap zones
  const stRow = document.createElement('div');
  stRow.className = 'bf-zone-row';
  for (let i = 0; i < 5; i++) {
    stRow.appendChild(_slot('p1-st-'+i, f.players[1].spellTrap[i], true));
  }

  // Monster zones
  const mzRow = document.createElement('div');
  mzRow.className = 'bf-zone-row bf-mz';
  for (let i = 0; i < 5; i++) {
    mzRow.appendChild(_slot('p1-mz-'+i, f.players[1].monsters[i], false));
  }

  row.appendChild(stRow);
  row.appendChild(mzRow);
  wrap.appendChild(row);

  // Opponent hand (face-down count)
  wrap.appendChild(_oppHand(f.players[1].hand.length));

  return wrap;
}

/* ── Player 0 (self, bottom) ── */
function _buildP0(f) {
  const wrap = document.createElement('div');
  wrap.className = 'bf-zone bf-p0';

  const row = document.createElement('div');
  row.className = 'bf-row';

  // Monster zones
  const mzRow = document.createElement('div');
  mzRow.className = 'bf-zone-row bf-mz';
  for (let i = 0; i < 5; i++) {
    mzRow.appendChild(_slot('p0-mz-'+i, f.players[0].monsters[i], false));
  }

  // Spell/Trap zones
  const stRow = document.createElement('div');
  stRow.className = 'bf-zone-row';
  for (let i = 0; i < 5; i++) {
    stRow.appendChild(_slot('p0-st-'+i, f.players[0].spellTrap[i], true));
  }

  row.appendChild(mzRow);
  row.appendChild(stRow);

  // Deck / Grave / Extra on right
  row.appendChild(_sideWidget(0, f));

  wrap.appendChild(row);

  // Player hand (face up)
  wrap.appendChild(_selfHand(f.players[0]));

  return wrap;
}

/* ── Deck / Grave / Extra widget ── */
function _sideWidget(p, f) {
  const pl = f.players[p];
  const div = document.createElement('div');
  div.className = 'bf-side';
  div.innerHTML = `
    <div class="bf-side-item" title="卡组">
      <div class="bf-side-label">D</div>
      <div class="bf-side-count">${pl.deck || 35}</div>
    </div>
    <div class="bf-side-item" title="墓地">
      <div class="bf-side-label">G</div>
      <div class="bf-side-count">${pl.grave || 0}</div>
    </div>
    <div class="bf-side-item" title="额外">
      <div class="bf-side-label">E</div>
      <div class="bf-side-count">0</div>
    </div>
  `;
  return div;
}

/* ── Single card slot ── */
function _slot(id, card, isSt) {
  const el = document.createElement('div');
  el.className = 'bf-slot';
  el.dataset.slot = id;

  if (!card) return el;

  const inner = document.createElement('div');
  // S/T slots show card backs when face-down or when set
  const isFaceDown = isSt || card.facedown;
  inner.className = 'bf-card ' + (isFaceDown ? 'bf-card-back' : '');
  inner.dataset.code = card.code;

  if (isFaceDown) {
    // Show card back
    inner.innerHTML = '<div class="bf-back"></div>';
  } else {
    // Show card image with error fallback (use DOM event, not inline)
    inner.innerHTML = `<img class="bf-img" src="${CARD_IMG_BASE}${card.code}.jpg" loading="lazy">`;
  }
  el.appendChild(inner);

  if (!isFaceDown && card && card.code) {
    // Attach error handler after DOM insertion
    const img = inner.querySelector('img');
    if (img) img.addEventListener('error', () => {
      inner.className = 'bf-card bf-card-fallback';
      inner.innerHTML = '<span>#' + card.code + '</span>';
    }, { once: true });
  }

  return el;
}

/* ── Opponent hand (face-down count) ── */
function _oppHand(count) {
  const row = document.createElement('div');
  row.className = 'bf-hand-row';
  for (let i = 0; i < Math.min(count, 6); i++) {
    const s = _fakeSlot();
    s.classList.add('bf-hand-slot');
    row.appendChild(s);
  }
  if (count > 6) {
    const badge = document.createElement('span');
    badge.className = 'bf-badge';
    badge.textContent = '+' + (count - 6);
    row.appendChild(badge);
  }
  return row;
}

/* ── Self hand (face up cards) ── */
function _selfHand(pl) {
  const row = document.createElement('div');
  row.className = 'bf-hand-row';
  for (const card of pl.hand) {
    const inner = document.createElement('div');
    inner.className = 'bf-card bf-card-small';
    inner.dataset.code = card.code;
    inner.innerHTML = `<img class="bf-img" src="${CARD_IMG_BASE}${card.code}.jpg" loading="lazy">`;
    row.appendChild(inner);

    // Error fallback
    const img = inner.querySelector('img');
    if (img) img.addEventListener('error', () => {
      inner.className = 'bf-card bf-card-fallback bf-card-small';
      inner.innerHTML = '<span>#' + card.code + '</span>';
    }, { once: true });
  }
  if (pl.hand.length === 0) {
    row.innerHTML = '<span style="color:var(--text-dim);font-size:0.8rem;padding:8px">手牌为空</span>';
  }
  return row;
}

function _fakeSlot() {
  const el = document.createElement('div');
  el.className = 'bf-card bf-card-back bf-card-small';
  el.innerHTML = '<div class="bf-back"></div>';
  return el;
}

/* ── Center info bar ── */
function _buildCenter(f) {
  const bar = document.createElement('div');
  bar.className = 'bf-center';
  const tp = f.turnPlayer;
  bar.innerHTML = `
    <div class="bf-info">
      <div class="bf-lp ${tp===1?'bf-active':''}">
        <span class="bf-lp-label">P1</span>
        <span class="bf-lp-val">${f.lp[1]}</span>
      </div>
      <div class="bf-mid">
        <span class="bf-phase">${PHASE_NAMES[f.phase] || '?'}</span>
        <span class="bf-turn">T${Math.floor(f.turn/2)+1}</span>
      </div>
      <div class="bf-lp ${tp===0?'bf-active':''}">
        <span class="bf-lp-label">P0</span>
        <span class="bf-lp-val">${f.lp[0]}</span>
      </div>
    </div>
  `;
  return bar;
}

/* ── Action buttons ── */
function _buildActions(f) {
  const wrap = document.createElement('div');
  wrap.className = 'bf-actions';
  window.bfActions = wrap;

  const actions = getPromptActions();
  if (!actions.length) {
    wrap.innerHTML = '<span class="bf-waiting">等待对手操作...</span>';
    return wrap;
  }

  // Group card-selection actions
  const summon = actions.find(a => a.type === 'summon');
  const spsum  = actions.find(a => a.type === 'spsum');
  const mset   = actions.find(a => a.type === 'set');
  const sset   = actions.find(a => a.type === 'sset');
  const end    = actions.find(a => a.type === 'end');
  const bp     = actions.find(a => a.type === 'bp');
  const cancel = actions.find(a => a.type === 'cancel');

  if (summon?.cards?.length) wrap.appendChild(_cardBtnGroup('通常召唤', summon));
  if (spsum?.cards?.length)  wrap.appendChild(_cardBtnGroup('特殊召唤', spsum));
  if (mset?.cards?.length)   wrap.appendChild(_cardBtnGroup('盖放', mset));
  if (sset?.cards?.length)   wrap.appendChild(_cardBtnGroup('盖魔陷', sset));

  // Quick buttons
  const qRow = document.createElement('div');
  qRow.className = 'bf-btn-row';

  if (bp) { const b = _btn('⚔ 进战阶', 'bf-btn-bp', () => _fire('bp', bp)); qRow.appendChild(b); }
  if (end) { const b = _btn('▶ 结束', 'bf-btn-end', () => _fire('end', end)); qRow.appendChild(b); }

  // Remaining non-card actions
  for (const a of actions) {
    if (['summon','spsum','set','sset','end','bp'].includes(a.type)) continue;
    qRow.appendChild(_btn(a.label, '', () => _fire(a.type, a)));
  }

  wrap.appendChild(qRow);
  return wrap;
}

function _cardBtnGroup(label, action) {
  const g = document.createElement('div');
  g.className = 'bf-action-group';
  g.innerHTML = `<span class="bf-action-label">${label}:</span>`;
  for (let i = 0; i < (action.cards||[]).length; i++) {
    const c = action.cards[i];
    const b = document.createElement('button');
    b.className = 'bf-card-btn';
    b.textContent = c.name || ('#' + c.c);
    b.title = `${c.name||''} ${c.atk?'ATK/'+c.atk:''} ${c.def?'DEF/'+c.def:''}`.trim();
    const idx = i;
    b.addEventListener('click', () => {
      const act = { type: action.type, index: idx };
      _fire(action.type, act);
    });
    g.appendChild(b);
  }
  return g;
}

function _btn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = 'bf-btn ' + cls;
  b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}

function _fire(type, action) {
  const val = getActionValue(action) ?? buildResponse(action);
  document.dispatchEvent(new CustomEvent('duel-action', {
    detail: { type, value: val, action }
  }));
}

/* ── Update LP from events (called by room.js before render) ── */
export function updateFieldFromEvents(events) {
  if (!events?.length) return;
  for (const ev of events) {
    if (ev.t === 2 && ev.ht === 11) {
      getField().lp[ev.tp ?? 0] = ev.v;
    }
  }
}
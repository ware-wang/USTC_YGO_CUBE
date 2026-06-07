/**
 * USTC-OnlineCube - Room/Draft/Results Page
 * Loaded from lobby with ?roomId=xxx&name=xxx&password=xxx (optional)
 */
import { wsClient } from './ws/client.js';

/* ======================== CONSTANTS ======================== */
const CARD_IMG_BASE = 'https://images.ygoprodeck.com/images/cards/';

const T_MONSTER = 0x1, T_SPELL = 0x2, T_TRAP = 0x4;
const T_FUSION = 0x40, T_SYNCHRO = 0x2000, T_XYZ = 0x800000, T_LINK = 0x4000000;

const RACE_NAMES = {
  0x1:'战士',0x2:'魔法师',0x4:'天使',0x8:'恶魔',0x10:'不死',0x20:'机械',
  0x40:'水',0x80:'炎',0x100:'岩石',0x200:'鸟兽',0x400:'植物',0x800:'昆虫',
  0x1000:'雷',0x2000:'龙',0x4000:'兽',0x8000:'兽战士',0x10000:'恐龙',
  0x20000:'鱼',0x40000:'海龙',0x80000:'爬虫',0x100000:'念动力',
  0x200000:'幻龙',0x400000:'电子界',0x2000000:'幻想魔',
};
const ATTR_NAMES = { 0x1:'地',0x2:'水',0x4:'炎',0x8:'风',0x10:'光',0x20:'暗',0x40:'神' };

/* ======================== STATE ======================== */
const state = {
  view: 'room',
  playerName: '',
  playerId: null,
  roomId: null,
  roomPassword: null,
  isHost: false,
  room: null,
  draft: {
    totalPacks: 0, packIndex: 0, currentPack: [], direction: 1,
    timer: null, seconds: 60, phase: 'idle',
    selectedCard: null, selectedCardEl: null, remainingInPack: 0,
    autoDraft: false,
    pickedCards: [],
  },
  results: { main: [], extra: [], side: [], pool: [] },
  cardCache: {},
  /** Set when viewing a card detail — so the "pick" button knows the context */
  detailCard: null,
  detailSource: null, // 'draft' | 'pool'
  battle: {
    tables: [],
  },
};
let cardInstanceSeq = 1;
let deckSaveTimer = null;

/* ======================== DOM UTILS ======================== */
const el = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const t = el(name);
  if (t) { t.classList.add('active'); state.view = name; }
}
function show(e) { e?.classList.remove('hidden'); }
function hide(e) { e?.classList.add('hidden'); }
function clear(e) { const d = (typeof e === 'string') ? el(e) : e; if (d) d.innerHTML = ''; }
function setText(id, text) { const e = el(id); if (e) e.textContent = text; }
function cardImgUrl(id) { return CARD_IMG_BASE + id + '.jpg'; }

/* ======================== CARD UTILS ======================== */
function isExtraType(t) { return t & (T_FUSION|T_SYNCHRO|T_XYZ|T_LINK); }
function isMonsterType(t) { return (t & T_MONSTER) !== 0; }
function isSpellType(t) { return (t & T_SPELL) !== 0; }
function isTrapType(t) { return (t & T_TRAP) !== 0; }
function typeName(t) {
  if (t&T_LINK) return '链接'; if (t&T_XYZ) return '超量';
  if (t&T_SYNCHRO) return '同调'; if (t&T_FUSION) return '融合';
  if (t&T_SPELL) return '魔法'; if (t&T_TRAP) return '陷阱';
  if (t&T_MONSTER) return '怪兽'; return '';
}
function raceName(r) { return RACE_NAMES[r] || ''; }
function attrName(a) { return ATTR_NAMES[a] || ''; }
function cacheCard(card) { if (card && card.id) state.cardCache[card.id] = card; }
function cacheCards(cards) { for (const c of cards) cacheCard(c); }
function ensureCardInstance(card) {
  if (!card) return '';
  if (!card._draftInstanceId) {
    Object.defineProperty(card, '_draftInstanceId', {
      value: 'card_' + cardInstanceSeq++,
      enumerable: false,
    });
  }
  return card._draftInstanceId;
}
function ensureCardInstances(cards) {
  for (const card of cards || []) ensureCardInstance(card);
  return cards || [];
}

/** Build a stat line: "Lv4 ATK/1800 DEF/1200" etc. */
function statLine(card) {
  const t = card.type || 0;
  if (!(t & T_MONSTER)) return '';
  if (t & T_LINK) return 'ATK/' + (card.atk||'?') + '  LINK-' + (card.level||0);
  if (t & T_XYZ) return 'R' + (card.level||0) + '  ATK/' + (card.atk||'?') + '  DEF/' + (card.def||'?');
  return 'Lv' + (card.level||0) + '  ATK/' + (card.atk||'?') + '  DEF/' + (card.def||'?');
}

function cardHTML(card, small) {
  const t = card.type || 0;
  const isM = t & T_MONSTER;
  let h = '';
  // Card image (or placeholder)
  if (small) {
    // In deck zones: text-only
  } else {
    h += '<img class="card-img" src="' + cardImgUrl(card.id) +
         '" alt="' + (card.name||'') + '" loading="lazy"' +
         ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
         '<div class="card-no-img" style="display:none">无卡图</div>';
  }
  h += '<div class="card-name">' + (card.name||'???') + '</div>';
  h += '<div class="card-type">' + typeName(t) + '</div>';
  if (isM) {
    h += '<div class="card-type">' + attrName(card.attribute) + ' / ' + (raceName(card.race)||'?') + '</div>';
    h += '<div class="card-stats">' + statLine(card) + '</div>';
  }
  if (!small && card.desc) {
    h += '<div class="card-desc">' + card.desc.slice(0,60) + (card.desc.length>60?'...':'') + '</div>';
  }
  return h;
}

function makeCardEl(card, opts) {
  opts = opts || {};
  const div = document.createElement('div');
  div.className = 'card-item';
  div.dataset.id = card.id;
  if (Number.isInteger(card.packSlot)) div.dataset.packSlot = String(card.packSlot);
  div.innerHTML = cardHTML(card, opts.small);

  if (opts.detailButton) {
    const detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'card-detail-chip';
    detailBtn.title = '查看详情';
    detailBtn.setAttribute('aria-label', '查看详情');
    detailBtn.textContent = 'i';
    detailBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCardDetail(card, opts.detailSource || 'pool');
    });
    div.appendChild(detailBtn);
  }

  if (opts.draggable) {
    div.draggable = true;
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.id.toString());
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => div.classList.add('picked'), 0);
    });
    div.addEventListener('dragend', () => div.classList.remove('picked'));
  }
  return div;
}

/* ======================== CARD DETAIL MODAL ======================== */
function showCardDetail(card, source) {
  state.detailCard = card;
  state.detailSource = source;

  // Image
  const img = el('cardDetailImg');
  const noImg = el('cardDetailNoImg');
  img.src = cardImgUrl(card.id);
  img.style.display = 'block';
  img.onerror = function() {
    img.style.display = 'none';
    noImg.classList.remove('hidden');
  };
  // Pre-reset — if image loads quickly, it'll show
  img.onload = function() { noImg.classList.add('hidden'); img.style.display = 'block'; };

  // Info
  const t = card.type || 0;
  const isM = t & T_MONSTER;
  setText('cardDetailName', card.name || '???');
  let meta = typeName(t);
  if (isM) {
    meta += ' / ' + attrName(card.attribute) + ' / ' + (raceName(card.race)||'?');
  }
  setText('cardDetailMeta', meta);
  setText('cardDetailDesc', statLine(card) + (card.desc ? '\n' + card.desc : '无描述信息'));

  // Show/hide pick button based on source
  const pickBtn = el('cardDetailPickBtn');
  if (source === 'draft' && state.draft.phase === 'choosing') {
    show(pickBtn);
  } else {
    hide(pickBtn);
  }

  show(el('cardDetailOverlay'));
}

function closeCardDetail() {
  hide(el('cardDetailOverlay'));
  state.detailCard = null;
  state.detailSource = null;
}

function handleDetailPick() {
  if (!state.detailCard || state.detailSource !== 'draft') return;
  if (state.draft.phase !== 'choosing') return;

  const nel = findPackCardEl(state.detailCard);
  handleSelectCard(state.detailCard, nel);
  closeCardDetail();
}

/* ======================== WS HELPERS ======================== */
function wsSend(type, payload) {
  if (wsClient.isConnected()) wsClient.send(type, payload);
  else console.warn('[WS] Not connected');
}

/* ======================== WS HANDLERS ======================== */
function setupHandlers() {
  wsClient.on('connected', () => {
    console.log('[Room] WS connected');
    if (state.roomId && state.playerName) {
      wsSend('join_room', {
        roomId: state.roomId,
        playerName: state.playerName,
        password: state.roomPassword || null,
      });
    }
  });

  wsClient.on('disconnected', () => {
    console.log('[Room] WS disconnected');
    stopTimer();
  });

  wsClient.on('joined', (msg) => {
    const p = msg.payload;
    state.roomId = p.room.id;
    state.playerId = p.playerId;
    state.playerName = p.playerName;
    state.room = p.room;
    state.isHost = (p.room.players[0]?.id === p.playerId);
    updateRoomUI(p.room);
    if (p.room.state !== 'complete') {
      showView('room');
    }
    const url = new URL(window.location);
    url.searchParams.set('roomId', p.room.id);
    url.searchParams.set('name', p.playerName);
    if (state.roomPassword) {
      url.searchParams.set('password', state.roomPassword);
    } else {
      url.searchParams.delete('password');
    }
    window.history.replaceState({}, '', url);
  });

  wsClient.on('chat_history', (msg) => {
    const msgs = msg.payload.messages || [];
    for (const m of msgs) addChatMessage(m.name, m.text, m.time, true);
  });

  wsClient.on('chat', (msg) => {
    const { name, text, time } = msg.payload;
    addChatMessage(name, text, time, false);
  });

  wsClient.on('room_update', (msg) => {
    const room = msg.payload.room;
    state.room = room;
    state.isHost = (room.players[0]?.id === state.playerId);
    updateRoomUI(room);
  });

  wsClient.on('draft_started', (msg) => {
    state.draft.totalPacks = msg.payload.totalRounds || msg.payload.totalPacks || 4;
    state.draft.phase = 'idle';
    state.draft.selectedCard = null;
    state.draft.selectedCardEl = null;
    state.draft.autoDraft = false;
    state.draft.pickedCards = [];
    showView('draft');
    setText('roundInfo', '第 1/' + state.draft.totalPacks + ' 包');
    setText('draftDirection', '');
    clear('packArea');
    hide(el('confirmPickBtn'));
    hide(el('autoDraftBtn'));
    hide(el('stopAutoDraftBtn'));
    setText('draftStatus', '准备开始...');
    show(el('draftStatus'));
    renderDraftPickedCards();
  });

  wsClient.on('pack', (msg) => {
    const p = msg.payload;
    state.draft.packIndex = p.packIndex || 0;
    state.draft.totalPacks = p.totalPacks || state.draft.totalPacks || 4;
    state.draft.currentPack = p.cards || [];
    state.draft.direction = p.direction || 1;
    state.draft.remainingInPack = p.remaining;
    const alreadyConfirmed = p.confirmed === true;
    state.draft.phase = alreadyConfirmed ? 'waiting' : 'choosing';
    state.draft.seconds = 60;
    state.draft.selectedCard = null;
    state.draft.selectedCardEl = null;
    cacheCards(state.draft.currentPack);
    setDraftPickedCards(p.pickedCards || []);

    const isTestMode = state.room?.testMode === true;

    setText('roundInfo', '第 ' + (state.draft.packIndex+1) + '/' + state.draft.totalPacks + ' 包 (剩' + (state.draft.remainingInPack||0) + '张)');
    setText('draftDirection', state.draft.direction===1 ? '→ 向右传' : '← 向左传');
    if (alreadyConfirmed) {
      setText('draftStatus', '已确认，等待其他玩家...');
    } else if (state.draft.autoDraft) {
      setText('draftStatus', '⚡ 自动轮抽中...');
    } else {
      setText('draftStatus', '点击卡牌查看详情并选择');
    }
    hide(el('confirmPickBtn'));

    // Show/hide auto-draft buttons based on test mode
    if (isTestMode && !alreadyConfirmed) {
      if (state.draft.autoDraft) {
        hide(el('autoDraftBtn'));
        show(el('stopAutoDraftBtn'));
      } else {
        show(el('autoDraftBtn'));
        hide(el('stopAutoDraftBtn'));
      }
    } else {
      hide(el('autoDraftBtn'));
      hide(el('stopAutoDraftBtn'));
    }

    renderPack();
    if (alreadyConfirmed) {
      stopTimer();
      setText('draftTimer', '已确认');
    } else {
      startTimer();

      // Auto-pick if auto-draft is on
      if (state.draft.autoDraft) {
        setTimeout(() => autoPickOne(), 300);
      }
    }
  });

  wsClient.on('pick_result', (msg) => {
    const r = msg.payload;
    if (!r.success) return;
    if (r.pickedCards) setDraftPickedCards(r.pickedCards);
    stopTimer();
    state.draft.phase = 'waiting';

    if (state.draft.selectedCardEl) {
      state.draft.selectedCardEl.classList.add('picked');
      state.draft.selectedCardEl.classList.remove('selected');
      state.draft.selectedCardEl = null;
      state.draft.selectedCard = null;
    }
    hide(el('confirmPickBtn'));

    const remaining = r.totalPlayers ? r.totalPlayers - (r.confirmedCount || 1) : 0;
    if (remaining > 0) {
      setText('draftTimer', '已确认');
      setText('draftStatus', '已确认，等待其他 ' + remaining + ' 名玩家...');
    } else {
      setText('draftTimer', '轮转中...');
      setText('draftStatus', '全员确认, 卡包轮转中...');
    }
  });

  wsClient.on('confirm_update', (msg) => {
    const p = msg.payload;
    const names = (p.whoConfirmed || []).join(', ');
    if (state.draft.phase === 'waiting') {
      setText('draftStatus', '已确认: ' + p.confirmedCount + '/' + p.totalPlayers + ' (' + names + ')');
    }
  });

  wsClient.on('round_update', (msg) => {
    const p = msg.payload;
    if (p.packIndex !== undefined) state.draft.packIndex = p.packIndex;
    if (p.totalPacks) state.draft.totalPacks = p.totalPacks;
    state.draft.direction = p.direction;
    setText('draftDirection', state.draft.direction===1 ? '→ 向右传' : '← 向左传');
  });

  wsClient.on('draft_complete', (msg) => {
    stopTimer();
    const alreadyHadLocalPool = getAllDraftedCards().length > 0;
    state.draft.phase = 'done';
    state.draft.autoDraft = false;
    hide(el('autoDraftBtn'));
    hide(el('stopAutoDraftBtn'));
    const myPool = msg.payload.pools[state.playerId];
    if (myPool) {
      const poolCards = ensureCardInstances(myPool.cards || []);
      cacheCards(poolCards);
      if (!alreadyHadLocalPool) {
        applySavedOrDefaultDeck(poolCards, msg.payload.savedDeck);
      }
    }
    // Store tables for battle lobby
    if (msg.payload.tables) {
      state.battle.tables = msg.payload.tables;
    }
    initResults();
    if (msg.payload.resumeView === 'battleLobby') {
      showBattleLobby();
    } else {
      showView('results');
    }
  });

  wsClient.on('ydk', (msg) => {
    setText('ydkContent', msg.payload.content);
    show(el('ydkModal'));
  });

  wsClient.on('error', (msg) => {
    const errMsg = msg.payload?.message || '服务器错误';
    alert(errMsg);
    if (state.draft.phase === 'waiting' && state.draft.selectedCardEl) {
      state.draft.selectedCardEl.classList.remove('confirmed');
      state.draft.selectedCardEl.classList.add('selected');
      show(el('confirmPickBtn'));
      state.draft.phase = 'choosing';
      setText('draftStatus', '确认失败，请重新选择');
    }
  });

  // ═══ Battle table handlers ═══

  const handleBattleTables = (msg) => {
    state.battle.tables = msg.payload.tables;
    renderBattleTables();
  };

  wsClient.on('battle_tables_ready', handleBattleTables);
  wsClient.on('battle_tables_created', handleBattleTables);

  wsClient.on('duel_table_joined', (msg) => {
    updateTableFromServer(msg.payload);
    renderBattleTables();
  });

  wsClient.on('duel_table_update', (msg) => {
    updateTableFromServer(msg.payload);
    renderBattleTables();
  });

  wsClient.on('duel_both_ready', (msg) => {
    // Legacy: keep for compatibility
  });

  wsClient.on('duel_launch_neos', (msg) => {
    handleLaunchNeos(msg.payload);
  });
}

/* ======================== ROOM / ROUND TABLE ======================== */
function updateRoomUI(room) {
  setText('roomNameDisplay', room.name || '轮抽房间');
  setText('roomIdDisplay', room.id);
  setText('roomCubeName', room.cubeName);
  setText('roomRules', room.players.length + '/' + room.maxPlayers + '人 ' + room.packsPerPlayer + '包 ' + room.cardsPerPack + '张');
  drawSeats(room);
  updateStartBtn(room);
}

function drawSeats(room) {
  const table = el('roundtable');
  if (!table) return;
  const n = room.maxPlayers;
  const w = table.offsetWidth, h = table.offsetHeight;
  // Clear all seat elements
  table.querySelectorAll('.seat').forEach(s => s.remove());
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 50;

  // Sort players by seatIndex for consistent display
  const ordered = Array.from({ length: n }, (_, i) => room.players.find(p => p.seatIndex === i) || null);

  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const p = ordered[i];

    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = x + 'px';
    seat.style.top = y + 'px';
    seat.dataset.seatIndex = i;

    if (p) {
      seat.classList.add('occupied');
      if (p.id === state.playerId) seat.classList.add('you');
      seat.innerHTML = '<div class="seat-avatar">' + p.name.charAt(0) + '</div>' +
                       '<div class="seat-name">' + p.name + '</div>';

      // Click another player to swap seats (only before draft starts)
      if (p.id !== state.playerId && room.state === 'idle') {
        seat.style.cursor = 'pointer';
        seat.title = '点击交换座位';
        seat.addEventListener('click', () => handleSwapSeat(i));
      }
    } else {
      seat.classList.add('empty');
      seat.innerHTML = '<div class="seat-avatar">?</div><div class="seat-name">空位</div>';

      // Click empty seat to move there
      if (room.state === 'idle') {
        seat.style.cursor = 'pointer';
        seat.title = '点击移到此座位';
        seat.addEventListener('click', () => handleSwapSeat(i));
      }
    }
    table.appendChild(seat);
  }
}

function handleSwapSeat(targetSeat) {
  if (!state.room || state.room.state !== 'idle') return;
  // Don't swap with yourself
  const me = state.room.players.find(p => p.id === state.playerId);
  if (me && me.seatIndex === targetSeat) return;

  wsSend('swap_seat', { roomId: state.roomId, targetSeat });
}

function updateStartBtn(room) {
  const btn = el('startBtn'), hint = el('waitingHint');
  if (!btn) return;
  if (state.isHost) {
    show(btn);
    btn.disabled = room.players.length < 2;
    if (hint) hint.textContent = room.players.length<2
      ? '至少需要2人才能开始' : room.players.length + '人已就绪';
  } else {
    hide(btn);
    if (hint) hint.textContent = '等待房主开始...';
  }
}

function handleStartDraft() {
  if (state.isHost && state.roomId) wsSend('start_draft', { roomId: state.roomId });
}

function handleLeaveRoom() {
  if (state.roomId) wsSend('leave_room', { roomId: state.roomId });
  window.location.href = '/';
}

/* ======================== CHAT ======================== */
function addChatMessage(name, text, time, isHistory) {
  const container = el('chatMessages');
  if (!container) return;
  // Remove empty placeholder
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (!isHistory && name === state.playerName) div.classList.add('chat-own');
  const d = new Date(time);
  const ts = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  div.innerHTML = '<span class="chat-time">' + ts + '</span> ' +
    '<span class="chat-author">' + h(name) + ':</span> ' +
    '<span class="chat-text">' + h(text) + '</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function h(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function handleChatSend() {
  const input = el('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  wsSend('chat', { roomId: state.roomId, text });
  input.value = '';
}

/* ======================== DRAFT ======================== */
function renderPack() {
  const area = el('packArea'), btn = el('confirmPickBtn');
  if (!area) return;
  clear(area);
  hide(btn);

  const cards = state.draft.currentPack;
  if (!cards || cards.length === 0) {
    setText('draftStatus', '等待卡包轮转...');
    return;
  }

  for (const card of cards) {
    const cardEl = makeCardEl(card, { detailButton: true, detailSource: 'draft' });
    cardEl.addEventListener('click', () => {
      if (state.draft.phase !== 'choosing') return;
      handleSelectCard(card, cardEl);
    });
    area.appendChild(cardEl);
  }
}

function setDraftPickedCards(cards) {
  state.draft.pickedCards = Array.isArray(cards) ? cards : [];
  cacheCards(state.draft.pickedCards);
  renderDraftPickedCards();
}

function renderDraftPickedCards() {
  const sorted = sortDraftPickedCards(state.draft.pickedCards);
  const main = sorted.filter(card => !isExtraType(card.type || 0));
  const extra = sorted.filter(card => isExtraType(card.type || 0));
  const monsters = main.filter(card => isMonsterType(card.type || 0));
  const spells = main.filter(card => isSpellType(card.type || 0));
  const traps = main.filter(card => isTrapType(card.type || 0));

  setText('draftPickedTotal', state.draft.pickedCards.length + ' 张');
  setText('draftPickedMonsterCount', '(' + monsters.length + ')');
  setText('draftPickedSpellCount', '(' + spells.length + ')');
  setText('draftPickedTrapCount', '(' + traps.length + ')');
  setText('draftPickedExtraCount', '(' + extra.length + ')');
  renderDraftPickedZone('draftPickedMonster', monsters, '尚未选择主卡怪兽');
  renderDraftPickedZone('draftPickedSpell', spells, '尚未选择魔法');
  renderDraftPickedZone('draftPickedTrap', traps, '尚未选择陷阱');
  renderDraftPickedZone('draftPickedExtra', extra, '尚未选择额外');
}

function renderDraftPickedZone(zoneId, cards, emptyText) {
  const zone = el(zoneId);
  if (!zone) return;
  clear(zone);

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'draft-picked-empty';
    empty.textContent = emptyText;
    zone.appendChild(empty);
    return;
  }

  for (const card of cards) {
    const cel = makeDraftPickedThumb(card);
    cel.addEventListener('click', () => showCardDetail(card, 'pool'));
    zone.appendChild(cel);
  }
}

function makeDraftPickedThumb(card) {
  const div = document.createElement('button');
  div.type = 'button';
  div.className = 'draft-picked-thumb';
  div.dataset.id = card.id;
  div.title = (card.name || String(card.id)) + ' / ' + typeName(card.type || 0);
  div.innerHTML =
    '<img src="' + cardImgUrl(card.id) + '" alt="' + h(card.name || '') + '" loading="lazy"' +
    ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
    '<span class="draft-picked-no-img" style="display:none">无卡图</span>';
  return div;
}

function sortDraftPickedCards(cards) {
  return [...cards].sort((a, b) => {
    const groupDiff = draftPickedGroupOrder(a) - draftPickedGroupOrder(b);
    if (groupDiff) return groupDiff;

    const extraDiff = Number(isExtraType(a.type || 0)) - Number(isExtraType(b.type || 0));
    if (extraDiff) return extraDiff;

    const levelDiff = (b.level || 0) - (a.level || 0);
    if (levelDiff) return levelDiff;

    return String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-Hans-CN');
  });
}

function draftPickedGroupOrder(card) {
  const t = card.type || 0;
  if (isMonsterType(t)) return 0;
  if (isSpellType(t)) return 1;
  if (isTrapType(t)) return 2;
  return 3;
}

function handleSelectCard(card, cardEl) {
  if (state.draft.phase !== 'choosing') return;

  // Deselect previous
  if (state.draft.selectedCardEl) {
    state.draft.selectedCardEl.classList.remove('selected');
  }

  // Toggle: deselect if same card
  if (state.draft.selectedCard === card) {
    state.draft.selectedCard = null;
    state.draft.selectedCardEl = null;
    hide(el('confirmPickBtn'));
    setText('draftStatus', '点击卡牌查看详情并选择');
    return;
  }

  // Select
  state.draft.selectedCard = card;
  state.draft.selectedCardEl = cardEl;
  if (cardEl) cardEl.classList.add('selected');
  show(el('confirmPickBtn'));
  setText('draftStatus', '已选: ' + card.name + ' — 点击「确认选择」提交');
}

function handleConfirmPick() {
  if (state.draft.phase !== 'choosing' || !state.draft.selectedCard) return;

  const selected = state.draft.selectedCard;
  const idx = Number.isInteger(selected.packSlot)
    ? selected.packSlot
    : state.draft.currentPack.indexOf(selected);
  if (!Number.isInteger(idx) || idx < 0) return;

  state.draft.phase = 'waiting';
  wsSend('confirm_pick', { roomId: state.roomId, cardIndex: idx, cardId: selected.id });

  if (state.draft.selectedCardEl) {
    state.draft.selectedCardEl.classList.add('confirmed');
    state.draft.selectedCardEl.classList.remove('selected');
  }
  hide(el('confirmPickBtn'));
  setText('draftStatus', '已确认，等待其他玩家...');
}

function startTimer() {
  stopTimer();
  state.draft.seconds = 60;
  const tel = el('draftTimer'); if (tel) tel.classList.remove('urgent');
  setText('draftTimer', '剩余 ' + state.draft.seconds + 's');

  state.draft.timer = setInterval(() => {
    state.draft.seconds--;
    setText('draftTimer', '剩余 ' + state.draft.seconds + 's');
    if (state.draft.seconds <= 10) { const t = el('draftTimer'); if (t) t.classList.add('urgent'); }
    if (state.draft.seconds <= 0) {
      stopTimer();
      autoPick();
    }
  }, 1000);
}

function stopTimer() {
  if (state.draft.timer) { clearInterval(state.draft.timer); state.draft.timer = null; }
}

function autoPick() {
  const cards = state.draft.currentPack;
  if (cards.length === 0) return;

  if (!state.draft.selectedCard) {
    const idx = Math.floor(Math.random() * cards.length);
    state.draft.selectedCard = cards[idx];
    state.draft.selectedCardEl = findPackCardEl(cards[idx]);
  }

  handleConfirmPick();
}

/** Pick a random card and confirm immediately (for auto-draft mode) */
function autoPickOne() {
  if (!state.draft.autoDraft) return;
  if (state.draft.phase !== 'choosing') return;
  const cards = state.draft.currentPack;
  if (cards.length === 0) return;

  const idx = Math.floor(Math.random() * cards.length);
  state.draft.selectedCard = cards[idx];
  state.draft.selectedCardEl = findPackCardEl(cards[idx]);
  handleConfirmPick();
}

function findPackCardEl(card) {
  if (Number.isInteger(card?.packSlot)) {
    return document.querySelector('#packArea .card-item[data-pack-slot="' + card.packSlot + '"]');
  }
  return document.querySelector('#packArea .card-item[data-id="' + card.id + '"]');
}

function startAutoDraft() {
  state.draft.autoDraft = true;
  hide(el('autoDraftBtn'));
  show(el('stopAutoDraftBtn'));
  setText('draftStatus', '⚡ 自动轮抽中...');
  // Immediately pick current pack
  autoPickOne();
}

function stopAutoDraft() {
  state.draft.autoDraft = false;
  show(el('autoDraftBtn'));
  hide(el('stopAutoDraftBtn'));
  setText('draftStatus', '点击卡牌查看详情并选择');
}

/* ======================== ZONE HELPERS ======================== */
function getZoneList(key) {
  const map = {
    pool: state.results.pool, main: state.results.main, extra: state.results.extra, side: state.results.side,
    mainDeck: state.results.main, extraDeck: state.results.extra, sideDeck: state.results.side,
  };
  return map[key];
}

function findCardZone(card) {
  const keys = ['pool', 'main', 'extra', 'side'];
  for (const key of keys) {
    const list = getZoneList(key);
    if (list && list.includes(card)) return key;
  }
  return null;
}

/* ======================== RESULTS / DECK EDITOR ======================== */
function applySavedOrDefaultDeck(cards, savedDeck) {
  const ownedCards = ensureCardInstances(cards || []);
  if (savedDeck && restoreSavedDeck(ownedCards, savedDeck)) return;

  state.results.pool = [];
  state.results.main = ownedCards.filter(card => !isExtraType(card.type || 0));
  state.results.extra = ownedCards.filter(card => isExtraType(card.type || 0));
  state.results.side = [];
  queueDeckSave();
}

function restoreSavedDeck(ownedCards, savedDeck) {
  const remaining = new Map();
  for (const card of ownedCards) {
    const id = Number(card.id);
    if (!remaining.has(id)) remaining.set(id, []);
    remaining.get(id).push(card);
  }

  const take = (id) => {
    const bucket = remaining.get(Number(id));
    return bucket && bucket.length ? bucket.shift() : null;
  };
  const restoreSection = (ids) => {
    const cards = [];
    for (const id of ids || []) {
      const card = take(id);
      if (!card) return null;
      cards.push(card);
    }
    return cards;
  };

  const main = restoreSection(savedDeck.main);
  const extra = restoreSection(savedDeck.extra);
  const side = restoreSection(savedDeck.side);
  const pool = restoreSection(savedDeck.pool);
  if (!main || !extra || !side || !pool) return false;

  const leftovers = [];
  for (const bucket of remaining.values()) leftovers.push(...bucket);
  state.results.main = main;
  state.results.extra = extra;
  state.results.side = side;
  state.results.pool = [...pool, ...leftovers];
  return true;
}

function initResults() {
  renderPool();
  renderDeckZone('mainDeck', state.results.main);
  renderDeckZone('extraDeck', state.results.extra);
  renderDeckZone('sideDeck', state.results.side);
  updateCounts();
}

function renderPool() {
  const grid = el('poolGrid'); if (!grid) return;
  clear(grid);
  if (!state.results.pool.length) {
    grid.appendChild(makeEmptyDeckHint('没有未加入卡片'));
  }
  for (let i = 0; i < state.results.pool.length; i++) {
    const card = state.results.pool[i];
    const cel = makeDeckThumbEl(card, 'pool', i);
    grid.appendChild(cel);
  }
  setText('poolCount', '(' + state.results.pool.length + '张)');
}

function renderDeckZone(zoneId, cards) {
  const zone = el(zoneId);
  if (!zone) return;
  clear(zone);
  if (!cards.length) {
    zone.appendChild(makeEmptyDeckHint('这里还没有卡片'));
  }
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cel = makeDeckThumbEl(card, zoneId, i);
    zone.appendChild(cel);
  }
}

function makeEmptyDeckHint(text) {
  const div = document.createElement('div');
  div.className = 'deck-empty';
  div.textContent = text;
  return div;
}

function makeDeckThumbEl(card, zoneId, index) {
  const div = document.createElement('div');
  div.className = 'deck-card-thumb';
  div.draggable = true;
  div.dataset.inst = ensureCardInstance(card);
  div.dataset.zone = zoneId;
  div.dataset.index = String(index);

  const img = document.createElement('img');
  img.className = 'deck-card-img';
  img.src = cardImgUrl(card.id);
  img.alt = card.name || '';
  img.loading = 'lazy';

  const fallback = document.createElement('div');
  fallback.className = 'deck-card-no-img hidden';
  fallback.textContent = '无卡图';
  img.addEventListener('error', () => {
    img.classList.add('hidden');
    fallback.classList.remove('hidden');
  });

  const action = document.createElement('button');
  action.type = 'button';
  action.className = zoneId === 'pool' ? 'deck-card-action add' : 'deck-card-action remove';
  action.title = zoneId === 'pool' ? '加入卡组' : '移出到未加入卡池';
  action.setAttribute('aria-label', action.title);
  action.textContent = zoneId === 'pool' ? '+' : 'x';

  const name = document.createElement('div');
  name.className = 'deck-card-name';
  name.textContent = card.name || '???';

  div.append(img, fallback, action, name);

  div.addEventListener('click', (e) => {
    if (e.target === action) return;
    showCardDetail(card, 'pool');
  });
  div.addEventListener('dblclick', () => {
    if (zoneId === 'pool') moveCard(card, 'pool', defaultDeckZoneForCard(card));
    else moveCard(card, zoneId, 'pool');
  });
  action.addEventListener('click', (e) => {
    e.stopPropagation();
    if (zoneId === 'pool') moveCard(card, 'pool', defaultDeckZoneForCard(card));
    else moveCard(card, zoneId, 'pool');
  });
  div.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-card-instance', ensureCardInstance(card));
    e.dataTransfer.setData('text/plain', String(card.id));
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => div.classList.add('dragging'), 0);
  });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));

  return div;
}

function defaultDeckZoneForCard(card) {
  return isExtraType(card.type || 0) ? 'extra' : 'main';
}

function findCardByInstance(instanceId) {
  if (!instanceId) return null;
  for (const card of getAllDraftedCards()) {
    if (ensureCardInstance(card) === instanceId) return card;
  }
  return null;
}

function canMoveCardToZone(card, to) {
  if (!card || !to) return false;
  if (to === 'main' || to === 'mainDeck') return !isExtraType(card.type || 0);
  if (to === 'extra' || to === 'extraDeck') return isExtraType(card.type || 0);
  return true;
}

function getDropInsertIndex(zone, event) {
  const target = event.target?.closest?.('.deck-card-thumb');
  if (!target || !zone.contains(target)) return null;

  const items = [...zone.querySelectorAll('.deck-card-thumb')];
  const targetIndex = items.indexOf(target);
  if (targetIndex < 0) return null;

  const rect = target.getBoundingClientRect();
  const columns = getComputedStyle(zone).gridTemplateColumns.split(' ').filter(Boolean).length;
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;
  const sameRowBand = Math.abs(event.clientY - centerY) < rect.height * 0.35;
  const before = columns > 1 && sameRowBand
    ? event.clientX < centerX
    : event.clientY < centerY;
  return targetIndex + (before ? 0 : 1);
}

function moveCard(card, from, to, insertIndex = null) {
  if (!canMoveCardToZone(card, to)) {
    const targetText = to === 'extra' || to === 'extraDeck' ? '额外卡组' : '主卡组';
    alert('这张卡不能放入' + targetText);
    return;
  }

  const src = getZoneList(from);
  let oldIndex = -1;
  if (src) {
    oldIndex = src.indexOf(card);
    if (oldIndex >= 0) src.splice(oldIndex, 1);
  }

  const dst = getZoneList(to);
  if (dst) {
    if (src === dst && oldIndex >= 0 && insertIndex !== null && oldIndex < insertIndex) {
      insertIndex--;
    }
    if (insertIndex === null || insertIndex < 0 || insertIndex > dst.length) {
      dst.push(card);
    } else {
      dst.splice(insertIndex, 0, card);
    }
  }

  renderPool();
  renderDeckZone('mainDeck', state.results.main);
  renderDeckZone('extraDeck', state.results.extra);
  renderDeckZone('sideDeck', state.results.side);
  updateCounts();
  queueDeckSave();
}

function updateCounts() {
  setText('mainCount', '(' + state.results.main.length + '/40-60)');
  setText('extraCount', '(' + state.results.extra.length + '/0-15)');
  setText('sideCount', '(' + state.results.side.length + '/0-15)');

  const warn = el('deckWarning');
  if (!warn) return;
  if (state.results.main.length < 40) {
    show(warn); setText('deckWarning', '主卡组至少40张 (当前' + state.results.main.length + ')');
  } else if (state.results.main.length > 60) {
    show(warn); setText('deckWarning', '主卡组最多60张 (当前' + state.results.main.length + ')');
  } else if (state.results.extra.length > 15) {
    show(warn); setText('deckWarning', '额外最多15张 (当前' + state.results.extra.length + ')');
  } else { hide(warn); }
}

function buildYdk() {
  const ids = (cards) => cards.map(c => c.id);
  return buildYdkFromIds(
    ids(state.results.main),
    ids(state.results.extra),
    ids(state.results.side),
    'USTC-OnlineCube',
  );
}

function serializeDeckState() {
  const ids = (cards) => cards.map(c => Number(c.id)).filter(id => Number.isFinite(id) && id > 0);
  return {
    main: ids(state.results.main),
    extra: ids(state.results.extra),
    side: ids(state.results.side),
    pool: ids(state.results.pool),
  };
}

function queueDeckSave() {
  if (!state.roomId || !state.playerId || state.draft.phase !== 'done') return;
  clearTimeout(deckSaveTimer);
  deckSaveTimer = setTimeout(() => {
    wsSend('save_deck', { roomId: state.roomId, deck: serializeDeckState() });
  }, 250);
}

function buildYdkFromIds(mainIds, extraIds, sideIds, label) {
  return '#created by ' + label + '\n#main\n' +
    mainIds.join('\n') + '\n' +
    '#extra\n' + extraIds.join('\n') + '\n' +
    '!side\n' + sideIds.join('\n') + '\n';
}

function parseYdkCounts(content) {
  const counts = { main: 0, extra: 0, side: 0 };
  let section = 'main';
  for (const line of (content || '').split('\n')) {
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

async function buildTestModeYdk() {
  const allDrafted = getAllDraftedCards();
  const mainCandidates = allDrafted.filter(card => !isExtraType(card.type));
  const extraCandidates = allDrafted.filter(card => isExtraType(card.type));

  if (mainCandidates.length < 40) {
    throw new Error(
      '轮抽卡池主卡组数量不够：需要至少 40 张可放入主卡组的卡，当前只有 ' +
      mainCandidates.length + ' 张。额外卡 ' + extraCandidates.length + ' 张不能计入主卡组。',
    );
  }

  const cardStatus = await fetchCardScriptStatus([...mainCandidates, ...extraCandidates].map(card => card.id));
  const loadableMainCandidates = mainCandidates.filter(card => isCardLoadable(cardStatus, card.id));
  const loadableExtraCandidates = extraCandidates.filter(card => isCardLoadable(cardStatus, card.id));

  if (loadableMainCandidates.length < 40) {
    const missingMain = mainCandidates
      .filter(card => !isCardLoadable(cardStatus, card.id))
      .slice(0, 8)
      .map(card => card.name ? card.name + '(' + card.id + ')' : String(card.id));
    throw new Error(
      '轮抽卡池可用于对战的主卡组数量不够：需要至少 40 张可装载主卡，当前只有 ' +
      loadableMainCandidates.length + ' 张。通常怪兽允许没有 Lua 脚本；无法装载示例：' + (missingMain.join('、') || '无') + '。',
    );
  }

  const mainIds = shuffleCopy(loadableMainCandidates)
    .slice(0, 40)
    .map(card => card.id);
  const extraIds = shuffleCopy(loadableExtraCandidates)
    .slice(0, 15)
    .map(card => card.id);

  return buildYdkFromIds(mainIds, extraIds, [], 'USTC-OnlineCube Test Mode Pool');
}

async function fetchCardScriptStatus(ids) {
  const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id) && id > 0))];
  if (!uniqueIds.length) return new Map();

  const res = await fetch('/api/cards/script-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: uniqueIds }),
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || data.error) {
    throw new Error(data.error || '无法检查卡片脚本状态，请确认服务端已启动且 YGO_SCRIPT_PATH 正确');
  }

  const result = new Map();
  const details = data.details || {};
  for (const [id, loadable] of Object.entries(data.results || {})) {
    const parsedId = parseInt(id, 10);
    result.set(parsedId, details[id] || { loadable: loadable === true });
  }
  return result;
}

function isCardLoadable(statusMap, id) {
  const status = statusMap.get(parseInt(id, 10));
  if (typeof status === 'boolean') return status;
  return status?.loadable === true;
}

function getAllDraftedCards() {
  return [
    ...state.results.pool,
    ...state.results.main,
    ...state.results.extra,
    ...state.results.side,
  ];
}

function shuffleCopy(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function handleExportYdk() {
  const content = buildYdk();
  setText('ydkContent', content);
  // Store for potential copy into battle deck input
  window._lastYdk = content;
  show(el('ydkModal'));
}

function handleCopyYdk() {
  navigator.clipboard.writeText(buildYdk()).then(() => {
    const b = el('copyYdkBtn'); if (b) { b.textContent = '已复制'; setTimeout(()=>{b.textContent='复制';},2000); }
  });
}

function handleDownloadYdk() {
  const blob = new Blob([buildYdk()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deck-' + Date.now() + '.ydk';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ======================== BATTLE LOBBY ======================== */

function updateTableFromServer(t) {
  if (!t) return;
  const idx = state.battle.tables.findIndex(bt => bt.id === t.id);
  if (idx >= 0) state.battle.tables[idx] = t;
  else state.battle.tables.push(t);
  if (state._pendingDuelTable === t.id && t.state !== 'dueling') {
    clearNeosDuelPrompt();
  }
}

function renderBattleTables() {
  const container = el('battleTables');
  if (!container) return;
  clear(container);

  if (!state.battle.tables.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-dim)">没有对战桌</p>';
    return;
  }

  const playerNames = {};
  if (state.room?.players) {
    for (const p of state.room.players) playerNames[p.id] = p.name;
  }

  for (const t of state.battle.tables) {
    const card = document.createElement('div');
    card.className = 'battle-table-card ' + t.state;
    const seats = [];
    for (let i = 0; i < 2; i++) {
      const pid = typeof t.seats[i] === 'object' ? t.seats[i]?.id : t.seats[i];
      const isMe = pid === state.playerId;
      const display = pid ? (playerNames[pid] || (typeof pid === 'string' ? pid.slice(0, 8) : '')) : '';
      seats.push(pid
        ? `<div class="bt-seat filled ${isMe ? 'you' : ''}">玩家${i+1}: ${display}${isMe ? ' (你)' : ''}</div>`
        : `<div class="bt-seat empty">玩家${i+1}: 空位</div>`);
    }

    const filledSeats = t.seats.filter(s => {
      const pid = typeof s === 'object' ? s?.id : s;
      return !!pid;
    }).length;
    const mySeat = t.seats.findIndex(s => {
      const pid = typeof s === 'object' ? s?.id : s;
      return pid === state.playerId;
    });

    const statusText = getBattleTableStatusText(t, filledSeats, playerNames);

    card.innerHTML = `
      <h4>对战桌 ${t.id}</h4>
      ${seats.join('')}
      <div style="margin-top:8px;font-size:0.75rem;color:var(--text-dim)">
        ${statusText}
      </div>
    `;

    if (t.state === 'waiting' && mySeat < 0) {
      for (let i = 0; i < 2; i++) {
        const pid = typeof t.seats[i] === 'object' ? t.seats[i]?.id : t.seats[i];
        if (!pid) {
          const btn = document.createElement('button');
          btn.className = 'btn-primary btn-sm';
          btn.style.marginTop = '8px';
          btn.textContent = '加入座位 ' + (i + 1);
          btn.onclick = () => {
            wsSend('battle_join_table', { tableId: t.id, seatIndex: i });
          };
          card.appendChild(btn);
          break;
        }
      }
    }

    if (mySeat >= 0 && t.state !== 'dueling') {
      const actions = document.createElement('div');
      actions.className = 'bt-actions';

      if (t.state === 'finished' && filledSeats === 2) {
        const rematchBtn = document.createElement('button');
        rematchBtn.className = 'btn-primary btn-sm';
        rematchBtn.textContent = '再战';
        rematchBtn.onclick = () => {
          wsSend('battle_rematch_table', { tableId: t.id });
        };
        actions.appendChild(rematchBtn);
      }

      const leaveBtn = document.createElement('button');
      leaveBtn.className = 'btn-secondary btn-sm';
      leaveBtn.textContent = '离开桌子';
      leaveBtn.onclick = () => {
        wsSend('battle_leave_table', { tableId: t.id });
      };
      actions.appendChild(leaveBtn);
      card.appendChild(actions);
    }

    if (mySeat >= 0 && t.state === 'dueling') {
      const reopenBtn = document.createElement('button');
      reopenBtn.className = 'btn-primary btn-sm';
      reopenBtn.style.marginTop = '10px';
      reopenBtn.textContent = '重新打开对战';
      reopenBtn.onclick = () => {
        const passWd = t.duelPassWd || battlePasswdFromTableId(t.id);
        const duelUrl = `/neos/duelroom?passwd=${encodeURIComponent(passWd)}&player=${encodeURIComponent(state.playerName || 'Player')}`;
        window.open(duelUrl, '_blank');
      };
      card.appendChild(reopenBtn);

      const hint = document.createElement('div');
      hint.className = 'bt-hint';
      hint.textContent = '对战中不能离桌，请先在 neos 对战界面结束或投降。';
      card.appendChild(hint);
    }

    // YDK submit area for seated players before both decks are ready.
    if (t.state === 'waiting' && mySeat >= 0) {
      const ydkArea = document.createElement('div');
      ydkArea.style.marginTop = '10px';
      ydkArea.innerHTML = `
        <textarea id="ydkInput_${t.id}" placeholder="在此粘贴你的 YDK 卡组..." 
          style="width:100%;height:60px;font-size:0.75rem;margin-bottom:4px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;resize:vertical"></textarea>
        <button id="submitYdkBtn_${t.id}" class="btn-primary btn-sm">提交卡组 (${t.id})</button>
      `;
      card.appendChild(ydkArea);

      // Auto-fill from last exported YDK
      setTimeout(() => {
        const ta = el(`ydkInput_${t.id}`);
        const btn = el(`submitYdkBtn_${t.id}`);
        if (ta) {
          if (state.room?.testMode) {
            ta.value = '';
            ta.placeholder = '点击“测试模式：从轮抽池随机组卡并提交”会先检查卡片可装载性，再生成可开局测试卡组';
          } else {
            ta.value = window._lastYdk || buildYdk();
          }
        }
        if (btn) btn.onclick = () => {
          const content = ta?.value?.trim();
          if (!content) { alert('请先粘贴 YDK 卡组内容'); return; }
          const counts = parseYdkCounts(content);
          if (counts.main < 40 || counts.main > 60) {
            alert('浏览器对战要求主卡组为 40-60 张；当前为 ' + counts.main + ' 张。');
            return;
          }
          if (counts.extra > 15) {
            alert('浏览器对战要求额外卡组最多 15 张；当前为 ' + counts.extra + ' 张。');
            return;
          }
          if (counts.side > 15) {
            alert('浏览器对战要求副卡组最多 15 张；当前为 ' + counts.side + ' 张。');
            return;
          }
          wsSend('battle_submit_deck', { tableId: t.id, ydkContent: content });
          if (btn) btn.textContent = '已提交';
          if (ta) ta.disabled = true;
        };

        if (state.room?.testMode) {
          const quickBtn = document.createElement('button');
          quickBtn.className = 'btn-secondary btn-sm';
          quickBtn.style.marginLeft = '8px';
          quickBtn.textContent = '测试模式：从轮抽池随机组卡并提交';
          quickBtn.onclick = async () => {
            let generated;
            const originalText = quickBtn.textContent;
            quickBtn.disabled = true;
            quickBtn.textContent = '正在检查卡片...';
            try {
              generated = await buildTestModeYdk();
            } catch (e) {
              alert(e.message || '轮抽卡池数量不够，无法生成测试卡组');
              quickBtn.disabled = false;
              quickBtn.textContent = originalText;
              return;
            }
            if (ta) ta.value = generated;
            wsSend('battle_submit_deck', { tableId: t.id, ydkContent: generated });
            if (btn) btn.textContent = '已提交';
            if (ta) ta.disabled = true;
            quickBtn.textContent = '已提交轮抽池测试卡组';
            quickBtn.disabled = true;
          };
          btn?.insertAdjacentElement('afterend', quickBtn);
        }
      }, 100);
    }

    container.appendChild(card);
  }
}

function showBattleLobby() {
  renderBattleTables();
  showView('battleLobby');
}

function getBattleTableStatusText(t, filledSeats, playerNames) {
  if (t.state === 'waiting') {
    return filledSeats === 2 ? '双方就座，等待提交卡组' : '等待玩家加入 (' + filledSeats + '/2)';
  }
  if (t.state === 'ready') return '双方就绪，正在启动对战';
  if (t.state === 'dueling') return '对战中';
  if (t.state === 'finished') {
    const winnerSeat = Number.isInteger(t.winnerSeat) ? t.winnerSeat : null;
    if (winnerSeat === null || winnerSeat < 0 || winnerSeat > 1) return '已结束';
    const winnerSeatData = t.seats[winnerSeat];
    const winnerId = typeof winnerSeatData === 'object' ? winnerSeatData?.id : winnerSeatData;
    const winnerName = winnerId ? (playerNames[winnerId] || String(winnerId).slice(0, 8)) : '';
    return winnerName ? '已结束，胜者：' + winnerName : '已结束';
  }
  return '未知状态';
}

function clearNeosDuelPrompt() {
  const prompt = el('neosDuelContainer');
  if (prompt) prompt.remove();
  state._pendingDuelUrl = null;
  state._pendingDuelTable = null;
}

function battlePasswdFromTableId(tableId) {
  return 'cube_' + String(tableId || '').replace(/\W/g, '').slice(0, 14);
}

/**
 * Handle neos-ts duel launch response from server.
 * When both players submit YDKs, server auto-creates a ygopro room.
 * Opens the neos-ts duel page in a new window/tab instead of an iframe.
 * Uses a click-to-open button to avoid popup blockers.
 */
function handleLaunchNeos(payload) {
  if (!isDuelLaunchForCurrentPlayer(payload)) return;

  if (payload.error) {
    alert('对战启动失败: ' + payload.error);
    return;
  }

  const { passWd, neosUrl, players, instructions } = payload;
  const playerName = state.playerName || 'Player';
  const duelUrl = `/neos/duelroom?passwd=${encodeURIComponent(passWd)}&player=${encodeURIComponent(playerName)}`;

  // Store the latest duel URL for button click
  state._pendingDuelUrl = duelUrl;
  state._pendingDuelTable = payload.tableId || null;

  // Show launch button in the battle lobby
  let container = el('neosDuelContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'neosDuelContainer';
    container.style.cssText = 'margin-top:16px;border-top:1px solid var(--border);padding-top:12px;';
    el('battleLobby')?.appendChild(container);
  }

  container.innerHTML = `
    <h3 style="margin-bottom:8px">🎮 对战已就绪</h3>
    <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:320px">
        <p style="margin-bottom:12px">双方卡组已提交。点击下方按钮在新窗口中打开对战。</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <a href="${duelUrl}" target="_blank" rel="noopener"
             class="btn-primary btn-large"
             style="display:inline-block;padding:12px 24px;text-decoration:none;font-size:1rem">
            🎮 在新窗口中打开对战
          </a>
          <button id="openDuelNewWindowBtn" class="btn-primary btn-large">
            🎮 打开对战
          </button>
        </div>
        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:8px">
          房间密码: <code style="color:var(--highlight)">${passWd}</code> &middot;
          玩家: <strong>${playerName}</strong>
        </div>
      </div>
      <div style="flex:0 0 240px;font-size:0.85rem;color:var(--text-dim);background:var(--bg);padding:10px;border-radius:6px">
        <strong>📋 说明</strong>
        <ol style="margin:8px 0 0 0;padding-left:18px">
          <li>点击上方按钮在新窗口中打开对战</li>
          <li>会自动连接房间并进入待战状态</li>
          <li>双方准备就绪后自动开始对战</li>
          <li>对战中可点击卡片查看详情</li>
          <li><strong>不要关闭此页面</strong>，结束后返回这里查看结果</li>
        </ol>
      </div>
    </div>
  `;

  // Try window.open directly (may be blocked by popup blocker)
  const newWin = window.open(duelUrl, '_blank');
  if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
    // Popup was blocked — user must click manually
    const btn = el('openDuelNewWindowBtn');
    if (btn) {
      btn.textContent = '⚠️ 请手动点击打开对战';
      btn.onclick = () => {
        const w = window.open(duelUrl, '_blank');
        if (!w || w.closed) {
          const link = el('openDuelNewWindowBtn');
          if (link) {
            link.outerHTML = `<a href="${duelUrl}" target="_blank" rel="noopener" class="btn-primary btn-large" style="display:inline-block;padding:12px 24px;text-decoration:none;font-size:1rem">点击打开对战 (新标签页)</a>`;
          }
        }
      };
    }
  } else {
    // Opened successfully — clean up button
    const btn = el('openDuelNewWindowBtn');
    if (btn) btn.remove();
  }
}

function isDuelLaunchForCurrentPlayer(payload) {
  if (!payload) return false;

  if (Array.isArray(payload.playerIds)) {
    return payload.playerIds.includes(state.playerId);
  }

  if (!payload.tableId) return true;
  const table = state.battle.tables.find(t => t.id === payload.tableId);
  if (!table) return true;

  return table.seats.some(seat => {
    const pid = typeof seat === 'object' ? seat?.id : seat;
    return pid === state.playerId;
  });
}

function backToResults() {
  showView('results');
  renderPool();
  renderDeckZone('mainDeck', state.results.main);
  renderDeckZone('extraDeck', state.results.extra);
  renderDeckZone('sideDeck', state.results.side);
  updateCounts();
}

/* ======================== INIT ======================== */
function bindEvents() {
  el('startBtn')?.addEventListener('click', handleStartDraft);
  el('leaveBtn')?.addEventListener('click', handleLeaveRoom);
  el('confirmPickBtn')?.addEventListener('click', handleConfirmPick);
  el('autoDraftBtn')?.addEventListener('click', startAutoDraft);
  el('stopAutoDraftBtn')?.addEventListener('click', stopAutoDraft);
  el('exportYdkBtn')?.addEventListener('click', handleExportYdk);
  el('backToLobbyBtn')?.addEventListener('click', handleLeaveRoom);
  el('copyYdkBtn')?.addEventListener('click', handleCopyYdk);
  el('downloadYdkBtn')?.addEventListener('click', handleDownloadYdk);
  el('closeYdkModal')?.addEventListener('click', () => hide(el('ydkModal')));

  // Chat
  el('chatSendBtn')?.addEventListener('click', handleChatSend);
  el('chatInput')?.addEventListener('keydown', (e) => { if (e.key==='Enter') handleChatSend(); });

  // Card detail modal
  el('cardDetailCloseBtn')?.addEventListener('click', closeCardDetail);
  el('cardDetailPickBtn')?.addEventListener('click', handleDetailPick);
  el('cardDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target === el('cardDetailOverlay')) closeCardDetail();
  });

  // Battle lobby
  el('backToResultsBtn')?.addEventListener('click', backToResults);

  // "Go to battle" button in results — add after export buttons
  const battleBtn = el('goBattleBtn');
  if (!battleBtn && el('deckActions')) {
    const btn = document.createElement('button');
    btn.id = 'goBattleBtn';
    btn.className = 'btn-primary';
    btn.textContent = '进入对战房间';
    btn.addEventListener('click', showBattleLobby);
    el('deckActions').appendChild(btn);
  }

  const dropSetup = (zoneId, deckKey) => {
    const zone = el(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const instanceId = e.dataTransfer.getData('application/x-card-instance');
      const card = findCardByInstance(instanceId);
      if (card) {
        const from = findCardZone(card) || 'pool';
        moveCard(card, from, deckKey, getDropInsertIndex(zone, e));
      }
    });
  };
  dropSetup('poolGrid', 'pool');
  dropSetup('mainDeck', 'main');
  dropSetup('extraDeck', 'extra');
  dropSetup('sideDeck', 'side');
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');
  const name = params.get('name');
  const password = params.get('password') || null;

  if (!roomId || !name) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center"><h1>缺少房间参数</h1><p><a href="/">返回大厅</a></p></div>';
    return;
  }

  state.roomId = roomId;
  state.playerName = name;
  state.roomPassword = password;

  setupHandlers();
  bindEvents();
  wsClient.connect();
  console.log('[Room] Ready, joining ' + roomId + ' as ' + name);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/**
 * Cube Draft - Room/Draft/Results Page
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
  div.innerHTML = cardHTML(card, opts.small);

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

  // Find the card element in packArea
  const nel = document.querySelector('#packArea .card-item[data-id="' + state.detailCard.id + '"]');
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
    showView('room');
    updateRoomUI(p.room);
    const url = new URL(window.location);
    url.searchParams.set('roomId', p.room.id);
    url.searchParams.set('name', p.playerName);
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
    showView('draft');
    setText('roundInfo', '第 1/' + state.draft.totalPacks + ' 包');
    setText('draftDirection', '');
    clear('packArea');
    hide(el('confirmPickBtn'));
    hide(el('autoDraftBtn'));
    hide(el('stopAutoDraftBtn'));
    setText('draftStatus', '准备开始...');
    show(el('draftStatus'));
  });

  wsClient.on('pack', (msg) => {
    const p = msg.payload;
    state.draft.packIndex = p.packIndex || 0;
    state.draft.totalPacks = p.totalPacks || state.draft.totalPacks || 4;
    state.draft.currentPack = p.cards || [];
    state.draft.direction = p.direction || 1;
    state.draft.remainingInPack = p.remaining;
    state.draft.phase = 'choosing';
    state.draft.seconds = 60;
    state.draft.selectedCard = null;
    state.draft.selectedCardEl = null;
    cacheCards(state.draft.currentPack);

    const isTestMode = state.room?.testMode === true;

    setText('roundInfo', '第 ' + (state.draft.packIndex+1) + '/' + state.draft.totalPacks + ' 包 (剩' + (state.draft.remainingInPack||0) + '张)');
    setText('draftDirection', state.draft.direction===1 ? '→ 向右传' : '← 向左传');
    if (state.draft.autoDraft) {
      setText('draftStatus', '⚡ 自动轮抽中...');
    } else {
      setText('draftStatus', '点击卡牌查看详情并选择');
    }
    hide(el('confirmPickBtn'));

    // Show/hide auto-draft buttons based on test mode
    if (isTestMode) {
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
    startTimer();

    // Auto-pick if auto-draft is on
    if (state.draft.autoDraft) {
      setTimeout(() => autoPickOne(), 300);
    }
  });

  wsClient.on('pick_result', (msg) => {
    const r = msg.payload;
    if (!r.success) return;
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
    state.draft.phase = 'done';
    state.draft.autoDraft = false;
    hide(el('autoDraftBtn'));
    hide(el('stopAutoDraftBtn'));
    const myPool = msg.payload.pools[state.playerId];
    if (myPool) {
      cacheCards(myPool.cards || []);
      state.results.pool = myPool.cards || [];
      state.results.main = [];
      state.results.extra = [];
      state.results.side = [];
    }
    // Store tables for battle lobby
    if (msg.payload.tables) {
      state.battle.tables = msg.payload.tables;
    }
    initResults();
    showView('results');
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

  wsClient.on('battle_tables_ready', (msg) => {
    state.battle.tables = msg.payload.tables;
    renderBattleTables();
  });

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
    const cardEl = makeCardEl(card);
    cardEl.addEventListener('click', () => {
      if (state.draft.phase !== 'choosing') return;
      showCardDetail(card, 'draft');
    });
    area.appendChild(cardEl);
  }
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
  cardEl.classList.add('selected');
  show(el('confirmPickBtn'));
  setText('draftStatus', '已选: ' + card.name + ' — 点击「确认选择」提交');
}

function handleConfirmPick() {
  if (state.draft.phase !== 'choosing' || !state.draft.selectedCard) return;

  const idx = state.draft.currentPack.indexOf(state.draft.selectedCard);
  if (idx < 0) return;

  state.draft.phase = 'waiting';
  wsSend('confirm_pick', { roomId: state.roomId, cardIndex: idx });

  state.draft.selectedCardEl.classList.add('confirmed');
  state.draft.selectedCardEl.classList.remove('selected');
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
    state.draft.selectedCardEl = document.querySelector('#packArea .card-item[data-id="' + cards[idx].id + '"]');
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
  state.draft.selectedCardEl = document.querySelector('#packArea .card-item[data-id="' + cards[idx].id + '"]');
  handleConfirmPick();
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
  for (const card of state.results.pool) {
    const cel = makeCardEl(card, { draggable: true });
    cel.addEventListener('click', () => showCardDetail(card, 'pool'));
    cel.addEventListener('dblclick', () => {
      const target = isExtraType(card.type) ? 'extra' : 'main';
      moveCard(card, 'pool', target);
    });
    grid.appendChild(cel);
  }
  setText('poolCount', '(' + state.results.pool.length + '张)');
}

function renderDeckZone(zoneId, cards) {
  const zone = el(zoneId);
  if (!zone) return;
  clear(zone);
  for (const card of cards) {
    const cel = makeCardEl(card, { small: true });
    cel.addEventListener('click', () => showCardDetail(card, 'pool'));
    cel.addEventListener('dblclick', () => moveCard(card, zoneId, 'pool'));
    zone.appendChild(cel);
  }
}

function moveCard(card, from, to) {
  const src = getZoneList(from);
  if (src) {
    const i = src.indexOf(card);
    if (i >= 0) src.splice(i, 1);
  }

  const dst = getZoneList(to);
  if (dst) {
    if (!dst.includes(card)) dst.push(card);
  }

  renderPool();
  renderDeckZone('mainDeck', state.results.main);
  renderDeckZone('extraDeck', state.results.extra);
  renderDeckZone('sideDeck', state.results.side);
  updateCounts();
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
  return '#created by Cube Draft\n#main\n' +
    ids(state.results.main).join('\n') + '\n' +
    '#extra\n' + ids(state.results.extra).join('\n') + '\n' +
    '!side\n' + ids(state.results.side).join('\n') + '\n';
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

    card.innerHTML = `
      <h4>对战桌 ${t.id}</h4>
      ${seats.join('')}
      <div style="margin-top:8px;font-size:0.75rem;color:var(--text-dim)">
        ${t.state === 'waiting' ? (filledSeats === 2 ? '双方就座' : '等待玩家加入 (' + filledSeats + '/2)') : t.state === 'ready' ? '双方就绪' : t.state === 'dueling' ? '对战中' : '已结束'}
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

    // YDK submit area for seated players (in waiting state)
    if ((t.state === 'waiting' || t.state === 'ready') && mySeat >= 0) {
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
        if (ta && window._lastYdk) ta.value = window._lastYdk;
        if (btn) btn.onclick = () => {
          const content = ta?.value?.trim();
          if (!content) { alert('请先粘贴 YDK 卡组内容'); return; }
          wsSend('battle_submit_deck', { tableId: t.id, ydkContent: content });
          if (btn) btn.textContent = '已提交';
          if (ta) ta.disabled = true;
        };
      }, 100);
    }

    container.appendChild(card);
  }
}

function showBattleLobby() {
  renderBattleTables();
  showView('battleLobby');
}

/**
 * Handle neos-ts duel launch response from server.
 * When both players submit YDKs, server auto-creates a ygopro room.
 * Show the password and link to both players.
 */
function handleLaunchNeos(payload) {
  if (payload.error) {
    alert('对战启动失败: ' + payload.error);
    return;
  }

  const { passWd, neosUrl, players, instructions } = payload;

  // Create or update a launch info panel in the battle lobby
  let panel = el('neosLaunchPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'neosLaunchPanel';
    panel.className = 'modal';
    el('battleLobby')?.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="modal-content" style="max-width:520px">
      <h3>🎮 在线对战已就绪!</h3>
      <div style="background:var(--bg);padding:12px;border-radius:6px;margin:10px 0">
        <p><strong>房间密码:</strong> <code style="font-size:1.2rem;color:var(--highlight)">${passWd}</code></p>
        <p><strong>对战双方:</strong> ${(players || []).join(' vs ')}</p>
      </div>
      <div style="margin:12px 0">
        <a href="${neosUrl}" target="_blank" rel="noopener" 
           style="display:inline-block;padding:10px 20px;background:var(--highlight);color:white;text-decoration:none;border-radius:6px;font-weight:bold">
          🚀 打开对战客户端
        </a>
      </div>
      <div style="font-size:0.85rem;color:var(--text-dim);margin:8px 0">
        ${instructions || '打开链接后，点击「自定义房间」卡片，输入昵称和上方房间密码'}
      </div>
      <div style="font-size:0.8rem;color:var(--text-dim);margin-top:12px">
        <strong>步骤:</strong>
        <ol style="margin:4px 0 0 16px">
          <li>点击上方按钮打开 neos-ts 对战页面</li>
          <li>点击页面中的 <em>自定义房间</em> 卡片（齿轮图标）</li>
          <li>输入玩家名和房间密码 <code>${passWd}</code>，点击「加入房间」</li>
          <li>等待对手也加入 → 自动开始对战!</li>
        </ol>
      </div>
      <button class="btn-secondary" style="margin-top:12px" onclick="document.getElementById('neosLaunchPanel').classList.add('hidden')">关闭</button>
    </div>
  `;
  panel.classList.remove('hidden');
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
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', e => {
      e.preventDefault();
      const cid = parseInt(e.dataTransfer.getData('text/plain'));
      const all = [...state.results.pool, ...state.results.main, ...state.results.extra, ...state.results.side];
      const card = all.find(c => c.id === cid);
      if (card) {
        const from = findCardZone(card) || 'pool';
        moveCard(card, from, deckKey);
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
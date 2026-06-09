/**
 * USTC-OnlineCube - Lobby Page
 * Handles room creation and joining. Redirects to room.html on success.
 */

/* ======================== DOM UTILS ======================== */
const el = (id) => document.getElementById(id);
const MAX_PLAYERS = 12;
const MAX_PACKS_PER_PLAYER = 8;
let cubeCounts = new Map();

function show(e) { e?.classList.remove('hidden'); }
function hide(e) { e?.classList.add('hidden'); }
function h(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/* ======================== API HELPERS ======================== */
async function apiGet(url) {
  try { const r = await fetch(url); return await r.json(); }
  catch(e) { return { error: e.message }; }
}

async function apiPost(url, body) {
  try {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return await r.json();
  } catch(e) { return { error: e.message }; }
}

/* ======================== LOBBY ======================== */
async function loadCubes() {
  const sel = el('cubeSelect');
  if (!sel) return;
  const data = await apiGet('/api/cubes');
  const cubes = data.cubes || [];
  cubeCounts = new Map(cubes.map(c => [String(c.name), Number(c.count) || 0]));
  sel.innerHTML = '';
  if (!cubes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '没有可用Cube';
    sel.appendChild(opt);
    return;
  }
  for (const cube of cubes) {
    const count = Number(cube.count) || 0;
    const opt = document.createElement('option');
    opt.value = cube.name;
    opt.dataset.count = String(count);
    opt.textContent = cube.name + ' (' + count + '张)';
    sel.appendChild(opt);
  }
}

async function loadRooms() {
  const list = el('roomList');
  if (!list) return;

  const data = await apiGet('/api/rooms');
  if (data.error) {
    list.innerHTML = '<div class="room-list-empty">房间列表加载失败</div>';
    return;
  }

  const rooms = data.rooms || [];
  if (!rooms.length) {
    list.innerHTML = '<div class="room-list-empty">暂无可显示房间</div>';
    return;
  }

  list.innerHTML = rooms.map(room => roomRowHTML(room)).join('');
}

function roomRowHTML(room) {
  const stateLabel = room.state === 'idle' ? '等待中' : (room.state === 'drafting' ? '轮抽中' : '已完成');
  const lock = room.hasPassword ? '有密码' : '公开';
  const testMode = room.testMode ? '测试' : '';
  const disabled = room.canJoin ? '' : ' disabled';
  const buttonText = room.canJoin ? '加入' : (room.state === 'idle' ? '已满' : '不可加入');
  const joinAttrs = room.canJoin ? ` data-join-room="${h(room.id)}" tabindex="0" role="button"` : '';
  const playerText = room.connectedCount === room.playerCount
    ? `${room.playerCount}/${room.maxPlayers}人`
    : `${room.connectedCount}/${room.maxPlayers}人在线`;
  return `
    <div class="room-list-item${room.canJoin ? ' joinable' : ''}"${joinAttrs}>
      <div class="room-list-main">
        <div class="room-list-title">${h(room.name || room.id)}</div>
        <div class="room-list-meta">
          <span>${h(room.id)}</span>
          <span>${h(room.cubeName)}</span>
          <span>${playerText}</span>
          <span>${room.packsPerPlayer}包 x ${room.cardsPerPack}张</span>
        </div>
      </div>
      <div class="room-list-tags">
        <span class="room-tag">${stateLabel}</span>
        <span class="room-tag">${lock}</span>
        ${testMode ? '<span class="room-tag">测试</span>' : ''}
      </div>
      <button type="button" class="btn-primary btn-sm"${disabled} data-join-room="${h(room.id)}">${buttonText}</button>
    </div>
  `;
}

function showError(msg) {
  const e = el('lobbyError');
  if (!e) return;
  e.textContent = msg; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 5000);
}

function redirectToRoom(roomId, name, password) {
  let url = '/room.html?roomId=' + encodeURIComponent(roomId) +
            '&name=' + encodeURIComponent(name);
  if (password) url += '&password=' + encodeURIComponent(password);
  window.location.href = url;
}

async function handleCreate() {
  const name = el('createName').value.trim();
  const roomName = el('createRoomName').value.trim();
  const cube = el('cubeSelect').value;
  const password = el('createPassword').value.trim() || null;
  if (!name) return showError('请输入昵称');
  if (!roomName) return showError('请输入房间名');
  if (!cube) return showError('请选择Cube');

  const maxPlayers = readInt('maxPlayers', 4);
  const packsPerPlayer = readInt('packsPerPlayer', 4);
  const cardsPerPack = readInt('cardsPerPack', 15);
  const capacityError = getCapacityError(cube, maxPlayers, packsPerPlayer, cardsPerPack);
  if (capacityError) {
    alert(capacityError);
    return showError(capacityError);
  }

  const data = await apiPost('/api/rooms', {
    playerName: name,
    roomName,
    cubeName: cube,
    maxPlayers,
    packsPerPlayer,
    cardsPerPack,
    password: password || undefined,
    testMode: el('testMode').checked,
  });
  if (data.code === 'CUBE_TOO_SMALL') alert(data.error);
  if (data.error) return showError(data.error);
  redirectToRoom(data.roomId, name, password);
}

function readInt(id, fallback) {
  const parsed = parseInt(el(id)?.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSelectedCubeCount(cubeName) {
  const selected = el('cubeSelect')?.selectedOptions?.[0];
  const fromOption = Number(selected?.dataset?.count);
  if (Number.isFinite(fromOption) && fromOption > 0) return fromOption;
  return cubeCounts.get(String(cubeName)) || 0;
}

function getCapacityError(cubeName, maxPlayers, packsPerPlayer, cardsPerPack) {
  if (maxPlayers > MAX_PLAYERS) return '玩家数最多 ' + MAX_PLAYERS + ' 人';
  if (packsPerPlayer > MAX_PACKS_PER_PLAYER) return '每人包数最多 ' + MAX_PACKS_PER_PLAYER + ' 包';
  const cubeCount = getSelectedCubeCount(cubeName);
  const needed = maxPlayers * packsPerPlayer * cardsPerPack;
  if (cubeCount > 0 && needed > cubeCount) {
    return 'Cube 牌数不足：当前 Cube 只有 ' + cubeCount + ' 张，当前设置需要 ' +
      needed + ' 张（' + maxPlayers + ' 人 x ' + packsPerPlayer + ' 包 x ' +
      cardsPerPack + ' 张）。请减少玩家数、每人包数或每包张数。';
  }
  return '';
}

async function handleJoin() {
  const name = el('joinName').value.trim();
  const code = el('roomCode').value.trim();
  return handleJoinRoom(code, name);
}

async function handleJoinRoom(code, nameOverride) {
  const joinNameInput = el('joinName');
  const createNameInput = el('createName');
  const roomCodeInput = el('roomCode');
  const name = (nameOverride || joinNameInput?.value || createNameInput?.value || '').trim();
  code = String(code || '').trim();
  if (roomCodeInput && code) roomCodeInput.value = code;
  if (joinNameInput && name && !joinNameInput.value.trim()) joinNameInput.value = name;
  if (!name) {
    joinNameInput?.focus();
    joinNameInput?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return showError('请先输入昵称，再加入房间');
  }
  if (!code) return showError('请输入房间号');

  // Check room info to see if password is required
  const data = await apiGet('/api/rooms/' + code);
  if (data.error) return showError(data.error);
  if (data.state !== 'idle') return showError(data.state === 'drafting' ? '轮抽已开始' : '房间已结束');
  if ((data.players || []).length >= data.maxPlayers) return showError('房间已满');

  if (data.hasPassword) {
    // Show password field
    show(el('joinPasswordRow'));
    // Store for the password button handler
    el('joinPasswordBtn')._roomId = code;
    el('joinPasswordBtn')._playerName = name;
    el('joinPassword')?.focus();
    el('joinPasswordRow')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    showError('该房间需要密码');
  } else {
    hide(el('joinPasswordRow'));
    redirectToRoom(code, name);
  }
}

function handleJoinWithPassword() {
  const btn = el('joinPasswordBtn');
  const roomId = btn._roomId;
  const name = btn._playerName;
  const password = el('joinPassword').value.trim();
  if (!password) return showError('请输入密码');

  // We pass the password via URL - the room page will use it for WS join
  redirectToRoom(roomId, name, password);
}

/* ======================== INIT ======================== */
function bindEvents() {
  el('createBtn')?.addEventListener('click', handleCreate);
  el('joinBtn')?.addEventListener('click', handleJoin);
  el('roomCode')?.addEventListener('keydown', (e) => { if (e.key==='Enter') handleJoin(); });
  el('joinPasswordBtn')?.addEventListener('click', handleJoinWithPassword);
  el('joinPassword')?.addEventListener('keydown', (e) => { if (e.key==='Enter') handleJoinWithPassword(); });
  el('refreshRoomsBtn')?.addEventListener('click', loadRooms);
  el('roomList')?.addEventListener('click', (e) => {
    const target = e.target.closest('[data-join-room]');
    if (!target || target.disabled) return;
    handleJoinRoom(target.dataset.joinRoom);
  });
  el('roomList')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-join-room]');
    if (!target || target.disabled) return;
    e.preventDefault();
    handleJoinRoom(target.dataset.joinRoom);
  });
}

function init() {
  bindEvents();
  loadCubes();
  loadRooms();
  setInterval(loadRooms, 5000);
  console.log('[Lobby] Ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

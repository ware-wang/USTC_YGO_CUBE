/**
 * USTC-OnlineCube - Lobby Page
 * Handles room creation and joining. Redirects to room.html on success.
 */

/* ======================== DOM UTILS ======================== */
const el = (id) => document.getElementById(id);

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
  sel.innerHTML = cubes.length
    ? cubes.map(c => '<option value="' + c.name + '">' + c.name + ' (' + c.count + '张)</option>').join('')
    : '<option value="">没有可用Cube</option>';
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

  const data = await apiPost('/api/rooms', {
    playerName: name,
    roomName,
    cubeName: cube,
    maxPlayers: parseInt(el('maxPlayers').value),
    packsPerPlayer: parseInt(el('packsPerPlayer').value),
    cardsPerPack: parseInt(el('cardsPerPack').value),
    password: password || undefined,
    testMode: el('testMode').checked,
  });
  if (data.error) return showError(data.error);
  redirectToRoom(data.roomId, name, password);
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

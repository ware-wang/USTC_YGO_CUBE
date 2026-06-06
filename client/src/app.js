/**
 * USTC-OnlineCube - Lobby Page
 * Handles room creation and joining. Redirects to room.html on success.
 */

/* ======================== DOM UTILS ======================== */
const el = (id) => document.getElementById(id);

function show(e) { e?.classList.remove('hidden'); }
function hide(e) { e?.classList.add('hidden'); }

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
  const cube = el('cubeSelect').value;
  const password = el('createPassword').value.trim() || null;
  if (!name) return showError('请输入昵称');
  if (!cube) return showError('请选择Cube');

  const data = await apiPost('/api/rooms', {
    playerName: name,
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
  if (!name) return showError('请输入昵称');
  if (!code) return showError('请输入房间号');

  // Check room info to see if password is required
  const data = await apiGet('/api/rooms/' + code);
  if (data.error) return showError(data.error);
  if (data.state === 'drafting') return showError('轮抽已开始');

  if (data.hasPassword) {
    // Show password field
    show(el('joinPasswordRow'));
    // Store for the password button handler
    el('joinPasswordBtn')._roomId = code;
    el('joinPasswordBtn')._playerName = name;
    showError('该房间需要密码');
  } else {
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
}

function init() {
  bindEvents();
  loadCubes();
  console.log('[Lobby] Ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

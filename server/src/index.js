import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cardDB } from './card-db/index.js';
import { cubeManager } from './cube/index.js';
import { RoomManager } from './room/index.js';
import { DuelManager } from './duel-manager/index.js';
import { duelBridge } from './duel-bridge/index.js';
import { createWSServer } from './ws/index.js';
import { registerPreloadedDecks } from './duel-bridge/ygopro-ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client', 'src');
const NEOS_DIR = path.join(__dirname, '..', '..', 'neos-client', 'dist');
const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKSPACE_ROOT = path.join(REPO_ROOT, '..');

// Paths for ocgcore resources
const CARDS_CDB_PATH = resolveExistingPath(
  process.env.CARDS_CDB_PATH,
  process.env.YGOPRO_CDB_PATH,
  path.join(__dirname, '..', 'data'),
);
const YGO_SCRIPT_PATH = resolveExistingPath(
  process.env.YGO_SCRIPT_PATH,
  process.env.YGOPRO_SCRIPT_PATH,
  path.join(REPO_ROOT, 'ygopro', 'script'),
  path.join(WORKSPACE_ROOT, 'ygopro', 'script'),
);

const PORT = process.env.PORT || 3131;

function resolveExistingPath(...candidates) {
  const usable = candidates.filter(Boolean).map((candidate) => path.resolve(candidate));
  return usable.find((candidate) => existsSync(candidate)) || usable[0] || null;
}

async function main() {
  if (YGO_SCRIPT_PATH) {
    console.log(`[Server] YGO script path: ${YGO_SCRIPT_PATH}`);
  } else {
    console.warn('[Server] YGO script path not found. Set YGO_SCRIPT_PATH or place scripts in ./ygopro/script');
  }
  console.log(`[Server] Card DB dir: ${CARDS_CDB_PATH}`);

  // Init card database
  await cardDB.init();

  // Init duel bridge (ocgcore WASM)
  try {
    const initSqlJs = (await import('sql.js')).default;
    duelBridge.init(await initSqlJs());
    console.log('[DuelBridge] Ready');
  } catch (e) {
    console.warn('[DuelBridge] Init failed (dueling unavailable):', e.message);
  }

  // Load cubes
  cubeManager.loadAll();

  const app = express();
  const httpServer = createServer(app);

  // ── Request logging for debugging neos-ts ──
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/neos/') || req.path.startsWith('/ygopro')) {
        console.log(`[HTTP] ${res.statusCode} ${req.method} ${req.path} ${Date.now()-start}ms`);
      }
    });
    next();
  });

  // ── CRITICAL: Skip Express processing for WebSocket upgrade requests ──
  // Without this, Express middleware (static/catch-all) may send HTTP responses
  // that corrupt the WebSocket connection after the upgrade completes.
  app.use((req, res, next) => {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      return; // Never respond to WS requests from Express
    }
    next();
  });

  // Room manager & Duel manager
  const roomManager = new RoomManager();
  const duelManager = new DuelManager();

  // WebSocket
  const wss = createWSServer(httpServer, roomManager, duelManager, duelBridge, {
    scriptPath: YGO_SCRIPT_PATH,
    cardsCdbPath: CARDS_CDB_PATH,
  });

  // REST API
  app.use(express.json({ limit: '2mb' }));

  // List cubes
  app.get('/api/cubes', (_req, res) => {
    res.json({ cubes: cubeManager.listCubes() });
  });

  // Get single card
  app.get('/api/cards/:id', (req, res) => {
    const card = cardDB.getById(parseInt(req.params.id));
    card ? res.json(card) : res.status(404).json({ error: 'Card not found' });
  });

  // Batch card lookup
  app.post('/api/cards/batch', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
    const results = {};
    for (const id of ids) if (!results[id]) results[id] = cardDB.getById(id) || null;
    res.json({ results });
  });

  // Get cube details
  app.get('/api/cubes/:name', (req, res) => {
    const cube = cubeManager.getCube(req.params.name);
    if (!cube) return res.status(404).json({ error: 'Cube not found' });
    res.json({
      name: cube.name,
      count: cube.count,
      cardIds: cube.cardIds,
      cards: cube.cardDetails,
    });
  });

  // Create room
  app.post('/api/rooms', (req, res) => {
    const { playerName, cubeName, maxPlayers, packsPerPlayer, cardsPerPack, password, testMode } = req.body;
    if (!playerName || !cubeName) {
      return res.status(400).json({ error: 'playerName and cubeName required' });
    }
    const cube = cubeManager.getCube(cubeName);
    if (!cube) return res.status(404).json({ error: 'Cube not found' });

    const maxP = Math.min(maxPlayers || 8, 16);
    const ppp = Math.max(packsPerPlayer || 3, 1);
    const cpp = Math.max(cardsPerPack || 15, 5);

    const room = roomManager.createRoom(cubeName, cube.cardIds, maxP, ppp, cpp, password || null, testMode === true);
    res.json({ roomId: room.id, playerName, hasPassword: !!password });
  });

  // Get room info
  app.get('/api/rooms/:id', (req, res) => {
    const room = roomManager.getRoomPublic(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  });

  // Create battle tables (called after draft completes)
  app.post('/api/tables', (req, res) => {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    const room = roomManager.getRoom(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const tables = duelManager.createBattleTables(room);
    res.json({ tables: tables.map(t => ({
      id: t.id,
      roomId: t.roomId,
      state: t.state,
      seats: t.seats,
    }))});
  });

  // Get tables for a room
  app.get('/api/tables/:roomId', (req, res) => {
    const tables = duelManager.getRoomTables(req.params.roomId);
    res.json({ tables });
  });

  // Server stats
  app.get('/api/stats', (_req, res) => {
    res.json({
      rooms: roomManager.getStats ? roomManager.getStats() : {},
      duels: duelBridge.getStats(),
      uptime: process.uptime(),
    });
  });

  // ── Duel (ocgcore) endpoints ─────────────────

  /**
   * Create a duel session from deck YDKs.
   * POST /api/duels
   * Body: { roomId, players: [{name, ydk}], hostinfo }
   */
  app.post('/api/duels', async (req, res) => {
    try {
      const { roomId, players, hostinfo } = req.body;
      if (!roomId || !players || players.length < 2) {
        return res.status(400).json({ error: 'roomId and 2 players required' });
      }

      const { YGOProDeck } = await import('ygopro-deck-encode');
      const decks = players.map(p => {
        let deck = { main: [], extra: [] };
        try {
          if (p.ydk) {
            deck = parseYdk(p.ydk);
          }
        } catch (e) {
          console.warn('[Duel] YDK parse failed:', e.message);
        }
        return deck;
      });

      const session = await duelBridge.createSession({
        decks,
        hostinfo: hostinfo || {},
        options: {
          scriptPath: YGO_SCRIPT_PATH,
          cardsCdbPath: CARDS_CDB_PATH,
        },
      });

      res.json({
        sessionId: session.sessionId,
        players: players.map((p, i) => ({ ...p, position: i })),
      });
    } catch (e) {
      console.error('[Duel] Create failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── YGOPro database files (served locally for neos-ts) ──
  const YGOPRO_DB_DIR = path.join(__dirname, '..', '..', 'neos-client', 'public', 'ygopro-database');
  app.use('/ygopro-database', express.static(YGOPRO_DB_DIR, {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }));
  app.get('/ygopro-database/pics/:id.jpg', (req, res) => {
    res.redirect(302, `https://images.ygoprodeck.com/images/cards/${req.params.id}.jpg`);
  });

  // ── neos-ts (YGOPro web duel client) ──────────
  // neos-ts production build uses assetsPath="/neos-assets" internally
  // for WASM and other dynamic assets — serve same dir at both mount points
  const neosStatic = express.static(NEOS_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
    },
  });
  const neosSpaFallback = (req, res) => {
    if (/\.(js|css|wasm|ico|png|jpg|jpeg|svg|woff2?|ttf|json|data)$/i.test(req.path)) {
      return res.status(404).end();
    }
    res.sendFile(path.join(NEOS_DIR, 'index.html'));
  };

  app.use('/neos', neosStatic);
  app.get('/neos/*', neosSpaFallback);

  // neos-ts prod config uses /neos-assets/ for dynamic assets (WASM, etc.)
  app.use('/neos-assets', neosStatic);
  app.get('/neos-assets/*', neosSpaFallback);

  /**
   * Launch a duel via neos-ts / ygopro protocol.
   * POST /api/launch-duel
   * Body: { roomId, players: [{name, ydk}] }
   * Returns: { passWd, neosUrl }
   */
  app.post('/api/launch-duel', async (req, res) => {
    try {
      const { roomId, players } = req.body;
      if (!roomId || !players || players.length < 2) {
        return res.status(400).json({ error: 'roomId and 2 players required' });
      }

      const decks = players.map(p => parseYdk(p.ydk || ''));

      // Generate room password from roomId
      const passWd = roomId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'cube';
      
      // Register preloaded decks with the ygopro WS handler
      registerPreloadedDecks(passWd, decks);

      const neosUrl = `/neos/duelroom`;

      res.json({
        passWd,
        neosUrl,
        manualNeosUrl: '/neos/match',
        players: players.map((p, i) => ({
          name: p.name,
          position: i,
          duelUrl: `${neosUrl}?passwd=${encodeURIComponent(passWd)}&player=${encodeURIComponent(p.name || `Player${i + 1}`)}`,
        })),
        instructions: `Open each player's duelUrl to auto-join the room. If auto-connect fails, open /neos/match and connect manually with password: ${passWd}`,
      });
    } catch (e) {
      console.error('[LaunchDuel] Error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Serve frontend (SPA fallback — skip WS paths)
  app.use(express.static(CLIENT_DIR));
  app.get('*', (req, res, next) => {
    // Don't intercept WebSocket upgrade paths
    if (req.path === '/ws' || req.path === '/ws-duel') return next();
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  httpServer.listen(PORT, () => {
    console.log(`[Server] Cube Draft running on http://localhost:${PORT}`);
    console.log(`[Server] neos-ts duel client at http://localhost:${PORT}/neos/`);
  });

  // Start ygopro WebSocket proxy (port 7911 → /ws-duel)
  const PROXY_PORT = process.env.YGOPRO_PROXY_PORT || 7911;
  try {
    const { startYgoproProxy } = await import('./duel-bridge/ygopro-proxy.js');
    const proxyResult = startYgoproProxy(httpServer);
    if (proxyResult) {
      console.log(`[Server] YGOPro WS proxy on ws://localhost:${PROXY_PORT}`);
    } else {
      console.log(`[Server] YGOPro proxy port ${PROXY_PORT} in use — will use direct connection`);
    }
  } catch (e) {
    console.warn('[Server] YGOPro proxy not started:', e.message);
  }
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ── YDK parser ────────────────────────────────

/**
 * Parse YDK format into { main, extra }.
 * Example:
 *   #main
 *   89631139
 *   #extra
 *   23995346
 *   !side
 *   00000000
 */
function parseYdk(ydkText) {
  const main = [];
  const extra = [];
  let section = 'main';

  for (const line of ydkText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#main')) { section = 'main'; continue; }
    if (trimmed.startsWith('#extra')) { section = 'extra'; continue; }
    if (trimmed.startsWith('!side')) { section = 'side'; continue; }
    if (trimmed === 'created by' || trimmed === '#created by') { section = 'side'; continue; }

    const id = parseInt(trimmed, 10);
    if (isNaN(id) || id <= 0) continue;

    if (section === 'main') main.push(id);
    else if (section === 'extra') extra.push(id);
    // side cards ignored
  }

  return { main, extra };
}

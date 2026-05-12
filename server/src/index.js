import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { cardDB } from './card-db/index.js';
import { cubeManager } from './cube/index.js';
import { RoomManager } from './room/index.js';
import { createWSServer } from './ws/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client', 'src');

const PORT = process.env.PORT || 3131;

async function main() {
  // Init card database
  await cardDB.init();

  // Load cubes
  cubeManager.loadAll();

  const app = express();
  const httpServer = createServer(app);

  // Room manager
  const roomManager = new RoomManager();

  // WebSocket
  const wss = createWSServer(httpServer, roomManager);

  // REST API
  app.use(express.json());

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
    const { playerName, cubeName, maxPlayers, packsPerPlayer, cardsPerPack, password } = req.body;
    if (!playerName || !cubeName) {
      return res.status(400).json({ error: 'playerName and cubeName required' });
    }
    const cube = cubeManager.getCube(cubeName);
    if (!cube) return res.status(404).json({ error: 'Cube not found' });

    const maxP = Math.min(maxPlayers || 8, 16);
    const ppp = Math.max(packsPerPlayer || 3, 1);
    const cpp = Math.max(cardsPerPack || 15, 5);

    const room = roomManager.createRoom(cubeName, cube.cardIds, maxP, ppp, cpp, password || null);
    res.json({ roomId: room.id, playerName, hasPassword: !!password });
  });

  // Get room info
  app.get('/api/rooms/:id', (req, res) => {
    const room = roomManager.getRoomPublic(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  });

  // Serve frontend
  app.use(express.static(CLIENT_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  httpServer.listen(PORT, () => {
    console.log(`[Server] Cube Draft running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
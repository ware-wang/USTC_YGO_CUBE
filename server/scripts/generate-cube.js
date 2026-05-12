import { cardDB } from '../src/card-db/index.js';
import fs from 'fs';
import path from 'path';

await cardDB.init();

// Build a balanced 200-card cube: mix of monster, spell, trap cards from the full OCG pool
const TYPES = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
};

function getRandomCards(typeMask, count, fromPool) {
  // sql.js doesn't support ORDER BY RANDOM(), so fetch a large pool and shuffle
  const stmt = cardDB.db.prepare(
    `SELECT DISTINCT d.id FROM datas d 
     WHERE (d.type & ?) > 0 AND d.ot & 1 != 0
     LIMIT ?`
  );
  stmt.bind([typeMask, fromPool]);
  const ids = [];
  while (stmt.step()) ids.push(stmt.getAsObject().id);
  stmt.free();
  // Shuffle and pick
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

// Log some stats
const row = cardDB.db.exec(
  "SELECT COUNT(DISTINCT id) as total FROM datas WHERE (ot & 1) != 0"
);
const total = row[0] ? row[0].values[0][0] : 0;
console.log(`Total OCG cards in DB: ${total}`);

// Pick: ~120 monsters, ~50 spells, ~30 traps = 200 total
const monsters = getRandomCards(TYPES.MONSTER, 120, 3000);
const spells = getRandomCards(TYPES.SPELL, 50, 1500);
const traps = getRandomCards(TYPES.TRAP, 30, 1000);

const allIds = [...monsters, ...spells, ...traps];
// Shuffle final pool
for (let i = allIds.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [allIds[i], allIds[j]] = [allIds[j], allIds[i]];
}

const cube = allIds.slice(0, 200);

// Write as YDK
let ydk = '# Created by cube-draft\n#main\n';
for (const id of cube) ydk += id + '\n';
ydk += '#extra\n!side\n';

const dir = path.join(import.meta.dirname, '..', 'data', 'cubes');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'sample.ydk'), ydk);
console.log(`Created sample cube with ${cube.length} cards (${monsters.length}m ${spells.length}s ${traps.length}t)`);
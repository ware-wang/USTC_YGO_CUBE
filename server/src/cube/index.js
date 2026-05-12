import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cardDB } from '../card-db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUBE_DIR = path.join(__dirname, '..', '..', 'data', 'cubes');

class Cube {
  constructor(name, cardIds) {
    this.name = name;
    this.cardIds = cardIds;
    this.cardDetails = null;
    this.count = cardIds.length;
  }

  getCardDetails() {
    if (this.cardDetails) return this.cardDetails;
    const { results } = cardDB.getByIds(this.cardIds);
    this.cardDetails = results;
    return results;
  }
}

class CubeManager {
  constructor() {
    this.cubes = new Map();
  }

  /** Load all .ydk files from the cube directory */
  loadAll() {
    if (!fs.existsSync(CUBE_DIR)) {
      console.warn(`[Cube] Cube directory not found: ${CUBE_DIR}`);
      return;
    }

    const files = fs.readdirSync(CUBE_DIR).filter(f => f.endsWith('.ydk'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(CUBE_DIR, file), 'utf-8');
        const cube = parseYdk(content, file.replace('.ydk', ''));
        if (cube) {
          this.cubes.set(cube.name, cube);
          console.log(`[Cube] Loaded "${cube.name}" (${cube.count} cards)`);
        }
      } catch (err) {
        console.error(`[Cube] Failed to load ${file}:`, err.message);
      }
    }
  }

  /** List all loaded cubes */
  listCubes() {
    return Array.from(this.cubes.values()).map(c => ({
      name: c.name,
      count: c.count,
    }));
  }

  /** Get a cube by name */
  getCube(name) {
    return this.cubes.get(name) || null;
 伸}
}

/** Parse .ydk file content into a Cube */
function parseYdk(content, filename) {
  const mainStart = content.indexOf('#main');
  const extraStart = content.indexOf('#extra');
  const sideStart = content.indexOf('!side');
  if (mainStart === -1) return null;

  // Only parse main deck cards (between #main and #extra)
  const sectionEnd = extraStart !== -1 ? extraStart : (sideStart !== -1 ? sideStart : undefined);
  const mainSection = content.slice(mainStart + 6, sectionEnd);
  const lines = mainSection.split('\n');
  const ids = [];

  for (const line of lines) {
    const id = parseInt(line.trim());
    if (id > 0) ids.push(id);
  }

  if (ids.length === 0) return null;
  return new Cube(filename, ids);
}

export const cubeManager = new CubeManager();
export default cubeManager;
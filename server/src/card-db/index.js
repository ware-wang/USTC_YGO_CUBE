import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'cards.cdb');

class CardDB {
  constructor() {
    this.db = null;
    this.ready = false;
  }

  async init() {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    this.db = new SQL.Database(buffer);
    this.ready = true;
    console.log(`[CardDB] Loaded ${DB_PATH} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }

  /** Get a card by its id (full data) */
  getCardFull(id) { return this.getById(id); }

  /** Get a card by its id */
  getById(id) {
    const stmt = this.db.prepare('SELECT * FROM datas WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this._enrich(row);
    }
    stmt.free();
    return null;
  }

  /** Search cards by name (fuzzy) */
  search(query, limit = 20) {
    const stmt = this.db.prepare(
      'SELECT d.*, t.name as name FROM datas d JOIN texts t ON d.id = t.id WHERE t.name LIKE ? LIMIT ?'
    );
    stmt.bind([`%${query}%`, limit]);
    const results = [];
    while (stmt.step()) {
      results.push(this._enrich(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /** Get all cards of a given type (monster=0x1, spell=0x2, trap=0x4, etc) */
  getByTypeMask(mask, limit = 1000) {
    const stmt = this.db.prepare(`SELECT * FROM datas WHERE (type & ?) > 0 LIMIT ?`);
    stmt.bind([mask, limit]);
    const results = [];
    while (stmt.step()) results.push(this._enrich(stmt.getAsObject()));
    stmt.free();
    return results;
  }

  /** Get cards that belong to a given setcode (archetype) */
  getBySetcode(setcode, limit = 500) {
    const stmt = this.db.prepare(`SELECT * FROM datas WHERE setcode & ? LIMIT ?`);
    stmt.bind([setcode, limit]);
    const results = [];
    while (stmt.step()) results.push(this._enrich(stmt.getAsObject()));
    stmt.free();
    return results;
  }

  /** Get many cards at once */
  getByIds(ids) {
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT * FROM datas WHERE id IN (${placeholders})`);
    stmt.bind(ids);
    const results = [];
    const map = {};
    while (stmt.step()) {
      const row = this._enrich(stmt.getAsObject());
      results.push(row);
      map[row.id] = row;
    }
    stmt.free();
    return { results, map };
  }

  /** Enrich a card row with text and computed fields */
  _enrich(row) {
    const stmt = this.db.prepare('SELECT * FROM texts WHERE id = ?');
    stmt.bind([row.id]);
    const texts = {};
    if (stmt.step()) Object.assign(texts, stmt.getAsObject());
    stmt.free();

    return {
      id: row.id,
      ot: row.ot,
      alias: row.alias,
      setcode: row.setcode,
      type: row.type,
      atk: row.atk,
      def: row.def,
      level: row.level & 0xff,
      race: row.race,
      attribute: row.attribute,
      category: row.category,
      // Text
      name: texts.name || '',
      desc: texts.desc || '',
    };
  }

  /** Get card count */
  count() {
    const r = this.db.exec('SELECT COUNT(*) as c FROM datas');
    return r[0]?.values[0]?.[0] || 0;
  }
}

export const cardDB = new CardDB();
export default cardDB;
import assert from 'assert';
import { DuelManager } from './src/duel-manager/index.js';

const dm = new DuelManager();

const roomA = {
  id: 'roomA',
  players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
  testMode: false,
};
const roomB = {
  id: 'roomB',
  players: [{ id: 'p1' }, { id: 'q2' }],
  testMode: false,
};

const [a1, a2] = dm.createBattleTables(roomA);
const [b1] = dm.createBattleTables(roomB);

assert.equal(dm.tableBelongsToRoom(a1.id, roomA.id), true);
assert.equal(dm.tableBelongsToRoom(a1.id, roomB.id), false);

assert.equal(dm.joinTable(a1.id, 'p1', 0).success, true);
assert.equal(dm.joinTable(a2.id, 'p1', 1).success, true);
assert.deepEqual(dm.getTableSeatIds(a1.id), [null, null]);
assert.deepEqual(dm.getTableSeatIds(a2.id), [null, 'p1']);

assert.equal(dm.joinTable(b1.id, 'p1', 0).success, true);
assert.deepEqual(dm.getTableSeatIds(a2.id), [null, 'p1']);
assert.deepEqual(dm.getTableSeatIds(b1.id), ['p1', null]);

dm.markTableDueling(a2.id);
assert.equal(dm.getRoomTables(roomA.id).find(t => t.id === a2.id)?.state, 'dueling');

console.log('[test-battle-tables] ok');

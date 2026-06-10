import assert from 'node:assert/strict';
import { cardDB } from './src/card-db/index.js';
import { FlipDraftEngine } from './src/draft/flip.js';

await cardDB.init();

const cube = [
  89631139, 46986414, 22091647, 55144522,
  89631139, 46986414, 22091647, 55144522,
  89631139, 46986414, 22091647, 55144522,
  89631139, 46986414, 22091647, 55144522,
  89631139, 46986414, 22091647, 55144522,
];

const draft = new FlipDraftEngine(cube);
draft.init([
  { id: 'bob', name: 'Bob', seatIndex: 1 },
  { id: 'alice', name: 'Alice', seatIndex: 0 },
], {
  rowSize: 2,
  targetCards: 2,
  turnFunds: 4,
});

assert.equal(draft.state, 'drafting');
assert.equal(draft.getActivePlayer().id, 'alice');
assert.equal(draft.getPublicState('alice').market.rows.length, 3);

const initialDrawRemaining = draft.drawPile.length;
const initialTrashCount = draft.trash.length;
let first = pickAffordable(draft.getPublicState('alice'), 4);
let result = draft.buyCard('alice', first.marketSlot, first.id);
assert.equal(result.success, true);
assert.equal(draft.getActivePlayer().id, 'alice');
assert.equal(draft.playerPools.get('alice').length, 1);
assert.equal(result.marketRefreshed, false);
assert.equal(draft.drawPile.length, initialDrawRemaining);
assert.equal(draft.trash.length, initialTrashCount);
assert.equal(draft.market[first.marketSlot], null);
const afterFirstState = draft.getPublicState('alice');
assert.equal(afterFirstState.market.rows[first.row].slots[first.col], null);
assert.equal(afterFirstState.market.rows[first.row].cards.length, draft.rowSize - 1);

let second = pickAffordable(draft.getPublicState('alice'), draft.remainingFunds);
result = draft.buyCard('alice', second.marketSlot, second.id);
assert.equal(result.success, true);
assert.equal(result.marketRefreshed, true);
assert.equal(draft.playerPools.get('alice').length, 2);
assert.equal(draft.getActivePlayer().id, 'bob');
assert.ok(draft.trash.length >= 1);

first = pickAffordable(draft.getPublicState('bob'), 4);
result = draft.buyCard('bob', first.marketSlot, first.id);
assert.equal(result.success, true);
second = pickAffordable(draft.getPublicState('bob'), draft.remainingFunds);
result = draft.buyCard('bob', second.marketSlot, second.id);
assert.equal(result.success, true);
assert.equal(result.draftComplete, true);
assert.equal(draft.state, 'complete');
assert.equal(draft.playerPools.get('bob').length, 2);

console.log('[test-flip-draft] ok');

function pickAffordable(state, funds) {
  const cards = state.market.rows.flatMap(row => row.cards || []);
  const card = cards.find(candidate => candidate.cost <= funds);
  assert.ok(card, 'expected an affordable card');
  return card;
}

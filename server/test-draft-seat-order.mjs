import assert from 'node:assert/strict';
import { DraftEngine, DRAFT_STATES } from './src/draft/index.js';

const players = [
  { id: 'A', name: 'Alice', seatIndex: 2 },
  { id: 'B', name: 'Bob', seatIndex: 0 },
  { id: 'C', name: 'Carol', seatIndex: 1 },
  { id: 'D', name: 'Dave', seatIndex: 3 },
];

const draft = new DraftEngine(Array.from({ length: 16 }, (_, i) => i + 1));
draft._shuffle = arr => arr;
draft.init(players, 2, { cardsPerPack: 2 });

assert.deepEqual(
  draft.players.map(p => p.id),
  ['B', 'C', 'A', 'D'],
  'draft order should follow ascending seatIndex, not join/input order',
);
assert.deepEqual(players.map(p => p.id), ['A', 'B', 'C', 'D'], 'init should not mutate room player order');

assert.deepEqual(activePacks(), {
  B: [1, 2],
  C: [5, 6],
  A: [9, 10],
  D: [13, 14],
});
confirmSeatRound({ expectAllConfirmed: true });
assert.deepEqual(activePacks(), {
  B: [14],
  C: [2],
  A: [6],
  D: [10],
}, 'direction=1 should pass remaining cards to the next occupied seat');

confirmSeatRound({ expectPackIndex: 1, expectDirection: -1 });
assert.deepEqual(activePacks(), {
  B: [3, 4],
  C: [7, 8],
  A: [11, 12],
  D: [15, 16],
});

confirmSeatRound({ expectAllConfirmed: true });
assert.deepEqual(activePacks(), {
  B: [8],
  C: [12],
  A: [16],
  D: [4],
}, 'direction=-1 should pass remaining cards to the previous occupied seat');

const result = confirmSeatRound({ expectComplete: true });
assert.equal(result.draftComplete, true);
assert.equal(draft.state, DRAFT_STATES.COMPLETE);
assert.deepEqual(Object.fromEntries([...draft.playerPools.entries()]), {
  B: [1, 14, 3, 8],
  C: [5, 2, 7, 12],
  A: [9, 6, 11, 16],
  D: [13, 10, 15, 4],
});

console.log('[test-draft-seat-order] ok');

function confirmSeatRound(expectations = {}) {
  let result = null;
  for (const player of draft.players) {
    result = draft.confirmPick(player.id, 0);
    assert.equal(result.success, true);
  }

  if (expectations.expectAllConfirmed) {
    assert.equal(result.allConfirmed, true);
  }
  if (expectations.expectPackIndex !== undefined) {
    assert.equal(result.packIndex, expectations.expectPackIndex);
  }
  if (expectations.expectDirection !== undefined) {
    assert.equal(result.direction, expectations.expectDirection);
  }
  if (expectations.expectComplete) {
    assert.equal(result.draftComplete, true);
  }
  return result;
}

function activePacks() {
  const packs = {};
  for (const player of draft.players) {
    packs[player.id] = [...draft.playerPacks.get(player.id)[draft.packIndex]];
  }
  return packs;
}

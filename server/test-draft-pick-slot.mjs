import assert from 'node:assert/strict';
import { cardDB } from './src/card-db/index.js';
import { DraftEngine } from './src/draft/index.js';

await cardDB.init();

const missingCardId = 15375108;
const gearfriedId = 22091647;
const blueEyesId = 89631139;
const darkMagicianId = 46986414;

const draft = new DraftEngine([
  missingCardId,
  gearfriedId,
  blueEyesId,
  darkMagicianId,
]);
draft._shuffle = arr => arr;
draft.init([
  { id: 'p1', name: 'P1', seatIndex: 0 },
  { id: 'p2', name: 'P2', seatIndex: 1 },
], 1, { cardsPerPack: 2 });

const visiblePack = draft.getCurrentPack('p1').cards;
assert.deepEqual(
  visiblePack.map(card => ({ id: card.id, packSlot: card.packSlot })),
  [{ id: gearfriedId, packSlot: 1 }],
  'visible cards should retain their original raw pack slot',
);

const staleIndexResult = draft.confirmPick('p1', 0, gearfriedId);
assert.equal(staleIndexResult.success, false);
assert.match(staleIndexResult.error, /卡包已更新|客户端缓存/);
assert.deepEqual(draft.playerPools.get('p1'), []);

const result = draft.confirmPick('p1', visiblePack[0].packSlot, visiblePack[0].id);
assert.equal(result.success, true);
assert.equal(result.pickedCardId, gearfriedId);
assert.deepEqual(draft.playerPools.get('p1'), [gearfriedId]);
assert.deepEqual(draft.playerPacks.get('p1')[0], [missingCardId]);

console.log('[test-draft-pick-slot] ok');

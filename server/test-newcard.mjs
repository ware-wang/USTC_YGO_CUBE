/**
 * Minimal test to isolate the newCard() Aborted issue.
 * Run: node --experimental-vm-modules test-newcard.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const YGO_SCRIPT_PATH = path.join(__dirname, '..', '..', 'ygopro', 'script');
const CARDS_CDB_PATH = path.join(__dirname, 'data');

async function main() {
  console.log('Node version:', process.version);
  console.log('Script path:', YGO_SCRIPT_PATH);
  console.log('Cards path:', CARDS_CDB_PATH);

  // Step 1: Load koishipro-core.js (CJS)
  console.log('\n[1] Loading koishipro-core.js (CJS)...');
  const {
    createOcgcoreWrapper,
    DirScriptReaderEx,
    DirCardReader,
    _OcgcoreConstants,
  } = require('koishipro-core.js');
  console.log('  ✓ Loaded');

  const { OcgcoreScriptConstants } = _OcgcoreConstants;

  // Step 2: Load sql.js
  console.log('\n[2] Loading sql.js...');
  const initSqlJs = (await import('sql.js')).default;
  console.log('  ✓ Loaded');

  // Step 3: Create WASM wrapper
  console.log('\n[3] Creating ocgcore wrapper...');
  let wrapper;
  try {
    wrapper = await createOcgcoreWrapper();
    console.log('  ✓ Wrapper created');
  } catch (e) {
    console.error('  ✗ Wrapper creation failed:', e.message);
    process.exit(1);
  }

  // Step 4: Load scripts
  console.log('\n[4] Loading scripts from:', YGO_SCRIPT_PATH);
  try {
    const scriptReader = await DirScriptReaderEx(YGO_SCRIPT_PATH);
    wrapper.setScriptReader(scriptReader);
    console.log('  ✓ Script reader set');
  } catch (e) {
    console.error('  ✗ Script reader failed:', e.message);
    console.log('  Continuing without scripts...');
  }

  // Step 5: Load card database
  console.log('\n[5] Loading card database from:', CARDS_CDB_PATH);
  try {
    const sqljs = initSqlJs;
    const cardReader = await DirCardReader(sqljs, CARDS_CDB_PATH);
    console.log('  Card reader type:', typeof cardReader, 'keys:', Object.keys(cardReader));
    wrapper.setCardReader(cardReader);
    console.log('  ✓ Card reader set');
  } catch (e) {
    console.error('  ✗ Card reader failed:', e.message, e.stack);
    process.exit(1);
  }

  // Step 6: Create duel
  console.log('\n[6] Creating duel...');
  let duel;
  try {
    duel = wrapper.createDuelV2(Date.now());
    console.log('  ✓ Duel created');
  } catch (e) {
    console.error('  ✗ Duel creation failed:', e.message);
    process.exit(1);
  }

  // Step 7: Set player info
  console.log('\n[7] Setting player info...');
  duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 5, drawCount: 1 });
  duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 5, drawCount: 1 });
  console.log('  ✓ Player info set');

  // Step 8: Try newCard with Blue-Eyes (89631139)
  console.log('\n[8] Testing newCard(89631139) - Blue-Eyes White Dragon...');
  try {
    duel.newCard({
      code: 89631139,
      owner: 0,
      player: 0,
      location: OcgcoreScriptConstants.LOCATION_DECK,
      sequence: 0,
      position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
    });
    console.log('  ✓ newCard succeeded!');
  } catch (e) {
    console.error('  ✗ newCard failed:', e.message);
    console.error('  Stack:', e.stack?.slice(0, 500));
  }

  // Step 9: Try starting the duel
  console.log('\n[9] Starting duel...');
  try {
    duel.startDuel(0x20); // DUEL_SINGLE
    console.log('  ✓ Duel started');
    
    // Try processing
    const result = duel.process({ noParse: true });
    console.log('  Process result - status:', result.status, 'raw length:', result.raw?.length);
    console.log('  ✓ Duel works!');
  } catch (e) {
    console.error('  ✗ startDuel/process failed:', e.message);
  }

  // Cleanup
  try { duel.endDuel(); } catch(e) {}
  try { wrapper.finalize(); } catch(e) {}
  console.log('\n✅ Test complete');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
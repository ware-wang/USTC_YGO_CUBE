/**
 * Reproduce the crash: test with wrong scriptPath (data dir instead of ygopro/script)
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WRONG_SCRIPT_PATH = path.join(__dirname, 'data'); // WRONG - no lua scripts here
const CORRECT_SCRIPT_PATH = path.join(__dirname, '..', '..', 'ygopro', 'script');
const CARDS_CDB_PATH = path.join(__dirname, 'data');

async function testPath(scriptPath, label) {
  console.log(`\n=== Testing: ${label} ===`);
  console.log(`  Script path: ${scriptPath}`);
  
  const { createOcgcoreWrapper, DirScriptReaderEx, DirCardReader, _OcgcoreConstants } = require('koishipro-core.js');
  const { OcgcoreScriptConstants } = _OcgcoreConstants;
  const initSqlJs = (await import('sql.js')).default;

  try {
    const wrapper = await createOcgcoreWrapper();
    const scriptReader = await DirScriptReaderEx(scriptPath);
    wrapper.setScriptReader(scriptReader);
    const cardReader = await DirCardReader(initSqlJs, CARDS_CDB_PATH);
    wrapper.setCardReader(cardReader);

    const duel = wrapper.createDuelV2(Date.now());
    duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 5, drawCount: 1 });
    duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 5, drawCount: 1 });

    duel.newCard({
      code: 89631139, owner: 0, player: 0,
      location: OcgcoreScriptConstants.LOCATION_DECK,
      sequence: 0,
      position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
    });
    console.log('  ✅ newCard succeeded');

    duel.startDuel(0x20);
    console.log('  ✅ startDuel succeeded');
    
    try { duel.endDuel(); } catch(e) {}
    try { wrapper.finalize(); } catch(e) {}
    return true;
  } catch (e) {
    console.log(`  ❌ FAILED: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`Node: ${process.version}`);
  await testPath(CORRECT_SCRIPT_PATH, 'CORRECT path (ygopro/script)');
  await testPath(WRONG_SCRIPT_PATH, 'WRONG path (server/data - no lua)');
}

main();
/**
 * Worker Thread: runs ocgcore WASM for a single duel.
 *
 * Message protocol (parent → worker):
 *   { type: 'init', decks, hostinfo, scriptPaths, seed, cardReader }
 *   { type: 'setResponse', response: number | Buffer }
 *   { type: 'queryFieldCount', player, location }
 *   { type: 'queryFieldInfo' }
 *
 * Message protocol (worker → parent):
 *   { type: 'ready' }
 *   { type: 'gameMsg', msgType, payload: Buffer, status }
 *   { type: 'fieldCount', player, location, count }
 *   { type: 'fieldInfo', data }
 *   { type: 'error', message }
 *   { type: 'done' }
 */

import { parentPort, workerData } from 'node:worker_threads';
import { createOcgcoreWrapper, DirScriptReaderEx, _OcgcoreConstants } from 'koishipro-core.js';
import { YGOProMessages } from 'ygopro-msg-encode';

const { OcgcoreScriptConstants } = _OcgcoreConstants;

let ocgcore = null;
let duel = null;
let messageHandler = null;

parentPort.on('message', async (msg) => {
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg);
        break;
      case 'setResponse':
        await handleSetResponse(msg);
        break;
      case 'setResponseInt':
        duel.setResponseInt(msg.response);
        send({ type: 'responseSet' });
        break;
      case 'queryFieldCount':
        await handleQueryFieldCount(msg);
        break;
      case 'queryFieldInfo':
        await handleQueryFieldInfo(msg);
        break;
      default:
        console.warn('[ocgcore-worker] Unknown message type:', msg.type);
    }
  } catch (e) {
    send({ type: 'error', message: e.message, stack: e.stack });
  }
});

// ── Init ──────────────────────────────────────

async function handleInit({ decks, hostinfo, scriptPaths, cardsCdbPath, seed }) {
  // Create ocgcore wrapper
  ocgcore = await createOcgcoreWrapper();
  
  // Override message handler to forward to parent
  ocgcore.setMessageHandler(async (_, message, type) => {
    // Send debug messages directly as gameMsg
  });
  
  // Load script reader from ygopro script directory
  const scriptReader = await DirScriptReaderEx(...scriptPaths);
  ocgcore.setScriptReader(scriptReader);
  
  // Load card reader from cards.cdb
  const { createCardReader } = await import('./card-reader.js');
  const cardReader = await createCardReader(cardsCdbPath);
  ocgcore.setCardReader(cardReader);
  
  // Set message handler AFTER readers are set
  ocgcore.setMessageHandler(async (_, message, type) => {
    // We handle messages in the process loop, not here
  });
  
  // Create duel
  duel = ocgcore.createDuelV2(seed || 0);
  
  // Set player info
  for (let i = 0; i < 2; i++) {
    duel.setPlayerInfo({
      player: i,
      lp: hostinfo.start_lp || 8000,
      startHand: hostinfo.start_hand || 5,
      drawCount: hostinfo.draw_count || 1,
    });
  }
  
  // Load decks
  for (let player = 0; player < 2; player++) {
    const deck = decks[player];
    if (!deck) continue;
    
    // Main deck
    const main = [...deck.main].reverse();
    for (const code of main) {
      duel.newCard({
        code,
        owner: player,
        player,
        location: OcgcoreScriptConstants.LOCATION_DECK,
        sequence: 0,
        position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
      });
    }
    
    // Extra deck
    const extra = [...deck.extra].reverse();
    for (const code of extra) {
      duel.newCard({
        code,
        owner: player,
        player,
        location: OcgcoreScriptConstants.LOCATION_EXTRA,
        sequence: 0,
        position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
      });
    }
  }
  
  // Calculate duel options
  const opt = calculateDuelOptions(hostinfo);
  
  // Start duel
  duel.startDuel(opt);
  
  send({ type: 'ready' });
}

// ── Duel Options ──────────────────────────────

function calculateDuelOptions(hostinfo) {
  let opt = 0;
  if (hostinfo.duel_rule >= 5) {
    opt |= (hostinfo.duel_rule - 4) << 6; // Master Rule 2020+
  }
  if (hostinfo.mode === 0) opt |= 0x20;  // single
  if (hostinfo.mode === 1) opt |= 0x40;  // match
  if (hostinfo.mode === 2) opt |= 0x80;  // tag
  return opt;
}

// ── Process & Advance ─────────────────────────

async function handleSetResponse({ response }) {
  if (!duel) return;
  
  if (typeof response === 'number') {
    duel.setResponseInt(response);
  } else if (Buffer.isBuffer(response)) {
    duel.setResponse(response);
  }
  
  // Continue processing
  await advance();
}

async function advance() {
  if (!duel) return;
  
  while (true) {
    const result = duel.process({ noParse: true });
    
    if (result.raw.length > 0) {
      // Decode the binary message
      let messages;
      try {
        messages = YGOProMessages.getInstancesFromPayload(result.raw);
      } catch (e) {
        send({ type: 'error', message: `Decode error: ${e.message}` });
        return;
      }
      
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          // Send each message to parent as raw payload
          const payload = Buffer.from(msg.toPayload());
          send({
            type: 'gameMsg',
            msgType: msg.constructor.msgType || 0,
            status: result.status,
            payload: Array.from(payload), // convert to plain array for postMessage
          });
          
          const { YGOProMsgResponseBase, YGOProMsgRetry, YGOProMsgWin } = await import('ygopro-msg-encode');
          
          if (msg instanceof YGOProMsgRetry) {
            return; // Wait for re-response
          }
          
          if (msg instanceof YGOProMsgResponseBase) {
            return; // Wait for player response
          }
          
          if (msg instanceof YGOProMsgWin) {
            send({ type: 'win', player: msg.player, reason: msg.type });
            return;
          }
        }
      }
    }
    
    // Check end conditions
    if (result.status === 2) {
      send({ type: 'done' });
      return;
    }
    
    if (result.raw.length === 0 && result.status === 0) {
      // Nothing to do, but still advancing
      continue;
    }
    
    if (result.status !== 0) {
      send({ type: 'done' });
      return;
    }
  }
}

// ── Queries ───────────────────────────────────

async function handleQueryFieldCount({ player, location }) {
  if (!duel) return;
  const count = duel.queryFieldCount({ player, location });
  send({ type: 'fieldCount', player, location, count, requestId: msg.requestId });
}

async function handleQueryFieldInfo(_msg) {
  if (!duel) return;
  const result = duel.queryFieldInfo({ noParse: true });
  send({ type: 'fieldInfo', data: Array.from(result.raw) });
}

// ── Helpers ───────────────────────────────────

function send(msg) {
  if (parentPort) {
    parentPort.postMessage(msg);
  }
}
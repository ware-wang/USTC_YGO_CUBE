/**
 * DuelSession — wraps koishipro-core.js WASM ocgcore for a single duel.
 *
 * Lifecycle:
 *   new DuelSession() → await init() → await advance()
 *   advance() emits: 'gameMsg', 'select', 'win', 'error', 'done'
 *   External calls: sendResponse(data), surrender(player)
 *
 * Events:
 *   'gameMsg'  ({ type, data })     — broadcast messages (moves, draws, phases, etc.)
 *   'select'   ({ type, data })     — player needs to make a choice
 *   'win'      ({ player, reason }) — duel ended
 *   'error'    ({ message })        — error occurred
 *   'done'                          — ocgcore finished
 */

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Force CJS version (Node.js fetch doesn't support file:// for WASM loading)
const require = createRequire(import.meta.url);
const { createOcgcoreWrapper, DirScriptReaderEx, DirCardReader, OcgcoreDuelOptionFlag, _OcgcoreConstants } = require('koishipro-core.js');
import {
  YGOProMessages,
  YGOProMsgRetry,
  YGOProMsgResponseBase,
  YGOProMsgWin,
  YGOProMsgWaiting,
} from 'ygopro-msg-encode';

const { OcgcoreScriptConstants } = _OcgcoreConstants;

const TEST_MODE_SCRIPTED_FALLBACK_MAIN_IDS = [
  38033121, // Dark Magician Girl
  71413901, // Breaker the Magical Warrior
  77585513, // Jinzo
  74131780, // Exiled Force
  15341821, // Dandylion
  29587993, // Mist Valley Apex Avian
  47606319, // Gigantes
  70095154, // Cyber Dragon
  78010363, // Witch of the Black Forest
  59793705, // Elemental HERO Bladedge
  66768175, // Performapal Bot-Eyes Lizard
  72989439, // Black Luster Soldier - Envoy of the Beginning
  94689206, // Block Dragon
  86676862, // Evil HERO Malicious Edge
  5318639,  // Pot of Avarice
  83764718, // Monster Reborn
  12580477, // Raigeki
  81439173, // Swords of Revealing Light
  44095762, // Mirror Force
  14087893, // Book of Moon
];

export class DuelSession extends EventEmitter {
  #ocgcore = null;
  #duel = null;
  #active = false;
  #waitingResponse = false;
  #turnCount = 0;
  #turnPlayer = 0;
  #currentPhase = 0;
  #lastResponseMsg = null;
  #lastResponsePlayer = null;

  constructor({ decks, hostinfo, scriptPath, cardsCdbPath, seed }) {
    super();
    this.decks = decks;
    this.hostinfo = { start_lp: 8000, start_hand: 5, draw_count: 1, duel_rule: 5, ...hostinfo };
    this.scriptPath = scriptPath;
    this.cardsCdbPath = cardsCdbPath;
    this.seed = seed || Date.now();
    this.loadedDecks = Array.from({ length: 2 }, () => ({ main: [], extra: [] }));
    this.testMode = hostinfo?.testMode === true;
  }

  get active() { return this.#active; }
  get turnCount() { return this.#turnCount; }
  get turnPlayer() { return this.#turnPlayer; }
  get currentPhase() { return this.#currentPhase; }
  get waitingResponsePlayer() {
    return this.#waitingResponse ? this.#lastResponsePlayer : null;
  }
  getDeckSizes() {
    return this.loadedDecks.map((deck) => ({
      main: deck.main.length,
      extra: deck.extra.length,
    }));
  }

  // ── Initialization ───────────────────────────

  async init(sqljs) {
    this.#ocgcore = await createOcgcoreWrapper();

    // Load Lua scripts
    const scriptReader = await DirScriptReaderEx(this.scriptPath);
    this.#ocgcore.setScriptReader(scriptReader);

    // Load card data from cards.cdb
    const cardReader = await DirCardReader(sqljs, this.cardsCdbPath);
    this.#ocgcore.setCardReader(cardReader);

    // Create duel
    this.#duel = this.#ocgcore.createDuelV2(this.seed);

    // Set player info
    for (let i = 0; i < 2; i++) {
      this.#duel.setPlayerInfo({
        player: i,
        lp: this.hostinfo.start_lp,
        startHand: this.hostinfo.start_hand,
        drawCount: this.hostinfo.draw_count,
      });
    }

    // Load decks
    for (let player = 0; player < 2; player++) {
      const deck = this.decks[player];
      if (!deck) continue;

      console.log(`[DuelSession] Player ${player} raw deck: main=${deck.main?.length || 0}, extra=${deck.extra?.length || 0}`);

      // Filter cards without Lua scripts (prevents WASM crash)
      const missingScripts = [];
      const main = [...deck.main].reverse().filter(code => {
        const hasScript = existsSync(join(this.scriptPath, `c${code}.lua`));
        if (!hasScript) missingScripts.push(code);
        return hasScript;
      });
      if (this.testMode && main.length < 40) {
        fillDeckWithScriptedFallback(main, this.scriptPath, 40);
      }
      if (missingScripts.length > 0) {
        console.warn(`[DuelSession] Skipping ${missingScripts.length} main-deck cards without scripts: ${missingScripts.slice(0, 10).join(',')}${missingScripts.length > 10 ? '...' : ''}`);
      }
      for (const code of main) {
        this.#duel.newCard({
          code, owner: player, player,
          location: OcgcoreScriptConstants.LOCATION_DECK,
          sequence: 0,
          position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
        });
      }

      const extra = [...deck.extra].reverse().filter(code => {
        const hasScript = existsSync(join(this.scriptPath, `c${code}.lua`));
        if (!hasScript) missingScripts.push(code);
        return hasScript;
      });
      if (missingScripts.length > 0 && deck.extra?.length > 0) {
        console.warn(`[DuelSession] Player ${player}: ${missingScripts.length} cards skipped (no Lua script)`);
      }
      for (const code of extra) {
        this.#duel.newCard({
          code, owner: player, player,
          location: OcgcoreScriptConstants.LOCATION_EXTRA,
          sequence: 0,
          position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
        });
      }

      this.loadedDecks[player] = {
        main: [...main].reverse(),
        extra: [...extra].reverse(),
      };
      console.log(`[DuelSession] Player ${player} loaded deck after script filter: main=${this.loadedDecks[player].main.length}, extra=${this.loadedDecks[player].extra.length}, testMode=${this.testMode}`);
    }

    // Calculate and apply duel options. Keep this aligned with srvpro2:
    // duel_rule lives in the high 16 bits; 0x20 is TagMode, not Single mode.
    this.#duel.startDuel({
      rule: this.hostinfo.duel_rule,
      flags: this.hostinfo.mode & 0x2 ? [OcgcoreDuelOptionFlag.TagMode] : [],
    });
    this.#active = true;
  }

  // ── Main game loop ───────────────────────────

  async advance() {
    if (!this.#active || this.#waitingResponse) return;

    try {
      while (this.#active) {
        const result = this.#duel.process({ noParse: true });

        // Handle raw binary messages
        if (result.raw.length > 0) {
          let messages;
          try {
            messages = YGOProMessages.getInstancesFromPayload(result.raw);
          } catch (e) {
            this.emit('error', { message: `Decode error: ${e.message}` });
            return;
          }

          if (messages && messages.length > 0) {
            for (const msg of messages) {
              const shouldStop = this._dispatchMessage(msg, result.status);
              if (shouldStop) return;
            }
          }
        }

        if (result.status === 2) {
          this.#active = false;
          this.emit('done');
          return;
        }

        if (result.raw.length === 0 && result.status === 0) {
          continue; // keep processing
        }

        if (result.status !== 0) {
          this.#active = false;
          this.emit('done');
          return;
        }
      }
    } catch (e) {
      this.#active = false;
      this.emit('error', { message: e.message, stack: e.stack });
    }
  }

  _dispatchMessage(msg, status) {
    // Track turn/phase changes
    if (msg.constructor.name === 'YGOProMsgNewTurn') {
      const tp = msg.player;
      const rawBuf = Buffer.from(msg.toPayload());
      if (!(tp & 0x2)) {
        this.#turnCount++;
        this.#turnPlayer = tp & 0x1;
        this.emit('gameMsg', {
          type: 'newTurn',
          data: {
            turn: this.#turnCount,
            player: this.#turnPlayer,
            raw: rawBuf.toString('base64'),
            _rawBuf: rawBuf,
          },
        });
      } else {
        this.emit('gameMsg', {
          type: 'newTurn',
          data: { raw: rawBuf.toString('base64'), _rawBuf: rawBuf },
        });
      }
      return false;
    }

    if (msg.constructor.name === 'YGOProMsgNewPhase') {
      this.#currentPhase = msg.phase;
      const rawBuf = Buffer.from(msg.toPayload());
      this.emit('gameMsg', {
        type: 'newPhase',
        data: { phase: msg.phase, raw: rawBuf.toString('base64'), _rawBuf: rawBuf },
      });
      return false;
    }

    // MSG_RETRY — wait for re-response
    if (msg instanceof YGOProMsgRetry) {
      this.#waitingResponse = true;
      const rawBuf = Buffer.from(msg.toPayload());
      const playerPayloads = this.#lastResponseMsg && (this.#lastResponsePlayer === 0 || this.#lastResponsePlayer === 1)
        ? buildPlayerPayloads(this.#lastResponseMsg, this.#lastResponsePlayer)
        : null;
      this.emit('select', {
        type: 'retry',
        data: {
          raw: rawBuf.toString('base64'),
          _rawBuf: rawBuf,
          responsePlayer: this.#lastResponsePlayer,
          playerPayloads,
        },
      });
      return true;
    }

    // Response-required messages — wait for player
    if (msg instanceof YGOProMsgResponseBase) {
      this.#waitingResponse = true;
      const responsePlayer = msg.responsePlayer ? msg.responsePlayer() : null;
      const rawBuf = Buffer.from(msg.toPayload());
      this.#lastResponseMsg = msg;
      this.#lastResponsePlayer = responsePlayer;
      console.log(`[DuelSession] Waiting response: msg=${msg.constructor.name}, player=${responsePlayer}, bytes=${rawBuf.length}`);
      this.emit('select', {
        type: 'response',
        data: {
          msgType: msg.constructor.name,
          raw: rawBuf.toString('base64'),
          _rawBuf: rawBuf,
          responsePlayer,
          playerPayloads: buildPlayerPayloads(msg, responsePlayer),
        },
      });
      return true;
    }

    // MSG_WIN — duel ended
    if (msg instanceof YGOProMsgWin) {
      this.#active = false;
      this.#lastResponseMsg = null;
      this.#lastResponsePlayer = null;
      // Also send the raw WIN message
      const winRawBuf = Buffer.from(msg.toPayload());
      this.emit('gameMsg', {
        type: msg.constructor.name,
        data: { raw: winRawBuf.toString('base64'), _rawBuf: winRawBuf },
      });
      this.emit('win', { player: msg.player, reason: msg.type });
      return true;
    }

    // Regular broadcast message
    const rawBuf = Buffer.from(msg.toPayload());
    this.emit('gameMsg', {
      type: msg.constructor.name,
      data: { raw: rawBuf.toString('base64'), _rawBuf: rawBuf },
    });
    return false;
  }

  // ── Player input ─────────────────────────────

  sendResponse(response) {
    if (!this.#waitingResponse || !this.#duel) return;
    this.#waitingResponse = false;

    if (typeof response === 'number') {
      this.#duel.setResponseInt(response);
    } else if (Buffer.isBuffer(response)) {
      this.#duel.setResponse(response);
    } else if (typeof response === 'object' && response.data) {
      // Base64-encoded buffer from browser
      this.#duel.setResponse(Buffer.from(response.data, 'base64'));
    }

    // Continue processing
    setImmediate(() => this.advance());
  }

  surrender(player) {
    if (!this.#active) return;
    this.#active = false;
    this.#waitingResponse = false;
    this.#lastResponseMsg = null;
    this.#lastResponsePlayer = null;
    this.emit('win', { player: 1 - player, reason: 0 }); // reason 0 = surrender
  }

  // ── Field queries ────────────────────────────

  queryFieldCount(player, location) {
    if (!this.#duel) return 0;
    return this.#duel.queryFieldCount({ player, location });
  }

  queryFieldCards(player, location, queryFlag) {
    if (!this.#duel) return { cards: [] };
    const { cards } = this.#duel.queryFieldCard({ player, location, queryFlag: queryFlag || 0xf81fff, useCache: 1 });
    return { cards: cards ?? [] };
  }

  queryFieldInfo() {
    if (!this.#duel) return null;
    const result = this.#duel.queryFieldInfo({ noParse: true });
    return result;
  }

  // ── Cleanup ──────────────────────────────────

  dispose() {
    this.#active = false;
    if (this.#duel && !this.#duel.ended) {
      try { this.#duel.endDuel(); } catch (e) { /* ignore */ }
    }
    if (this.#ocgcore) {
      try { this.#ocgcore.finalize(); } catch (e) { /* ignore */ }
    }
    this.#duel = null;
    this.#ocgcore = null;
  }
}

function fillDeckWithScriptedFallback(main, scriptPath, targetSize) {
  const scriptedFallback = TEST_MODE_SCRIPTED_FALLBACK_MAIN_IDS.filter((code) =>
    existsSync(join(scriptPath, `c${code}.lua`)),
  );
  if (scriptedFallback.length === 0) {
    return;
  }
  while (main.length < targetSize) {
    main.push(scriptedFallback[main.length % scriptedFallback.length]);
  }
}

function buildPlayerPayloads(msg, responsePlayer) {
  if (responsePlayer !== 0 && responsePlayer !== 1) {
    return null;
  }
  const waiting = Buffer.from(new YGOProMsgWaiting().toPayload()).toString('base64');
  return [0, 1].map((player) => {
    const view = player === responsePlayer ? msg.playerView(player) : new YGOProMsgWaiting();
    const raw = Buffer.from(view.toPayload());
    return {
      player,
      raw: raw.toString('base64'),
      waiting: raw.toString('base64') === waiting,
    };
  });
}

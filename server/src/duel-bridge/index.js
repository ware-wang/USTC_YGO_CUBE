/**
 * DuelBridge — manages active duel sessions, bridges cube-draft ↔ ocgcore.
 *
 * API:
 *   createSession({ decks, hostinfo, options }) → DuelSession
 *   getSession(sessionId) → DuelSession | null
 *   removeSession(sessionId)
 */

import { DuelSession } from './duel-session.js';
import { parseGameMessage, parseSelectMessage, buildSetResponse } from './relay.js';

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export class DuelBridge {
  #sessions = new Map();
  #sqljs = null;
  #ready = false;

  /**
   * Initialize the bridge. Must be called once before creating sessions.
   * @param {object} sqljs - initialized sql.js instance
   */
  init(sqljs) {
    this.#sqljs = sqljs;
    this.#ready = true;
    console.log('[DuelBridge] Initialized');
  }

  get ready() { return this.#ready; }

  /**
   * Create a new duel session from drafted decks.
   * @param {object} params
   * @param {Array<{main: number[], extra: number[]}>} params.decks - [player0Deck, player1Deck]
   * @param {object} params.hostinfo - { start_lp, start_hand, draw_count, duel_rule }
   * @param {object} params.options - { scriptPath, cardsCdbPath, seed }
   * @returns {Promise<DuelSession>}
   */
  async createSession({ decks, hostinfo, options }) {
    if (!this.#ready) throw new Error('DuelBridge not initialized');

    const session = new DuelSession({
      decks,
      hostinfo,
      scriptPath: options.scriptPath,
      cardsCdbPath: options.cardsCdbPath,
      seed: options.seed,
    });

    await session.init(this.#sqljs);

    const sessionId = `duel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    session.sessionId = sessionId;
    session.createdAt = Date.now();

    // Cleanup on end
    session.on('win', () => this._scheduleCleanup(sessionId));
    session.on('done', () => this._scheduleCleanup(sessionId));
    session.on('error', () => this._scheduleCleanup(sessionId));

    this.#sessions.set(sessionId, session);

    // Start the game loop
    setImmediate(() => session.advance());

    return session;
  }

  getSession(sessionId) {
    return this.#sessions.get(sessionId) || null;
  }

  removeSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.#sessions.delete(sessionId);
    }
  }

  getStats() {
    let active = 0;
    for (const s of this.#sessions.values()) {
      if (s.active) active++;
    }
    return { total: this.#sessions.size, active };
  }

  // ── Relay helpers ─────────────────────────────

  parseGameMessage(rawBase64) {
    return parseGameMessage(rawBase64);
  }

  parseSelectMessage(rawBase64) {
    return parseSelectMessage(rawBase64);
  }

  buildSetResponse(selectType, data) {
    return buildSetResponse(selectType, data);
  }

  // ── Internal ──────────────────────────────────

  _scheduleCleanup(sessionId) {
    // Keep session alive for 5 minutes after game ends (for YDK export etc)
    setTimeout(() => {
      this.removeSession(sessionId);
    }, 5 * 60 * 1000);
  }
}

// Singleton
export const duelBridge = new DuelBridge();
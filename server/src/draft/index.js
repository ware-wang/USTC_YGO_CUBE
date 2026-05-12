import cardDB from '../card-db/index.js';

/**
 * Draft Engine — pure logic, no I/O.
 *
 * Cube draft flow (boot style):
 *   1. Shuffle cube, deal each player P packs of C cards
 *   2. Pack 1: everyone opens, picks 1, passes. Repeat until pack exhausted.
 *   3. Pack 2: same but direction reverses. And so on.
 *   N. Pools → .ydk export
 *
 * State:
 *   packIndex      — which of the P packs we're on (0-based)
 *   direction      — 1 = pass right, -1 = pass left (flips each pack)
 *   playerPacks    — Map<playerId, Array<Array<cardId>>>
 *                     playerPacks[p][packIndex] is the CURRENT active pack
 *                   note: after rotation the array entry is mutated in place
 *   playerPools    — Map<playerId, Array<cardId>>  picked cards
 *   confirmedThisRound — Set<playerId>  who has locked in this pick
 */

const DEFAULT_CARDS_PER_PACK = 15;

export const DRAFT_STATES = {
  IDLE: 'idle',
  DRAFTING: 'drafting',
  COMPLETE: 'complete',
};

export class DraftEngine {
  constructor(cubeCardIds) {
    this.cubeCardIds = [...cubeCardIds];
    this.state = DRAFT_STATES.IDLE;
    this.players = [];
    this.packsPerPlayer = 0;
    this.cardsPerPack = DEFAULT_CARDS_PER_PACK;
    this.packIndex = 0;          // which pack we're on: 0 .. packsPerPlayer-1
    this.direction = 1;          // 1 = right, -1 = left
    this.playerPacks = new Map(); // playerId -> Array<Array<cardId>>
    this.playerPools = new Map(); // playerId -> Array<cardId>
    this.confirmedThisRound = null; // Set<playerId>
    this.totalPicksMade = 0;     // total picks across ALL players — for display
  }

  /* ------------------------------------------------------------------ */
  /*  Init                                                              */
  /* ------------------------------------------------------------------ */
  init(players, packsPerPlayer, opts = {}) {
    this.cardsPerPack = opts.cardsPerPack || DEFAULT_CARDS_PER_PACK;
    this.packsPerPlayer = packsPerPlayer;
    this.packIndex = 0;
    this.direction = 1;
    this.confirmedThisRound = new Set();
    this.totalPicksMade = 0;
    this.players = players.map(p => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
    }));

    const totalCards = players.length * packsPerPlayer * this.cardsPerPack;
    const pool = this._buildPool(totalCards);

    this.playerPacks.clear();
    this.playerPools.clear();
    let idx = 0;
    for (const player of this.players) {
      const packs = [];
      for (let p = 0; p < packsPerPlayer; p++) {
        packs.push(pool.slice(idx, idx + this.cardsPerPack));
        idx += this.cardsPerPack;
      }
      this.playerPacks.set(player.id, packs);
      this.playerPools.set(player.id, []);
    }

    this.state = DRAFT_STATES.DRAFTING;
    console.log(`[Draft] ${players.length}P x ${packsPerPlayer} packs x ${this.cardsPerPack} cards`);
  }

  /* ------------------------------------------------------------------ */
  /*  Pack query                                                        */
  /* ------------------------------------------------------------------ */
  getCurrentPack(playerId) {
    const packs = this.playerPacks.get(playerId);
    if (!packs || this.packIndex >= packs.length) return null;
    const cards = packs[this.packIndex];
    const details = cards.map(id => cardDB.getCardFull(id)).filter(Boolean);
    return {
      cards: details,
      packIndex: this.packIndex,
      totalPacks: this.packsPerPlayer,
      remaining: cards.length,
      direction: this.direction,
      picked: this.playerPools.get(playerId)?.length || 0,
    };
  }

  /** How many cards remain in the current pack across all players */
  _cardsLeftInCurrentPack() {
    for (const p of this.players) {
      const packs = this.playerPacks.get(p.id);
      if (packs && packs[this.packIndex]?.length > 0) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /*  Picking                                                           */
  /* ------------------------------------------------------------------ */
  confirmPick(playerId, cardIndex) {
    if (this.state !== DRAFT_STATES.DRAFTING) {
      return { success: false, error: '轮抽未开始' };
    }
    if (this.confirmedThisRound.has(playerId)) {
      return { success: false, error: '你已在本轮确认过选择' };
    }
    const packs = this.playerPacks.get(playerId);
    if (!packs || this.packIndex >= packs.length) {
      return { success: false, error: '无效的包' };
    }
    const pack = packs[this.packIndex];
    if (cardIndex < 0 || cardIndex >= pack.length) {
      return { success: false, error: '无效的卡牌索引' };
    }

    const pickedId = pack.splice(cardIndex, 1)[0];
    this.playerPools.get(playerId).push(pickedId);
    this.confirmedThisRound.add(playerId);
    this.totalPicksMade++;

    const allConfirmed = this.confirmedThisRound.size >= this.players.length;

    if (!allConfirmed) {
      return {
        success: true,
        pickedCardId: pickedId,
        allConfirmed: false,
        confirmedCount: this.confirmedThisRound.size,
        totalPlayers: this.players.length,
      };
    }

    // -- every player has locked in this round --
    this.rotatePacks();
    this.confirmedThisRound.clear();

    // Is the current pack exhausted ?
    if (!this._cardsLeftInCurrentPack()) {
      // Move to next pack
      this.packIndex++;
      this.direction = this.packIndex % 2 === 0 ? 1 : -1;

      if (this.packIndex >= this.packsPerPlayer) {
        this.state = DRAFT_STATES.COMPLETE;
        return {
          success: true,
          pickedCardId: pickedId,
          allConfirmed: true,
          draftComplete: true,
        };
      }

      return {
        success: true,
        pickedCardId: pickedId,
        allConfirmed: true,
        draftComplete: false,
        packIndex: this.packIndex,
        direction: this.direction,
      };
    }

    return {
      success: true,
      pickedCardId: pickedId,
      allConfirmed: true,
      draftComplete: false,
      packIndex: this.packIndex,
      direction: this.direction,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Rotation                                                          */
  /* ------------------------------------------------------------------ */
  rotatePacks() {
    const n = this.players.length;
    if (n <= 1) return;

    const currentPacks = this.players.map(p => {
      const packs = this.playerPacks.get(p.id);
      return packs[this.packIndex];
    });

    const rotated = new Array(n);
    for (let i = 0; i < n; i++) {
      const fromIdx = (i - this.direction + n) % n;
      rotated[i] = [...currentPacks[fromIdx]];
    }

    for (let i = 0; i < n; i++) {
      this.playerPacks.get(this.players[i].id)[this.packIndex] = rotated[i];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */
  _buildPool(needed) {
    let cards = [...this.cubeCardIds];
    this._shuffle(cards);
    while (cards.length < needed) {
      const more = [...this.cubeCardIds];
      this._shuffle(more);
      cards = cards.concat(more);
    }
    return cards.slice(0, needed);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ------------------------------------------------------------------ */
  /*  Results                                                           */
  /* ------------------------------------------------------------------ */
  getPlayerPools() {
    const result = {};
    for (const player of this.players) {
      const pool = this.playerPools.get(player.id) || [];
      result[player.id] = {
        name: player.name,
        cardIds: pool,
        cards: pool.map(id => cardDB.getCardFull(id)).filter(Boolean),
      };
    }
    return result;
  }

  generateYdk(playerId) {
    const T_EXTRA = 0x40 | 0x2000 | 0x800000 | 0x4000000;
    const pool = this.playerPools.get(playerId) || [];
    const main = [];
    const extra = [];
    for (const id of pool) {
      const card = cardDB.getCardFull(id);
      if (card && (card.type & T_EXTRA)) extra.push(id);
      else main.push(id);
    }
    return [
      '#created by Cube Draft',
      '#main',
      ...main.map(String),
      '#extra',
      ...extra.map(String),
      '!side',
    ].join('\n');
  }
}
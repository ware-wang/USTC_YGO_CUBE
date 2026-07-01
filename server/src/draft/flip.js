import cardDB from '../card-db/index.js';
import { DRAFT_STATES } from './index.js';

const DEFAULT_ROW_SIZE = 4;
const DEFAULT_TARGET_CARDS = 45;
const DEFAULT_TURN_FUNDS = 4;
const MAX_TURN_CARDS = 3;
const ROW_COSTS = [3, 2, 1];

export class FlipDraftEngine {
  constructor(cubeCardIds) {
    this.cubeCardIds = [...cubeCardIds];
    this.state = DRAFT_STATES.IDLE;
    this.players = [];
    this.rowSize = DEFAULT_ROW_SIZE;
    this.targetCards = DEFAULT_TARGET_CARDS;
    this.turnFunds = DEFAULT_TURN_FUNDS;
    this.maxTurnCards = MAX_TURN_CARDS;
    this.drawPile = [];
    this.market = [];
    this.trash = [];
    this.playerPools = new Map();
    this.activePlayerIndex = 0;
    this.remainingFunds = DEFAULT_TURN_FUNDS;
    this.turnBoughtCount = 0;
    this.cubeExhausted = false;
    this.turnNumber = 0;
    this.pickRound = 0;
    this.turnStartedAt = null;
    this.finalRoundStarted = false;
  }

  init(players, opts = {}) {
    this.players = this._sortPlayersBySeat(players);
    this.rowSize = clampInt(opts.rowSize, DEFAULT_ROW_SIZE, 1, 12);
    this.targetCards = clampInt(opts.targetCards, DEFAULT_TARGET_CARDS, 1, 200);
    this.turnFunds = clampInt(opts.turnFunds, DEFAULT_TURN_FUNDS, 1, 20);
    this.maxTurnCards = MAX_TURN_CARDS;
    this.drawPile = [...this.cubeCardIds];
    this._shuffle(this.drawPile);
    this.market = Array(this._marketCapacity()).fill(null);
    this.trash = [];
    this.playerPools.clear();

    for (const player of this.players) {
      this.playerPools.set(player.id, []);
    }

    this.activePlayerIndex = 0;
    this.remainingFunds = this.turnFunds;
    this.turnBoughtCount = 0;
    this.cubeExhausted = false;
    this.turnNumber = 1;
    this.pickRound = 0;
    this.turnStartedAt = Date.now();
    this.finalRoundStarted = false;

    this._fillMarketTop();
    this.state = DRAFT_STATES.DRAFTING;

    console.log(`[FlipDraft] ${players.length}P target=${this.targetCards} rowSize=${this.rowSize}`);
  }

  getPublicState(viewerPlayerId, opts = {}) {
    const timeoutMs = Number.isFinite(opts.turnTimeoutMs) ? opts.turnTimeoutMs : null;
    const now = Date.now();
    const activePlayer = this.getActivePlayer();

    return {
      mode: 'flip',
      state: this.state,
      rowSize: this.rowSize,
      targetCards: this.targetCards,
      turnFunds: this.turnFunds,
      maxTurnCards: this.maxTurnCards,
      turnNumber: this.turnNumber,
      pickRound: this.pickRound,
      activePlayerId: activePlayer?.id || null,
      activePlayerName: activePlayer?.name || null,
      activeSeatIndex: Number.isInteger(activePlayer?.seatIndex) ? activePlayer.seatIndex : null,
      isYourTurn: activePlayer?.id === viewerPlayerId,
      remainingFunds: this.remainingFunds,
      turnBoughtCount: this.turnBoughtCount,
      drawRemaining: this.drawPile.length,
      trashCount: this.trash.length,
      cubeExhausted: this.cubeExhausted,
      finalRoundStarted: this.finalRoundStarted,
      turnStartedAt: this.turnStartedAt,
      turnTimeoutMs: timeoutMs,
      turnDeadlineAt: timeoutMs && this.turnStartedAt ? this.turnStartedAt + timeoutMs : null,
      serverNow: now,
      playerProgress: this.players.map(player => {
        const count = this.playerPools.get(player.id)?.length || 0;
        return {
          id: player.id,
          name: player.name,
          seatIndex: Number.isInteger(player.seatIndex) ? player.seatIndex : null,
          count,
          target: this.targetCards,
          reached: count >= this.targetCards,
        };
      }),
      market: {
        rows: ROW_COSTS.map((cost, rowIndex) => {
          const slots = this._marketRowSlots(rowIndex);
          return {
            cost,
            cards: slots.filter(Boolean),
            slots,
          };
        }),
      },
      picked: this.playerPools.get(viewerPlayerId)?.length || 0,
      pickedCards: this.getPlayerPoolCards(viewerPlayerId),
    };
  }

  getActivePlayer() {
    return this.players[this.activePlayerIndex] || null;
  }

  buyCard(playerId, marketSlot, expectedCardId = null) {
    if (this.state !== DRAFT_STATES.DRAFTING) {
      return { success: false, error: '轮抽未开始' };
    }

    const activePlayer = this.getActivePlayer();
    if (!activePlayer || activePlayer.id !== playerId) {
      return { success: false, error: '还没有轮到你购买' };
    }

    if (this.turnBoughtCount >= this.maxTurnCards) {
      return { success: false, error: `本回合最多只能抓 ${this.maxTurnCards} 张卡` };
    }

    const slot = Number(marketSlot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.market.length) {
      return { success: false, error: '无效的公共池位置' };
    }

    const pickedId = this.market[slot];
    if (!pickedId) {
      return { success: false, error: '该位置没有卡片' };
    }

    if (expectedCardId !== null && Number(expectedCardId) !== pickedId) {
      return { success: false, error: '公共池已更新，请重新选择' };
    }

    const cost = this._slotCost(slot);
    if (cost > this.remainingFunds) {
      return { success: false, error: '费用不足' };
    }

    this.market[slot] = null;
    this.playerPools.get(playerId).push(pickedId);
    this.remainingFunds -= cost;
    this.turnBoughtCount++;
    this.pickRound++;
    this.turnStartedAt = Date.now();

    this._maybeStartFinalRound();

    let turnAdvanced = false;
    let marketRefreshed = false;
    let draftComplete = false;

    if (
      this.turnBoughtCount >= this.maxTurnCards ||
      this.remainingFunds <= 0 ||
      !this._hasAffordableCard(this.remainingFunds)
    ) {
      const turnResult = this._endCurrentTurn();
      turnAdvanced = turnResult.turnAdvanced;
      marketRefreshed = turnResult.marketRefreshed;
      draftComplete = turnResult.draftComplete;
    }

    if (draftComplete) {
      this.state = DRAFT_STATES.COMPLETE;
    }

    return {
      success: true,
      pickedCardId: pickedId,
      spent: cost,
      remainingFunds: this.remainingFunds,
      turnBoughtCount: this.turnBoughtCount,
      maxTurnCards: this.maxTurnCards,
      turnAdvanced,
      marketRefreshed,
      draftComplete,
      finalRoundStarted: this.finalRoundStarted,
      picked: this.playerPools.get(playerId)?.length || 0,
    };
  }

  passTurn(playerId) {
    if (this.state !== DRAFT_STATES.DRAFTING) {
      return { success: false, error: '轮抽未开始' };
    }

    const activePlayer = this.getActivePlayer();
    if (!activePlayer || activePlayer.id !== playerId) {
      return { success: false, error: '还没有轮到你操作' };
    }

    this.pickRound++;
    this._maybeStartFinalRound();

    const turnResult = this._endCurrentTurn();
    const draftComplete = turnResult.draftComplete;

    if (draftComplete) {
      this.state = DRAFT_STATES.COMPLETE;
    }

    return {
      success: true,
      turnAdvanced: turnResult.turnAdvanced,
      marketRefreshed: turnResult.marketRefreshed,
      draftComplete,
      finalRoundStarted: this.finalRoundStarted,
      remainingFunds: this.remainingFunds,
      turnBoughtCount: this.turnBoughtCount,
      maxTurnCards: this.maxTurnCards,
    };
  }

  getPlayerPoolCards(playerId) {
    const pool = this.playerPools.get(playerId) || [];
    return pool.map(id => cardDB.getCardFull(id)).filter(Boolean);
  }

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
      if (card && (card.type & T_EXTRA)) {
        extra.push(id);
      } else {
        main.push(id);
      }
    }

    return [
      '#created by USTC-OnlineCube',
      '#main',
      ...main.map(String),
      '#extra',
      ...extra.map(String),
      '!side',
    ].join('\n');
  }

  _marketCapacity() {
    return ROW_COSTS.length * this.rowSize;
  }

  _marketRow(rowIndex) {
    return this._marketRowSlots(rowIndex).filter(Boolean);
  }

  _marketRowSlots(rowIndex) {
    const start = rowIndex * this.rowSize;
    const cost = ROW_COSTS[rowIndex];
    const slots = [];

    for (let col = 0; col < this.rowSize; col++) {
      const marketSlot = start + col;
      const id = this.market[marketSlot];

      if (!id) {
        slots.push(null);
        continue;
      }

      const card = cardDB.getCardFull(id);
      slots.push(card ? { ...card, marketSlot, row: rowIndex, col, cost } : null);
    }

    return slots;
  }

  _slotCost(slot) {
    const row = Math.floor(slot / this.rowSize);
    return ROW_COSTS[row] || ROW_COSTS[ROW_COSTS.length - 1];
  }

  _fillMarketTop(markExhausted = false) {
    let neededCard = false;
    let drewCard = false;

    for (let i = 0; i < this.market.length && this.drawPile.length > 0; i++) {
      if (!this.market[i]) {
        neededCard = true;
        this.market[i] = this.drawPile.shift();
        drewCard = true;
      }
    }

    if (markExhausted) {
      const stillHasEmptySlot = this.market.some(id => !id);
      if (stillHasEmptySlot || (neededCard && drewCard && this.drawPile.length === 0)) {
        this.cubeExhausted = true;
      }
    }
  }

  _refreshMarketAtTurnEnd() {
    for (const slot of this._bottomBurnSlots()) {
      const id = this.market[slot];
      if (!id) continue;

      this.trash.push(id);
      this.market[slot] = null;
    }

    const survivors = this.market.filter(Boolean);
    const next = Array(this._marketCapacity()).fill(null);
    const start = Math.max(0, next.length - survivors.length);

    for (let i = 0; i < survivors.length; i++) {
      next[start + i] = survivors[i];
    }

    this.market = next;
    this._fillMarketTop(true);
  }

  _bottomBurnSlots() {
    const bottomStart = (ROW_COSTS.length - 1) * this.rowSize;
    const slots = [];
    const firstBurnCol = Math.max(0, this.rowSize - 2);

    for (let col = firstBurnCol; col < this.rowSize; col++) {
      slots.push(bottomStart + col);
    }

    return slots;
  }

  _advanceTurn() {
    if (this.players.length === 0) return;

    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
    this.remainingFunds = this.turnFunds;
    this.turnBoughtCount = 0;
    this.turnNumber++;
    this.turnStartedAt = Date.now();
  }

  _skipReachedPlayers() {
    return;
  }

  _playerReachedTarget(playerId) {
    return (this.playerPools.get(playerId)?.length || 0) >= this.targetCards;
  }

  _allPlayersReachedTarget() {
    return this.players.length > 0 && this.players.every(player => this._playerReachedTarget(player.id));
  }

  _hasAffordableCard(funds) {
    return this.market.some((id, slot) => id && this._slotCost(slot) <= funds);
  }

  _maybeStartFinalRound() {
    if (!this.finalRoundStarted && this._allPlayersReachedTarget()) {
      this.finalRoundStarted = true;
    }
  }

  _isRoundLastPlayer() {
    return this.players.length > 0 && this.activePlayerIndex === this.players.length - 1;
  }

  _shouldCompleteAtTurnEnd() {
    return this.cubeExhausted || (this.finalRoundStarted && this._isRoundLastPlayer());
  }

  _shouldComplete() {
    return this._shouldCompleteAtTurnEnd();
  }

  _endCurrentTurn() {
    const marketRefreshed = true;
    this._refreshMarketAtTurnEnd();
    this._maybeStartFinalRound();

    if (this._shouldCompleteAtTurnEnd()) {
      return {
        turnAdvanced: false,
        marketRefreshed,
        draftComplete: true,
      };
    }

    this._advanceTurn();

    return {
      turnAdvanced: true,
      marketRefreshed,
      draftComplete: false,
    };
  }

  _sortPlayersBySeat(players) {
    return players
      .map((p, originalIndex) => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        originalIndex,
      }))
      .sort((a, b) => {
        const aSeat = Number.isFinite(a.seatIndex) ? a.seatIndex : Number.MAX_SAFE_INTEGER;
        const bSeat = Number.isFinite(b.seatIndex) ? b.seatIndex : Number.MAX_SAFE_INTEGER;

        if (aSeat !== bSeat) return aSeat - bSeat;
        return a.originalIndex - b.originalIndex;
      })
      .map(({ originalIndex, ...p }) => p);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
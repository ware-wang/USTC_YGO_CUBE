import { proxy, ref } from "valtio";

import { YgoProPacket } from "@/api/ocgcore/ocgAdapter/packet";

import { type NeosStore } from "./shared";

export const ReplayAdvanceFlag = {
  START: 1 << 0,
  DRAW: 1 << 1,
  NEW_TURN: 1 << 2,
  NEW_PHASE: 1 << 3,
  MOVE: 1 << 4,
  SET: 1 << 5,
  SWAP: 1 << 6,
  SUMMONING: 1 << 7,
  SUMMONED: 1 << 8,
  FLIP_SUMMONING: 1 << 9,
  FLIP_SUMMONED: 1 << 10,
  SP_SUMMONING: 1 << 11,
  SP_SUMMONED: 1 << 12,
  CHAINING: 1 << 13,
  CHAIN_SOLVED: 1 << 14,
  CHAIN_END: 1 << 15,
  ATTACK: 1 << 16,
  POS_CHANGE: 1 << 17,
  UPDATE_HP: 1 << 18,
  WIN: 1 << 19,
  BECOME_TARGET: 1 << 20,
  RELOAD_FIELD: 1 << 21,
  SHUFFLE_HAND_EXTRA: 1 << 22,
  SHUFFLE_SET_CARD: 1 << 23,
  FIELD_DISABLED: 1 << 24,
  CONFIRM_CARDS: 1 << 25,
  UPDATE_COUNTER: 1 << 26,
  UPDATE_DATA: 1 << 27,
} as const;

export const DEFAULT_REPLAY_ADVANCE_MASK =
  ReplayAdvanceFlag.START |
  ReplayAdvanceFlag.DRAW |
  ReplayAdvanceFlag.NEW_TURN |
  ReplayAdvanceFlag.NEW_PHASE |
  ReplayAdvanceFlag.MOVE |
  ReplayAdvanceFlag.SET |
  ReplayAdvanceFlag.SWAP |
  ReplayAdvanceFlag.SUMMONING |
  ReplayAdvanceFlag.SUMMONED |
  ReplayAdvanceFlag.FLIP_SUMMONING |
  ReplayAdvanceFlag.FLIP_SUMMONED |
  ReplayAdvanceFlag.SP_SUMMONING |
  ReplayAdvanceFlag.SP_SUMMONED |
  ReplayAdvanceFlag.CHAINING |
  ReplayAdvanceFlag.CHAIN_SOLVED |
  ReplayAdvanceFlag.CHAIN_END |
  ReplayAdvanceFlag.ATTACK |
  ReplayAdvanceFlag.POS_CHANGE |
  ReplayAdvanceFlag.UPDATE_HP |
  ReplayAdvanceFlag.WIN |
  ReplayAdvanceFlag.BECOME_TARGET |
  ReplayAdvanceFlag.RELOAD_FIELD |
  ReplayAdvanceFlag.SHUFFLE_HAND_EXTRA |
  ReplayAdvanceFlag.SHUFFLE_SET_CARD |
  ReplayAdvanceFlag.FIELD_DISABLED |
  ReplayAdvanceFlag.CONFIRM_CARDS |
  ReplayAdvanceFlag.UPDATE_COUNTER;

const GAME_MSG_ADVANCE_FLAGS: Record<string, number> = {
  start: ReplayAdvanceFlag.START,
  draw: ReplayAdvanceFlag.DRAW,
  new_turn: ReplayAdvanceFlag.NEW_TURN,
  new_phase: ReplayAdvanceFlag.NEW_PHASE,
  move: ReplayAdvanceFlag.MOVE,
  set: ReplayAdvanceFlag.SET,
  swap: ReplayAdvanceFlag.SWAP,
  summoning: ReplayAdvanceFlag.SUMMONING,
  summoned: ReplayAdvanceFlag.SUMMONED,
  flip_summoning: ReplayAdvanceFlag.FLIP_SUMMONING,
  flip_summoned: ReplayAdvanceFlag.FLIP_SUMMONED,
  sp_summoning: ReplayAdvanceFlag.SP_SUMMONING,
  sp_summoned: ReplayAdvanceFlag.SP_SUMMONED,
  chaining: ReplayAdvanceFlag.CHAINING,
  chain_solved: ReplayAdvanceFlag.CHAIN_SOLVED,
  chain_end: ReplayAdvanceFlag.CHAIN_END,
  attack: ReplayAdvanceFlag.ATTACK,
  pos_change: ReplayAdvanceFlag.POS_CHANGE,
  update_hp: ReplayAdvanceFlag.UPDATE_HP,
  win: ReplayAdvanceFlag.WIN,
  become_target: ReplayAdvanceFlag.BECOME_TARGET,
  reload_field: ReplayAdvanceFlag.RELOAD_FIELD,
  shuffle_hand_extra: ReplayAdvanceFlag.SHUFFLE_HAND_EXTRA,
  shuffle_set_card: ReplayAdvanceFlag.SHUFFLE_SET_CARD,
  field_disabled: ReplayAdvanceFlag.FIELD_DISABLED,
  confirm_cards: ReplayAdvanceFlag.CONFIRM_CARDS,
  update_counter: ReplayAdvanceFlag.UPDATE_COUNTER,
  update_data: ReplayAdvanceFlag.UPDATE_DATA,
};

// 对局中每一次状态改变的记录
interface ReplaySpot {
  packet: ReplayPacket; // 将会保存在回放文件中的数据
}

// 保存回放信息的数据包
interface ReplayPacket {
  func: number; // 对应的`GAME_MSG`编号
  extraData: ArrayBuffer;
}

// 保存对局回放数据的`Store`
class ReplayStore implements NeosStore {
  isReplay: boolean = false; // 是否进入了回放模式
  paused: boolean = false;
  waiting: boolean = false;
  currentIndex: number = -1;
  inner: ReplaySpot[] = ref([]);
  advanceResolvers: (() => void)[] = ref([]);
  private activeAdvanceMask?: number;

  beginReplay() {
    this.releaseAll();
    this.isReplay = true;
    this.paused = false;
    this.waiting = false;
    this.currentIndex = -1;
    this.activeAdvanceMask = undefined;
    this.advanceResolvers.splice(0);
  }

  record(ygoPacket: YgoProPacket) {
    this.inner.push({
      packet: ygoPacket2replayPacket(ygoPacket),
    });
  }

  pause() {
    if (!this.isReplay) return;
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.waiting = false;
    this.activeAdvanceMask = undefined;
    this.releaseAll();
  }

  advance(advanceMask = DEFAULT_REPLAY_ADVANCE_MASK) {
    if (!this.isReplay || !this.paused) return;
    if (!Number.isFinite(advanceMask) || advanceMask <= 0) {
      this.releaseOne();
      return;
    }

    this.activeAdvanceMask = advanceMask;
    this.releaseOne();
  }

  advanceToNextKey() {
    this.advance(DEFAULT_REPLAY_ADVANCE_MASK);
  }

  advanceTo(advanceMask: number) {
    this.advance(advanceMask);
  }

  async waitForAdvance(_gameMsg?: string) {
    if (!this.isReplay || !this.paused) return;
    if (this.activeAdvanceMask !== undefined) {
      this.waiting = false;
      return;
    }

    this.waiting = true;
    await new Promise<void>((resolve) => {
      this.advanceResolvers.push(resolve);
    });
    this.waiting = this.advanceResolvers.length > 0;
  }

  markAdvanced(gameMsg?: string) {
    if (!this.isReplay) return;

    this.currentIndex += 1;
    if (
      this.activeAdvanceMask !== undefined &&
      matchesAdvanceMask(this.activeAdvanceMask, gameMsg)
    ) {
      this.activeAdvanceMask = undefined;
    }
  }

  encode(): ArrayBuffer[] {
    return this.inner.map((spot) => spot.packet).map(replayPacket2arrayBuffer);
  }
  reset() {
    this.releaseAll();
    this.inner.splice(0);
    this.isReplay = false;
    this.paused = false;
    this.waiting = false;
    this.currentIndex = -1;
    this.activeAdvanceMask = undefined;
    this.advanceResolvers.splice(0);
  }

  private releaseOne() {
    const resolve = this.advanceResolvers.shift();
    if (resolve) {
      resolve();
      this.waiting = this.advanceResolvers.length > 0;
    }
  }

  private releaseAll() {
    while (this.advanceResolvers.length) {
      this.advanceResolvers.shift()?.();
    }
    this.waiting = false;
  }
}

const matchesAdvanceMask = (advanceMask: number, gameMsg?: string) => {
  if (!gameMsg) return false;

  const flag = GAME_MSG_ADVANCE_FLAGS[gameMsg];
  return flag !== undefined && (advanceMask & flag) !== 0;
};

const ygoPacket2replayPacket = (ygoPacket: YgoProPacket) => ({
  func: ygoPacket.exData[0],
  extraData: ygoPacket.exData.slice(1),
});

const replayPacket2arrayBuffer = (replayPacket: ReplayPacket) => {
  const { func, extraData } = replayPacket;
  const packetLen = 1 + 4 + extraData.byteLength;
  const array = new Uint8Array(packetLen);
  const dataview = new DataView(array.buffer);

  dataview.setUint8(0, func);
  dataview.setUint32(1, extraData.byteLength, true);
  array.set(new Uint8Array(extraData), 5);

  return array.buffer;
};

export const replayStore = proxy(new ReplayStore());

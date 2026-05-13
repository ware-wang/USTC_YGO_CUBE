/**
 * message-parser — parses ygopro-core binary protocol into structured JSON.
 *
 * Each message starts with a uint32 type code, followed by type-specific data.
 * Returns a JS object describing the game event or player prompt.
 */

// Constants (from common.h)
const LOCATION_DECK = 0x01, LOCATION_HAND = 0x02, LOCATION_MZONE = 0x04;
const LOCATION_SZONE = 0x08, LOCATION_GRAVE = 0x10, LOCATION_REMOVED = 0x20;
const LOCATION_EXTRA = 0x40, LOCATION_OVERLAY = 0x80;
const LOCATION_FZONE = 0x100, LOCATION_PZONE = 0x200;

const MSG_RETRY = 1, MSG_HINT = 2, MSG_WIN = 5;
const MSG_SELECT_BATTLECMD = 10, MSG_SELECT_IDLECMD = 11;
const MSG_SELECT_EFFECTYN = 12, MSG_SELECT_YESNO = 13;
const MSG_SELECT_OPTION = 14, MSG_SELECT_CARD = 15;
const MSG_SELECT_CHAIN = 16, MSG_SELECT_PLACE = 18;
const MSG_SELECT_POSITION = 19, MSG_SELECT_TRIBUTE = 20;
const MSG_SELECT_COUNTER = 22, MSG_SELECT_SUM = 23;
const MSG_SELECT_DISFIELD = 24, MSG_SELECT_UNSELECT_CARD = 26;
const MSG_CONFIRM_DECKTOP = 30, MSG_CONFIRM_CARDS = 31;
const MSG_SHUFFLE_DECK = 32, MSG_SHUFFLE_HAND = 33;
const MSG_SWAP_GRAVE_DECK = 35, MSG_SHUFFLE_SET_CARD = 36;
const MSG_REVERSE_DECK = 37, MSG_DECK_TOP = 38;
const MSG_SHUFFLE_EXTRA = 39, MSG_NEW_TURN = 40, MSG_NEW_PHASE = 41;
const MSG_MOVE = 50, MSG_POS_CHANGE = 53, MSG_SET = 54, MSG_SWAP = 55;
const MSG_FIELD_DISABLED = 56;
const MSG_SUMMONING = 60, MSG_SUMMONED = 61;
const MSG_SPSUMMONING = 62, MSG_SPSUMMONED = 63;
const MSG_FLIPSUMMONING = 64, MSG_FLIPSUMMONED = 65;
const MSG_CHAINING = 70, MSG_CHAINED = 71, MSG_CHAIN_SOLVING = 72;
const MSG_CHAIN_SOLVED = 73, MSG_CHAIN_END = 74;
const MSG_CHAIN_NEGATED = 75, MSG_CHAIN_DISABLED = 76;
const MSG_BECOME_TARGET = 83;
const MSG_DRAW = 90, MSG_DAMAGE = 91, MSG_RECOVER = 92;
const MSG_EQUIP = 93, MSG_LPUPDATE = 94;
const MSG_CARD_TARGET = 96, MSG_CANCEL_TARGET = 97;
const MSG_PAY_LPCOST = 100, MSG_ADD_COUNTER = 101, MSG_REMOVE_COUNTER = 102;
const MSG_ATTACK = 110, MSG_BATTLE = 111, MSG_ATTACK_DISABLED = 112;
const MSG_DAMAGE_STEP_START = 113, MSG_DAMAGE_STEP_END = 114;
const MSG_MISSED_EFFECT = 120;
const MSG_TOSS_COIN = 130, MSG_TOSS_DICE = 131;
const MSG_HAND_RES = 133;
const MSG_ANNOUNCE_RACE = 140, MSG_ANNOUNCE_ATTRIB = 141;
const MSG_ANNOUNCE_CARD = 142, MSG_ANNOUNCE_NUMBER = 143;
const MSG_CARD_HINT = 160, MSG_TAG_SWAP = 161;
const MSG_RELOAD_FIELD = 162;
const MSG_AI_NAME = 163, MSG_SHOW_HINT = 164, MSG_PLAYER_HINT = 165;
const MSG_MATCH_KILL = 170;

const HINT_EVENT = 1, HINT_MESSAGE = 2, HINT_SELECTMSG = 3;
const HINT_OPSELECTED = 4, HINT_EFFECT = 5, HINT_RACE = 6;
const HINT_ATTRIB = 7, HINT_CODE = 8, HINT_NUMBER = 9;
const HINT_CARD = 10, HINT_ZONE = 11;

/**
 * Parse a single message from the binary buffer.
 * Returns { type: string, ...fields } or null if unrecognized.
 */
export function parseMessage(buf, len) {
  if (len < 4) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, Math.min(buf.byteLength, len));
  let off = 0;
  const msgType = v.getUint8(off++);

  switch (msgType) {
    case MSG_RETRY:
      return { type: 'retry' };

    case MSG_HINT: {
      const hintType = v.getUint8(off++);
      const player = v.getUint8(off++);
      const data = v.getUint32(off, true); off += 4;
      return { type: 'hint', hintType, player, data };
    }

    case MSG_WIN: {
      const player = v.getUint8(off++);
      const reason = v.getUint8(off++);
      return { type: 'win', player, reason };
    }

    case MSG_SELECT_BATTLECMD: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const attacker = v.getUint32(off, true); off += 4;
      const attackerLoc = v.getUint8(off++);
      const attackerSeq = v.getUint8(off++);
      const attackerDesc = v.getUint32(off, true); off += 4;

      const codes = [];
      for (let i = 0; i < count; i++) {
        const cmdCode = v.getUint32(off, true); off += 4;
        const cmdDesc = v.getUint32(off, true); off += 4;
        codes.push({ code: cmdCode, description: cmdDesc });
      }

      const attackableCount = v.getUint8(off++);
      const attackableList = [];
      for (let i = 0; i < attackableCount; i++) {
        attackableList.push(v.getUint32(off, true)); off += 4;
      }

      return {
        type: 'prompt', promptType: 'battle_cmd', player,
        attacker: { controller: attackerLoc, sequence: attackerSeq, description: attackerDesc },
        commands: codes,
        attackable: attackableList,
      };
    }

    case MSG_SELECT_IDLECMD: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const summonable = v.getUint8(off++);
      const spsummonable = v.getUint8(off++);
      const repositionable = v.getUint8(off++);
      const msetable = v.getUint8(off++);
      const ssetable = v.getUint8(off++);
      const canBattlePhase = v.getUint8(off++);
      const canEndTurn = v.getUint8(off++);

      const codes = [];
      for (let i = 0; i < count; i++) {
        const cmdCode = v.getUint32(off, true); off += 4;
        const cmdData = v.getUint32(off, true); off += 4;
        codes.push({ code: cmdCode, data: cmdData });
      }

      return {
        type: 'prompt', promptType: 'idle_cmd', player,
        states: { summonable, spsummonable, repositionable, msetable, ssetable, canBattlePhase, canEndTurn },
        commands: codes,
      };
    }

    case MSG_SELECT_EFFECTYN: {
      const player = v.getUint8(off++);
      const cardLoc = v.getUint32(off, true); off += 4;
      const cardSeq = v.getUint8(off++);
      const cardCtrl = v.getUint8(off++);
      const effectDesc = v.getUint32(off, true); off += 4;
      return {
        type: 'prompt', promptType: 'effect_yn', player,
        card: locationString(cardLoc), sequence: cardSeq,
        controller: cardCtrl, description: effectDesc,
      };
    }

    case MSG_SELECT_YESNO: {
      const player = v.getUint8(off++);
      const desc = v.getUint32(off, true); off += 4;
      return { type: 'prompt', promptType: 'yes_no', player, description: desc };
    }

    case MSG_SELECT_OPTION: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const options = [];
      for (let i = 0; i < count; i++) {
        options.push(v.getUint32(off, true)); off += 4;
      }
      return { type: 'prompt', promptType: 'option', player, options };
    }

    case MSG_SELECT_CARD:
    case MSG_SELECT_TRIBUTE: {
      const player = v.getUint8(off++);
      const cancelable = v.getUint8(off++);
      const minSelect = v.getUint8(off++);
      const maxSelect = v.getUint8(off++);
      const count = v.getUint8(off++);

      const cards = [];
      for (let i = 0; i < count; i++) {
        const code = v.getUint32(off, true); off += 4;
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        const ctrl = v.getUint8(off++);
        cards.push({ code, location: locationString(loc), sequence: seq, controller: ctrl });
      }

      return {
        type: 'prompt',
        promptType: msgType === MSG_SELECT_TRIBUTE ? 'tribute' : 'select_card',
        player, cancelable, minSelect, maxSelect, cards,
      };
    }

    case MSG_SELECT_UNSELECT_CARD: {
      const player = v.getUint8(off++);
      const cancelable = v.getUint8(off++);
      const minSelect = v.getUint8(off++);
      const maxSelect = v.getUint8(off++);

      const finishable = v.getUint8(off++);
      const selectCount = v.getUint8(off++);
      const selectCards = [];
      for (let i = 0; i < selectCount; i++) {
        const code = v.getUint32(off, true); off += 4;
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        const ctrl = v.getUint8(off++);
        selectCards.push({ code, location: locationString(loc), sequence: seq, controller: ctrl });
      }

      const unselectCount = v.getUint8(off++);
      const unselectCards = [];
      for (let i = 0; i < unselectCount; i++) {
        const code = v.getUint32(off, true); off += 4;
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        const ctrl = v.getUint8(off++);
        unselectCards.push({ code, location: locationString(loc), sequence: seq, controller: ctrl });
      }

      return {
        type: 'prompt', promptType: 'unselect_card', player,
        cancelable, minSelect, maxSelect, finishable,
        selectCards, unselectCards,
      };
    }

    case MSG_SELECT_CHAIN: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const specount = v.getUint8(off++);
      const forced = v.getUint8(off++);
      const hint0 = v.getUint32(off, true); off += 4;
      const hint1 = v.getUint32(off, true); off += 4;

      const chains = [];
      for (let i = 0; i < count; i++) {
        const flag = v.getUint32(off, true); off += 4;
        const code = v.getUint32(off, true); off += 4;
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        const ctrl = v.getUint8(off++);
        const desc = v.getUint32(off, true); off += 4;
        chains.push({ flag, code, location: locationString(loc), sequence: seq, controller: ctrl, description: desc });
      }

      return {
        type: 'prompt', promptType: 'select_chain', player,
        specount, forced, hint0, hint1, chains,
      };
    }

    case MSG_SELECT_PLACE: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const flag = v.getUint32(off, true); off += 4;
      return {
        type: 'prompt', promptType: 'select_place', player, count, flag,
      };
    }

    case MSG_SELECT_POSITION: {
      const player = v.getUint8(off++);
      const code = v.getUint32(off, true); off += 4;
      const position = v.getUint8(off++);
      return {
        type: 'prompt', promptType: 'select_position', player, code, position,
      };
    }

    case MSG_SELECT_COUNTER: {
      const player = v.getUint8(off++);
      const counterType = v.getUint16(off, true); off += 2;
      const count = v.getUint16(off, true); off += 2;
      const cards = [];
      for (let i = 0; i < count; i++) {
        const code = v.getUint32(off, true); off += 4;
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        const ctrl = v.getUint8(off++);
        const counters = v.getUint16(off, true); off += 2;
        cards.push({ code, location: locationString(loc), sequence: seq, controller: ctrl, counters });
      }
      return { type: 'prompt', promptType: 'select_counter', player, counterType, cards };
    }

    case MSG_SELECT_SUM: {
      const player = v.getUint8(off++);
      const summonable = v.getUint8(off++);
      const msetable = v.getUint8(off++);
      const spsummonable = v.getUint8(off++);
      const mustSelect = v.getUint8(off++);
      const sumCount = v.getUint8(off++);
      // Cards that can be summoned
      const sumCards = [];
      for (let i = 0; i < sumCount; i++) {
        const code = v.getUint32(off, true); off += 4;
        const ctrl = v.getUint8(off++);
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        sumCards.push({ code, controller: ctrl, location: locationString(loc), sequence: seq });
      }

      const msetCount = v.getUint8(off++);
      const msetCards = [];
      for (let i = 0; i < msetCount; i++) {
        const code = v.getUint32(off, true); off += 4;
        const ctrl = v.getUint8(off++);
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        msetCards.push({ code, controller: ctrl, location: locationString(loc), sequence: seq });
      }

      const spsumCount = v.getUint8(off++);
      const spsumCards = [];
      for (let i = 0; i < spsumCount; i++) {
        const code = v.getUint32(off, true); off += 4;
        const ctrl = v.getUint8(off++);
        const loc = v.getUint32(off, true); off += 4;
        const seq = v.getUint8(off++);
        spsumCards.push({ code, controller: ctrl, location: locationString(loc), sequence: seq });
      }

      return {
        type: 'prompt', promptType: 'summon', player,
        summonable, msetable, spsummonable, mustSelect,
        cards: sumCards, msetCards, setCards: spsumCards,
      };
    }

    case MSG_SELECT_DISFIELD: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const filter = v.getUint32(off, true); off += 4;
      const flag = v.getUint32(off, true); off += 4;
      return {
        type: 'prompt', promptType: 'disfield', player, count, filter, flag,
      };
    }

    // ============== State events ==============
    case MSG_NEW_TURN: {
      const player = v.getUint8(off++);
      return { type: 'event', eventType: 'new_turn', player };
    }

    case MSG_NEW_PHASE: {
      const phase = v.getUint16(off, true); off += 2;
      return { type: 'event', eventType: 'new_phase', phase: phaseString(phase) };
    }

    case MSG_MOVE: {
      const code = v.getUint32(off, true); off += 4;
      const prevCtrl = v.getUint8(off++);
      const prevLoc = v.getUint32(off, true); off += 4;
      const prevSeq = v.getUint8(off++);
      const prevPos = v.getUint32(off, true); off += 4;
      const curCtrl = v.getUint8(off++);
      const curLoc = v.getUint32(off, true); off += 4;
      const curSeq = v.getUint8(off++);
      const curPos = v.getUint32(off, true); off += 4;
      const reason = v.getUint32(off, true); off += 4;
      return {
        type: 'event', eventType: 'move', code,
        previous: { controller: prevCtrl, location: locationString(prevLoc), sequence: prevSeq, position: prevPos },
        current: { controller: curCtrl, location: locationString(curLoc), sequence: curSeq, position: curPos },
        reason,
      };
    }

    case MSG_POS_CHANGE: {
      const code = v.getUint32(off, true); off += 4;
      const curPos = v.getUint32(off, true); off += 4;
      const prevPos = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: 'pos_change', code, position: curPos, previousPosition: prevPos };
    }

    case MSG_SET: {
      const code = v.getUint32(off, true); off += 4;
      const pos = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: 'set', code, position: pos };
    }

    case MSG_SWAP: {
      const code1 = v.getUint32(off, true); off += 4;
      const loc1 = v.getUint32(off, true); off += 4;
      const seq1 = v.getUint8(off++);
      const code2 = v.getUint32(off, true); off += 4;
      const loc2 = v.getUint32(off, true); off += 4;
      const seq2 = v.getUint8(off++);
      return { type: 'event', eventType: 'swap', card1: { code: code1, location: locationString(loc1), sequence: seq1 },
        card2: { code: code2, location: locationString(loc2), sequence: seq2 } };
    }

    case MSG_SUMMONING: case MSG_SPSUMMONING:
    case MSG_SUMMONED:  case MSG_SPSUMMONED:
    case MSG_FLIPSUMMONING: case MSG_FLIPSUMMONED: {
      const code = v.getUint32(off, true); off += 4;
      const ctrl = v.getUint8(off++);
      const loc = v.getUint32(off, true); off += 4;
      const seq = v.getUint8(off++);
      let pos = 0;
      if (off < len) pos = v.getUint32(off, true);
      const et = msgType;
      let eventType = 'summoned';
      if (et === MSG_SUMMONING || et === MSG_SPSUMMONING || et === MSG_FLIPSUMMONING) eventType = 'summoning';
      return { type: 'event', eventType, code, controller: ctrl,
        location: locationString(loc), sequence: seq, position: pos };
    }

    case MSG_CHAINING: {
      const code = v.getUint32(off, true); off += 4;
      const ctrl = v.getUint8(off++);
      const loc = v.getUint32(off, true); off += 4;
      const seq = v.getUint8(off++);
      const subLoc = v.getUint32(off, true); off += 4;
      const subSeq = v.getUint8(off++);
      const desc = v.getUint32(off, true); off += 4;
      const chain = v.getUint8(off++);
      return { type: 'event', eventType: 'chaining', code, controller: ctrl,
        location: locationString(loc), sequence: seq,
        sublocation: locationString(subLoc), subSequence: subSeq,
        description: desc, chain };
    }
    case MSG_CHAINED: { const chain = v.getUint8(off); return { type: 'event', eventType: 'chained', chain }; }
    case MSG_CHAIN_SOLVING: { const chain = v.getUint8(off); return { type: 'event', eventType: 'chain_solving', chain }; }
    case MSG_CHAIN_SOLVED: { const chain = v.getUint8(off); return { type: 'event', eventType: 'chain_solved', chain }; }
    case MSG_CHAIN_END: return { type: 'event', eventType: 'chain_end' };

    case MSG_DRAW: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const codes = [];
      for (let i = 0; i < count; i++) {
        codes.push(v.getUint32(off, true)); off += 4;
      }
      return { type: 'event', eventType: 'draw', player, count, codes };
    }

    case MSG_DAMAGE: case MSG_RECOVER: {
      const player = v.getUint8(off++);
      const amount = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: msgType === MSG_DAMAGE ? 'damage' : 'recover', player, amount };
    }

    case MSG_LPUPDATE: {
      const player = v.getUint8(off++);
      const lp = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: 'lp_update', player, lp };
    }

    case MSG_ATTACK: {
      const attCtrl = v.getUint8(off++);
      const attLoc = v.getUint32(off, true); off += 4;
      const attSeq = v.getUint8(off++);
      const defCtrl = v.getUint8(off++);
      const defLoc = v.getUint32(off, true); off += 4;
      const defSeq = v.getUint8(off++);
      return { type: 'event', eventType: 'attack',
        attacker: { controller: attCtrl, location: locationString(attLoc), sequence: attSeq },
        defender: { controller: defCtrl, location: locationString(defLoc), sequence: defSeq },
      };
    }

    case MSG_BATTLE: {
      const attCtrl = v.getUint8(off++);
      const attLoc = v.getUint32(off, true); off += 4;
      const attSeq = v.getUint8(off++);
      const attAtk = v.getUint32(off, true); off += 4;
      const attDef = v.getUint32(off, true); off += 4;
      const attFlags = v.getUint8(off++);
      const defCtrl = v.getUint8(off++);
      const defLoc = v.getUint32(off, true); off += 4;
      const defSeq = v.getUint8(off++);
      const defAtk = v.getUint32(off, true); off += 4;
      const defDef = v.getUint32(off, true); off += 4;
      const defFlags = v.getUint8(off++);
      return { type: 'event', eventType: 'battle',
        attacker: { controller: attCtrl, location: locationString(attLoc), sequence: attSeq, atk: attAtk, def: attDef, flags: attFlags },
        defender: { controller: defCtrl, location: locationString(defLoc), sequence: defSeq, atk: defAtk, def: defDef, flags: defFlags },
      };
    }

    case MSG_DAMAGE_STEP_START: return { type: 'event', eventType: 'damage_step_start' };
    case MSG_DAMAGE_STEP_END: return { type: 'event', eventType: 'damage_step_end' };

    case MSG_SHUFFLE_DECK: { const player = v.getUint8(off); return { type: 'event', eventType: 'shuffle_deck', player }; }
    case MSG_SHUFFLE_HAND: { const player = v.getUint8(off); return { type: 'event', eventType: 'shuffle_hand', player }; }
    case MSG_SHUFFLE_EXTRA: { const player = v.getUint8(off); return { type: 'event', eventType: 'shuffle_extra', player }; }
    case MSG_SHUFFLE_SET_CARD: {
      const loc = v.getUint8(off++);
      const count = v.getUint8(off++);
      return { type: 'event', eventType: 'shuffle_set', location: locationString(loc), count };
    }

    case MSG_TOSS_COIN: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const results = [];
      for (let i = 0; i < count; i++) results.push(v.getUint8(off++));
      return { type: 'event', eventType: 'toss_coin', player, results };
    }
    case MSG_TOSS_DICE: {
      const player = v.getUint8(off++);
      const count = v.getUint8(off++);
      const results = [];
      for (let i = 0; i < count; i++) results.push(v.getUint8(off++));
      return { type: 'event', eventType: 'toss_dice', player, results };
    }

    case MSG_CARD_HINT: {
      const ctrl = v.getUint8(off++);
      const loc = v.getUint32(off, true); off += 4;
      const seq = v.getUint8(off++);
      const hintType = v.getUint8(off++);
      const data = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: 'card_hint', controller: ctrl, location: locationString(loc), sequence: seq, hintType, data };
    }

    case MSG_TAG_SWAP: {
      const player = v.getUint8(off++);
      const mainCount = v.getUint8(off++);
      const mainCodes = [];
      for (let i = 0; i < mainCount; i++) mainCodes.push(v.getUint32(off, true)); off += mainCount * 4;
      const extraCount = v.getUint8(off++);
      const extraCodes = [];
      for (let i = 0; i < extraCount; i++) extraCodes.push(v.getUint32(off, true)); off += extraCount * 4;
      return { type: 'event', eventType: 'tag_swap', player, main: mainCodes, extra: extraCodes };
    }

    case MSG_FIELD_DISABLED: {
      const player = v.getUint8(off++);
      const disabled = v.getUint32(off, true); off += 4;
      return { type: 'event', eventType: 'field_disabled', player, disabled };
    }

    case MSG_RELOAD_FIELD: {
      const flags = v.getUint32(off, true); off += 4;
      const player0lp = v.getUint32(off, true); off += 4;
      const player1lp = v.getUint32(off, true); off += 4;

      const parseCards = () => {
        const count = v.getUint8(off++);
        const cards = [];
        for (let i = 0; i < count; i++) {
          const code = v.getUint32(off, true); off += 4;
          const pos = v.getUint8(off++);
          cards.push({ code, position: pos });
        }
        return cards;
      };

      const totalMain0 = v.getUint8(off++); // deck + hand + grave + removed + extra
      const handCount0 = v.getUint8(off++);
      const mzone0 = parseCards();
      const szone0 = parseCards();
      const grave0 = parseCards();
      const banished0 = parseCards();
      const extraCount0 = v.getUint8(off++);
      const extraPendulumCount0 = v.getUint8(off++);
      const deckCount0 = v.getUint8(off++);

      const totalMain1 = v.getUint8(off++);
      const handCount1 = v.getUint8(off++);
      const mzone1 = parseCards();
      const szone1 = parseCards();
      const grave1 = parseCards();
      const banished1 = parseCards();
      const extraCount1 = v.getUint8(off++);
      const extraPendulumCount1 = v.getUint8(off++);
      const deckCount1 = v.getUint8(off++);

      return {
        type: 'event', eventType: 'reload_field',
        player0: { lp: player0lp, hand: handCount0, deck: deckCount0, mzone: mzone0, szone: szone0, grave: grave0, banished: banished0, extra: extraCount0, extraPendulum: extraPendulumCount0 },
        player1: { lp: player1lp, hand: handCount1, deck: deckCount1, mzone: mzone1, szone: szone1, grave: grave1, banished: banished1, extra: extraCount1, extraPendulum: extraPendulumCount1 },
      };
    }

    default:
      return { type: 'unknown', msgType };
  }
}

function locationString(loc) {
  const parts = [];
  if (loc & LOCATION_DECK) parts.push('deck');
  if (loc & LOCATION_HAND) parts.push('hand');
  if (loc & LOCATION_MZONE) parts.push('mzone');
  if (loc & LOCATION_SZONE) parts.push('szone');
  if (loc & LOCATION_GRAVE) parts.push('grave');
  if (loc & LOCATION_REMOVED) parts.push('removed');
  if (loc & LOCATION_EXTRA) parts.push('extra');
  if (loc & LOCATION_OVERLAY) parts.push('overlay');
  if (loc & LOCATION_FZONE) parts.push('fzone');
  if (loc & LOCATION_PZONE) parts.push('pzone');
  return parts.join('|') || 'unknown';
}

function phaseString(phase) {
  const names = { 0x01:'draw', 0x02:'standby', 0x04:'main1', 0x08:'battle_start',
    0x10:'battle_step', 0x20:'damage', 0x40:'damage_calc', 0x80:'battle',
    0x100:'main2', 0x200:'end' };
  return names[phase] || 'unknown';
}
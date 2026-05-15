/**
 * Protocol Relay — translates ygopro binary messages ↔ browser-friendly JSON.
 *
 * S→C (duel → browser): parse binary messages into JSON state updates
 * C→S (browser → duel): build binary responses from JSON player choices
 */

import {
  YGOProMessages,
  YGOProCtosResponse,
  YGOProMsgMove,
  YGOProMsgDraw,
  YGOProMsgDamage,
  YGOProMsgRecover,
  YGOProMsgLpUpdate,
  YGOProMsgNewTurn,
  YGOProMsgNewPhase,
  YGOProMsgShuffleDeck,
  YGOProMsgShuffleHand,
  YGOProMsgShuffleExtra,
  YGOProMsgShuffleSetCard,
  YGOProMsgSwap,
  YGOProMsgFieldDisabled,
  YGOProMsgSummoning,
  YGOProMsgSummoned,
  YGOProMsgSpSummoning,
  YGOProMsgSpSummoned,
  YGOProMsgFlipSummoning,
  YGOProMsgFlipSummoned,
  YGOProMsgSet,
  YGOProMsgPosChange,
  YGOProMsgChaining,
  YGOProMsgChained,
  YGOProMsgChainSolving,
  YGOProMsgChainSolved,
  YGOProMsgChainEnd,
  YGOProMsgChainNegated,
  YGOProMsgChainDisabled,
  YGOProMsgCardHint,
  YGOProMsgSelectIdleCmd,
  YGOProMsgSelectBattleCmd,
  YGOProMsgSelectEffectYn,
  YGOProMsgSelectYesNo,
  YGOProMsgSelectOption,
  YGOProMsgSelectCard,
  YGOProMsgSelectChain,
  YGOProMsgSelectPlace,
  YGOProMsgSelectPosition,
  YGOProMsgSelectTribute,
  YGOProMsgSelectCounter,
  YGOProMsgSelectSum,
  YGOProMsgAttack,
  YGOProMsgBattle,
  YGOProMsgBecomeTarget,
  YGOProMsgCancelTarget,
  YGOProMsgAnnounceCard,
  YGOProMsgAnnounceRace,
  YGOProMsgAnnounceAttrib,
  YGOProMsgAnnounceNumber,
  YGOProMsgEquip,
  YGOProMsgUnequip,
  YGOProMsgCardTarget,
  YGOProMsgAddCounter,
  YGOProMsgRemoveCounter,
  YGOProMsgSortCard,
  YGOProMsgTagSwap,
  YGOProMsgConfirmCards,
  YGOProMsgConfirmDeckTop,
  YGOProMsgRockPaperScissors,
  YGOProMsgStart,
  YGOProMsgUpdateData,
  YGOProMsgUpdateCard,
  YGOProMsgWaiting,
  YGOProMsgWin,
  YGOProMsgMissedEffect,
  YGOProMsgResetTime,
} from 'ygopro-msg-encode';

// ── S→C: Binary buffer → JSON ──────────────────

/**
 * Parse a raw ocgcore message buffer into a JSON object for the browser.
 * Returns null if the message type is not yet handled.
 */
export function parseGameMessage(rawBase64) {
  const buffer = Buffer.from(rawBase64, 'base64');
  let msg;

  try {
    msg = YGOProMessages.getInstanceFromPayload(buffer);
  } catch (e) {
    return { type: 'unknown', data: { raw: rawBase64, error: e.message } };
  }

  if (!msg) return null;

  return dispatchMessage(msg);
}

function dispatchMessage(msg) {
  const handlers = {
    YGOProMsgMove:              parseMove,
    YGOProMsgDraw:              parseDraw,
    YGOProMsgDamage:            parseDamage,
    YGOProMsgRecover:           parseRecover,
    YGOProMsgLpUpdate:          parseLpUpdate,
    YGOProMsgShuffleDeck:       parseSimple,
    YGOProMsgShuffleHand:       parseSimple,
    YGOProMsgShuffleExtra:      parseSimple,
    YGOProMsgShuffleSetCard:    parseShuffleSet,
    YGOProMsgSwap:              parseSwap,
    YGOProMsgSummoning:         parseSummoning,
    YGOProMsgSummoned:          parseSimple,
    YGOProMsgSpSummoning:       parseSummoning,
    YGOProMsgSpSummoned:        parseSimple,
    YGOProMsgFlipSummoning:     parseSummoning,
    YGOProMsgFlipSummoned:      parseSimple,
    YGOProMsgSet:               parseSet,
    YGOProMsgPosChange:         parsePosChange,
    YGOProMsgChaining:          parseChaining,
    YGOProMsgChained:           parseSimple,
    YGOProMsgChainSolving:      parseSimple,
    YGOProMsgChainSolved:       parseSimple,
    YGOProMsgChainEnd:          parseSimple,
    YGOProMsgChainNegated:      parseSimple,
    YGOProMsgChainDisabled:     parseSimple,
    YGOProMsgCardHint:          parseCardHint,
    YGOProMsgAttack:            parseAttack,
    YGOProMsgBattle:            parseBattle,
    YGOProMsgBecomeTarget:      parseSimple,
    YGOProMsgCancelTarget:      parseSimple,
    YGOProMsgEquip:             parseEquip,
    YGOProMsgUnequip:           parseEquip,
    YGOProMsgCardTarget:        parseCardTarget,
    YGOProMsgAddCounter:        parseCounter,
    YGOProMsgRemoveCounter:     parseCounter,
    YGOProMsgRemoveCounter:     parseCounter,
    YGOProMsgSortCard:          parseSimple,
    YGOProMsgTagSwap:           parseTagSwap,
    YGOProMsgMissedEffect:      parseSimple,
    YGOProMsgResetTime:         parseResetTime,
  };

  const name = msg.constructor.name;
  const handler = handlers[name];

  if (handler) {
    return handler(msg, name);
  }

  // Unhandled message — send raw to debug
  return {
    type: msg.constructor.name,
    data: { raw: Buffer.from(msg.toPayload()).toString('base64') },
  };
}

// ── Individual message parsers ─────────────────

function parseSimple(msg, name) {
  return { type: name, data: convertPojo(msg) };
}

function parseMove(msg) {
  return {
    type: 'move',
    data: {
      code: msg.code,
      from: cardLocation(msg.from),
      to: cardLocation(msg.to),
      position: msg.position,
      reason: msg.reason,
    },
  };
}

function parseDraw(msg) {
  return {
    type: 'draw',
    data: {
      player: msg.player,
      cards: (msg.cards || []).map(c => ({ code: c.code, position: c.position })),
    },
  };
}

function parseDamage(msg) {
  return { type: 'damage', data: { player: msg.player, amount: msg.amount } };
}

function parseRecover(msg) {
  return { type: 'recover', data: { player: msg.player, amount: msg.amount } };
}

function parseLpUpdate(msg) {
  return { type: 'lpUpdate', data: { player: msg.player, lp: msg.lp } };
}

function parseShuffleSet(msg) {
  return { type: 'shuffleSetCard', data: { player: msg.player, location: msg.location, count: msg.count } };
}

function parseSwap(msg) {
  return { type: 'swap', data: { code: msg.code, from: cardLocation(msg.from), to: cardLocation(msg.to) } };
}

function parseSummoning(msg) {
  return { type: msg.constructor.name, data: { code: msg.code, location: cardLocation(msg.location) } };
}

function parseSet(msg) {
  return { type: 'set', data: { code: msg.code, location: cardLocation(msg.location) } };
}

function parsePosChange(msg) {
  return {
    type: 'posChange',
    data: {
      code: msg.code,
      location: cardLocation(msg.location),
      prevPos: msg.previous_position,
      curPos: msg.current_position,
    },
  };
}

function parseChaining(msg) {
  return {
    type: 'chaining',
    data: {
      code: msg.code,
      location: cardLocation(msg.location),
      controller: msg.controler || msg.controller,
      chainCount: msg.chain_count,
    },
  };
}

function parseCardHint(msg) {
  return {
    type: 'cardHint',
    data: {
      code: msg.code,
      location: cardLocation(msg.location),
      hintType: msg.type,
      hintValue: msg.value,
    },
  };
}

function parseAttack(msg) {
  return {
    type: 'attack',
    data: {
      atkCard: cardLocation(msg.atk_location),
      defCard: msg.def_location ? cardLocation(msg.def_location) : null,
    },
  };
}

function parseBattle(msg) {
  return {
    type: 'battle',
    data: {
      atkCard: cardLocation(msg.atk_location),
      defCard: cardLocation(msg.def_location),
      atkDamage: msg.atk_damage?.damage,
      defDamage: msg.def_damage?.damage,
    },
  };
}

function parseEquip(msg) {
  return {
    type: msg.constructor.name,
    data: {
      equipCard: cardLocation(msg.equip_card),
      targetCard: cardLocation(msg.target_card),
    },
  };
}

function parseCardTarget(msg) {
  return {
    type: 'cardTarget',
    data: {
      card: cardLocation(msg.card),
      targets: (msg.targets || []).map(t => cardLocation(t)),
    },
  };
}

function parseCounter(msg) {
  return {
    type: msg.constructor.name,
    data: {
      location: cardLocation(msg.location),
      counterType: msg.counter_type,
      count: msg.count,
    },
  };
}

function parseTagSwap(msg) {
  return {
    type: 'tagSwap',
    data: {
      player: msg.player,
      mainDeckCount: msg.main_deck_count,
      extraDeckCount: msg.extra_deck_count,
      extraDeckCards: (msg.extra_deck_cards || []).map(c => ({ code: c.code, location: cardLocation(c.location) })),
      mainDeckCards: (msg.main_deck_cards || []).map(c => ({ code: c.code, location: cardLocation(c.location) })),
      handCards: (msg.hand_cards || []).map(c => ({ code: c.code, location: cardLocation(c.location) })),
    },
  };
}

function parseResetTime(msg) {
  return { type: 'resetTime', data: { player: msg.player, time: msg.time } };
}

// ── SELECT message parsers ─────────────────────

/**
 * Parse a select message for the browser.
 * Returns a structured JSON object that the frontend can render as a UI selector.
 */
export function parseSelectMessage(rawBase64) {
  const buffer = Buffer.from(rawBase64, 'base64');
  let msg;
  try {
    msg = YGOProMessages.getInstanceFromPayload(buffer);
  } catch (e) {
    return { type: 'error', data: { message: e.message } };
  }

  if (!msg) return { type: 'error', data: { message: 'Empty message' } };

  const name = msg.constructor.name;

  if (msg instanceof YGOProMsgSelectIdleCmd) {
    return parseSelectIdleCmd(msg);
  }
  if (msg instanceof YGOProMsgSelectBattleCmd) {
    return parseSelectBattleCmd(msg);
  }
  if (msg instanceof YGOProMsgSelectEffectYn) {
    return parseSelectEffectYn(msg);
  }
  if (msg instanceof YGOProMsgSelectYesNo) {
    return parseSelectYesNo(msg);
  }
  if (msg instanceof YGOProMsgSelectOption) {
    return parseSelectOption(msg);
  }
  if (msg instanceof YGOProMsgSelectCard) {
    return parseSelectCard(msg);
  }
  if (msg instanceof YGOProMsgSelectChain) {
    return parseSelectChain(msg);
  }
  if (msg instanceof YGOProMsgSelectPlace) {
    return parseSelectPlace(msg);
  }
  if (msg instanceof YGOProMsgSelectPosition) {
    return parseSelectPosition(msg);
  }
  if (msg instanceof YGOProMsgSelectTribute) {
    return parseSelectTribute(msg);
  }
  if (msg instanceof YGOProMsgSelectCounter) {
    return parseSelectCounter(msg);
  }
  if (msg instanceof YGOProMsgSelectSum) {
    return parseSelectSum(msg);
  }
  if (msg instanceof YGOProMsgAnnounceCard) {
    return parseAnnounceCard(msg);
  }
  if (msg instanceof YGOProMsgAnnounceRace) {
    return parseAnnounceRace(msg);
  }
  if (msg instanceof YGOProMsgAnnounceAttrib) {
    return parseAnnounceAttrib(msg);
  }
  if (msg instanceof YGOProMsgAnnounceNumber) {
    return parseAnnounceNumber(msg);
  }

  // Fallback: send raw + metadata
  return {
    type: name,
    data: {
      raw: rawBase64,
      responsePlayer: msg.responsePlayer ? msg.responsePlayer() : null,
    },
  };
}

function parseSelectIdleCmd(msg) {
  return {
    type: 'selectIdleCmd',
    data: {
      summonable: (msg.summonable || []).map(cardLoc),
      spsummon: (msg.spsummon || []).map(cardLoc),
      repos: (msg.repos || []).map(cardLoc),
      mset: (msg.mset || []).map(cardLoc),
      sset: (msg.sset || []).map(cardLoc),
      activatable: (msg.activatable || []).map(cardLoc),
      chains: (msg.chains || []).map(cardLoc),
      bp: msg.bp || false,
      ep: msg.ep || false,
      // Phase-related
      toBp: msg.to_bp || false,
      toEp: msg.to_ep || false,
      toMp: msg.to_mp || false,
      // Raw for response construction
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectBattleCmd(msg) {
  return {
    type: 'selectBattleCmd',
    data: {
      attackable: (msg.attackable || []).map(cardLoc),
      activatable: (msg.activatable || []).map(cardLoc),
      chains: (msg.chains || []).map(cardLoc),
      toM2: msg.to_m2 || false,
      toEp: msg.to_ep || false,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectEffectYn(msg) {
  return {
    type: 'selectEffectYn',
    data: {
      code: msg.code,
      location: cardLocation(msg.location),
      description: msg.description,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectYesNo(msg) {
  return {
    type: 'selectYesNo',
    data: {
      description: msg.description,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectOption(msg) {
  return {
    type: 'selectOption',
    data: {
      options: msg.options || [],
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectCard(msg) {
  return {
    type: 'selectCard',
    data: {
      cards: (msg.cards || []).map(c => ({
        code: c.code,
        location: cardLocation(c.location),
      })),
      min: msg.min,
      max: msg.max,
      cancelable: msg.cancelable,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectChain(msg) {
  return {
    type: 'selectChain',
    data: {
      chains: (msg.chains || []).map(c => ({
        code: c.code,
        location: cardLocation(c.location),
        description: c.description,
      })),
      speCount: msg.spe_count,
      forced: msg.forced,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectPlace(msg) {
  return {
    type: 'selectPlace',
    data: {
      code: msg.code,
      count: msg.count,
      placable: (msg.placable || []),
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectPosition(msg) {
  return {
    type: 'selectPosition',
    data: {
      code: msg.code,
      position: msg.position,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectTribute(msg) {
  return {
    type: 'selectTribute',
    data: {
      cards: (msg.cards || []).map(c => ({
        code: c.code,
        location: cardLocation(c.location),
      })),
      min: msg.min,
      max: msg.max,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectCounter(msg) {
  return {
    type: 'selectCounter',
    data: {
      cards: (msg.cards || []).map(c => ({
        code: c.code,
        location: cardLocation(c.location),
        counterType: c.counter_type,
        count: c.count,
      })),
      count: msg.count,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseSelectSum(msg) {
  return {
    type: 'selectSum',
    data: {
      cards: (msg.cards || []).map(c => ({
        code: c.code,
        location: cardLocation(c.location),
        value: c.value,
      })),
      sum: msg.sum,
      min: msg.min,
      max: msg.max,
      selectMode: msg.select_mode,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseAnnounceCard(msg) {
  return {
    type: 'announceCard',
    data: {
      count: msg.count,
      declareType: msg.declare_type,
      opcodes: msg.opcodes,
      raw: Buffer.from(msg.toPayload()).toString('base64'),
    },
  };
}

function parseAnnounceRace(msg) {
  return {
    type: 'announceRace',
    data: { count: msg.count, available: msg.available, raw: Buffer.from(msg.toPayload()).toString('base64') },
  };
}

function parseAnnounceAttrib(msg) {
  return {
    type: 'announceAttrib',
    data: { count: msg.count, available: msg.available, raw: Buffer.from(msg.toPayload()).toString('base64') },
  };
}

function parseAnnounceNumber(msg) {
  return {
    type: 'announceNumber',
    data: { count: msg.count, raw: Buffer.from(msg.toPayload()).toString('base64') },
  };
}

// ── Response helpers ───────────────────────────

export function buildResponse(type, data) {
  // For most responses, we use YGOProCtosResponse with the raw binary data
  const response = new YGOProCtosResponse();
  
  // data.raw contains the original select message's raw buffer (for reference)
  // data.response should contain the actual response bytes
  if (data.response) {
    response.response = Buffer.from(data.response, 'base64');
  } else if (data.value !== undefined) {
    // Simple integer response
    response.response = Buffer.from([data.value]);
  }
  
  return Buffer.from(response.toPayload());
}

/**
 * Build a specific ocgcore setResponse from a browser message.
 * The frontend sends JSON like:
 *   { type: 'selectIdleCmd', action: 'summon', card: { controller, location, sequence } }
 *   { type: 'selectCard', selectedIndices: [0, 2], action: 'ok' }
 *   { type: 'selectYesNo', value: true }
 *   { type: 'selectOption', index: 2 }
 *   { type: 'selectChain', index: 1 }
 *
 * Returns a Buffer suitable for duel.setResponse().
 */
export function buildSetResponse(selectType, data) {
  switch (selectType) {
    case 'selectEffectYn':
    case 'selectYesNo': {
      const val = data.value === true || data.value === 1 ? 1 : 0;
      return val; // Return number for setResponseInt
    }
    case 'selectOption': {
      return data.index || 0; // setResponseInt
    }
    case 'selectPosition': {
      return data.position || 0; // setResponseInt
    }
    case 'announceNumber': {
      return data.number || 0; // setResponseInt
    }
    case 'selectIdleCmd': {
      // Build idle command response
      const buf = Buffer.alloc(6);
      buf.writeUInt16LE(data.action || 0, 0);    // action type (summon=0, spsummon=1, etc.)
      buf.writeUInt8(data.zone?.controller || 0, 2);
      buf.writeUInt8(data.zone?.location || 0, 3);
      buf.writeUInt8(data.zone?.sequence || 0, 4);
      buf.writeUInt8(data.position || 0, 5);
      return buf;
    }
    case 'selectBattleCmd': {
      const buf = Buffer.alloc(6);
      buf.writeUInt16LE(data.action || 0, 0);
      buf.writeUInt8(data.zone?.controller || 0, 2);
      buf.writeUInt8(data.zone?.location || 0, 3);
      buf.writeUInt8(data.zone?.sequence || 0, 4);
      buf.writeUInt8(0, 5);
      return buf;
    }
    case 'selectCard':
    case 'selectTribute':
    case 'selectSum': {
      // Build card selection response
      const indices = data.selectedIndices || [];
      const buf = Buffer.alloc(1 + indices.length);
      buf.writeUInt8(indices.length, 0);
      indices.forEach((idx, i) => buf.writeUInt8(idx, 1 + i));
      return buf;
    }
    case 'selectChain': {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(data.index || 0, 0);
      return buf;
    }
    case 'selectPlace': {
      // Build place selection response
      const buf = Buffer.alloc(2);
      buf.writeUInt8(data.zone?.sequence || 0, 0);
      buf.writeUInt8(data.zone?.location === 5 ? 1 : data.position || 0, 1);
      return buf;
    }
    case 'selectCounter': {
      const buf = Buffer.alloc(2);
      buf.writeUInt16LE(data.count || 0, 0);
      return buf;
    }
    case 'announceRace': {
      return data.race || 0;
    }
    case 'announceAttrib': {
      return data.attribute || 0;
    }
    case 'announceCard': {
      return data.code || 0;
    }
    default:
      // Fallback: pass raw response
      if (data.raw) {
        return Buffer.from(data.raw, 'base64');
      }
      return 0;
  }
}

// ── Utility ────────────────────────────────────

function cardLocation(loc) {
  if (!loc) return null;
  return {
    controller: loc.controler ?? loc.controller ?? 0,
    location: loc.location,
    sequence: loc.sequence,
    position: loc.position,
    overlaySequence: loc.overlay_sequence,
  };
}

function cardLoc(loc) {
  if (!loc) return null;
  return {
    controller: loc.controler ?? loc.controller ?? 0,
    location: loc.location,
    sequence: loc.sequence,
    code: loc.code,
    position: loc.position,
    description: loc.description,
    level: loc.level,
    rank: loc.rank,
    attack: loc.attack,
    defense: loc.defense,
    linkValue: loc.link_value,
    linkMarker: loc.link_marker,
    race: loc.race,
    attribute: loc.attribute,
  };
}

function convertPojo(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertPojo);
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = convertPojo(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(convertPojo);
    } else {
      result[key] = value;
    }
  }
  return result;
}
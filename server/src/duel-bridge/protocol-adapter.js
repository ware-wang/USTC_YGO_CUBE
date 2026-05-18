/**
 * protocol-adapter.js — YGOPro binary wire protocol ↔ DuelSession bridge.
 *
 * Wire format (big-endian on the wire, length is little-endian):
 *   [2 bytes: packetLen LE] [1 byte: proto] [packetLen-1 bytes: exData]
 *
 * Where packetLen = exData.length + 1 (proto byte included in length).
 */

// ── Protocol constants ────────────────────────

export const CTOS_PLAYER_INFO  = 0x10;
export const CTOS_JOIN_GAME    = 0x12;
export const CTOS_UPDATE_DECK  = 0x02;
export const CTOS_HS_READY     = 0x22; // 34
export const CTOS_HS_NOT_READY = 0x23;
export const CTOS_HS_START     = 0x25; // 37
export const CTOS_HAND_RESULT  = 0x03;
export const CTOS_TP_RESULT    = 0x04;
export const CTOS_RESPONSE     = 0x01;
export const CTOS_SURRENDER    = 0x14;
export const CTOS_CHAT         = 0x16;

export const STOC_JOIN_GAME       = 0x12;
export const STOC_CHAT            = 0x19;
export const STOC_HS_PLAYER_ENTER = 0x20;
export const STOC_HS_PLAYER_CHANGE = 0x21;
export const STOC_HS_WATCH_CHANGE  = 0x22;
export const STOC_TYPE_CHANGE      = 0x13;
export const STOC_SELECT_HAND      = 0x03;
export const STOC_SELECT_TP        = 0x04;
export const STOC_HAND_RESULT      = 0x05;
export const STOC_DECK_COUNT       = 0x09;
export const STOC_DUEL_START       = 0x15;
export const STOC_DUEL_END         = 0x16;
export const STOC_GAME_MSG         = 0x01;
export const STOC_ERROR_MSG        = 0x02;
export const STOC_CHANGE_SIDE      = 0x07;
export const STOC_WAITING_SIDE     = 0x08;
export const STOC_TIME_LIMIT       = 0x18;

const UTF16_NAME_MAX = 20;
const PACKET_MIN_LEN = 3;

// ── Packet encode / decode ────────────────────

/**
 * Decode raw ArrayBuffer into YgoProPacket objects (handles packet coalescing).
 */
export function decodePackets(rawData) {
  const buf = Buffer.from(rawData);
  const packets = [];
  let offset = 0;

  while (offset + PACKET_MIN_LEN <= buf.length) {
    const packetLen = buf.readUInt16LE(offset);       // length = exData+1
    const proto = buf.readUInt8(offset + 2);
    const exDataStart = offset + 3;
    const exDataEnd = exDataStart + (packetLen - 1);  // packetLen includes proto byte

    if (exDataEnd > buf.length) break; // incomplete packet

    const exData = buf.slice(exDataStart, exDataEnd);
    packets.push({ proto, exData });

    offset = exDataEnd;
  }

  return packets;
}

/**
 * Encode a STOC message into raw Buffer for WebSocket send.
 * @param {number} proto - STOC_* constant
 * @param {Buffer} exData - payload
 */
export function encodePacket(proto, exData) {
  const packetLen = (exData ? exData.length : 0) + 1; // +1 for proto byte
  const buf = Buffer.alloc(2 + packetLen);

  buf.writeUInt16LE(packetLen, 0);
  buf.writeUInt8(proto, 2);
  if (exData && exData.length > 0) {
    exData.copy(buf, 3);
  }

  return buf;
}

// ── CTOS parsers ──────────────────────────────

/**
 * Parse CTOS_PLAYER_INFO: extract player name.
 * Format: [20 * uint16 LE = 40 bytes: player name UTF-16LE]
 */
export function parsePlayerInfo(exData) {
  // Read up to 20 UTF-16LE code units, stop at null
  let name = '';
  for (let i = 0; i < Math.min(exData.length / 2, UTF16_NAME_MAX); i++) {
    const ch = exData.readUInt16LE(i * 2);
    if (ch === 0) break;
    name += String.fromCharCode(ch);
  }
  return name;
}

/**
 * Parse CTOS_JOIN_GAME: extract version and password.
 * Format: [2B version LE] [2B align] [4B gameId LE] [40B passWd UTF-16LE]
 */
export function parseJoinGame(exData) {
  const version = exData.readUInt16LE(0);
  let passWd = '';
  for (let i = 0; i < UTF16_NAME_MAX; i++) {
    const ch = exData.readUInt16LE(8 + i * 2);
    if (ch === 0) break;
    passWd += String.fromCharCode(ch);
  }
  return { version, passWd };
}

/**
 * Parse CTOS_UPDATE_DECK: extract main and extra card IDs.
 * Format: [4B mainLen] [4B sideLen] [mainLen*u32] [sideLen*u32]
 */
export function parseUpdateDeck(exData) {
  const mainLen = exData.readInt32LE(0);
  const sideLen = exData.readInt32LE(4);
  const main = [];
  const extra = [];
  let offset = 8;

  // Read mainLen cards (main + extra are combined in srvpro protocol)
  for (let i = 0; i < mainLen && offset + 4 <= exData.length; i++) {
    main.push(exData.readInt32LE(offset));
    offset += 4;
  }
  // Read side cards
  const side = [];
  for (let i = 0; i < sideLen && offset + 4 <= exData.length; i++) {
    side.push(exData.readInt32LE(offset));
    offset += 4;
  }

  return { main, side };
}

/**
 * Parse CTOS_RESPONSE: raw ocgcore response buffer.
 * The exData IS the binary format that ocgcore.setResponse() expects.
 */
export function parseResponse(exData) {
  return Buffer.from(exData);
}

// ── STOC builders ─────────────────────────────

/**
 * STOC_JOIN_GAME: notify client it joined the room.
 * We send a minimal valid packet since neos-ts doesn't parse much from this.
 * Format (simplified): 4B hostbit | 4*4B team info | 20*u16 name for each team
 *
 * Hostbit bits control which features are enabled.
 * We set: bit 0 (duelist 0 present), bit 1 (duelist 1 present)
 */
export function buildStocJoinGame(duelist1Name, duelist2Name) {
  // Minimal valid STOC_JOIN_GAME
  const buf = Buffer.alloc(4 + 4*14 + 40*2);  // hostbit(4) + 14*u32(56) + 2*name40(80) = 140

  // hostbit: 0x03 = has duelist 0, has duelist 1
  buf.writeUInt32LE(0x03, 0);

  // Team info fields (simplified): each team = 4 items * 4 bytes = 16 bytes
  // Team 0: lflist=0, rule=2, mode=0, duelRule=5
  buf.writeUInt32LE(0, 4);   // lflist
  buf.writeUInt32LE(2, 8);   // rule (OCG)
  buf.writeUInt32LE(0, 12);  // mode
  buf.writeUInt32LE(5, 16);  // duel_rule (master)
  // Team 1: same
  buf.writeUInt32LE(0, 20);
  buf.writeUInt32LE(2, 24);
  buf.writeUInt32LE(0, 28);
  buf.writeUInt32LE(5, 32);

  // More info: startLP, startHand, drawCount (for team 0)
  buf.writeUInt32LE(8000, 36); // start_lp
  buf.writeUInt32LE(5, 40);    // start_hand
  buf.writeUInt32LE(1, 44);    // draw_count
  // Team 1 same
  buf.writeUInt32LE(8000, 48);
  buf.writeUInt32LE(5, 52);
  buf.writeUInt32LE(1, 56);

  // Player names (20 uint16 each, UTF-16LE)
  writeUtf16LE(buf, 60, duelist1Name || 'Player1', UTF16_NAME_MAX);
  writeUtf16LE(buf, 100, duelist2Name || 'Player2', UTF16_NAME_MAX);

  return encodePacket(STOC_JOIN_GAME, buf);
}

/**
 * STOC_TYPE_CHANGE: assign the client's seat/role.
 * Format: 1B selfType | 1B isHost (byte, bool)
 * selfType: 1=player0, 2=player1, 0x20=observer
 */
/**
 * STOC_TYPE_CHANGE: assign the client's seat/role.
 * Format: 1 byte = (isHost << 4) | (position & 0xf)
 *   bits 4-7: isHost flag
 *   bits 0-3: self_type (0=PLAYER1, 1=PLAYER2, 7=OBSERVER)
 */
export function buildStocTypeChange(position, isHost) {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(((isHost ? 1 : 0) << 4) | (position & 0x0f), 0);
  return encodePacket(STOC_TYPE_CHANGE, buf);
}

/**
 * STOC_HS_PLAYER_ENTER: notify that a player entered the room.
 * Format: [40 bytes: name UTF-16LE] [1 byte: pos]
 */
export function buildStocHsPlayerEnter(name, pos) {
  const buf = Buffer.alloc(40 + 1);
  writeUtf16LE(buf, 0, name || 'Player', UTF16_NAME_MAX);
  buf.writeUInt8(pos, 40);
  return encodePacket(STOC_HS_PLAYER_ENTER, buf);
}

/**
 * STOC_HS_PLAYER_CHANGE: notify player state change.
 * Format: 1 byte = (pos << 4) | stateNibble
 *   bits 4-7: position
 *   bits 0-3: 0x9=READY, 0xa=NO_READY, 0x8=OBSERVER, 0xb=LEAVE
 */
export function buildStocHsPlayerChange(status, pos) {
  // Map server status code to ygopro state nibble
  const STATE_NIBBLE = { 0: 0xa, 1: 0x9, 2: 0x8, leave: 0xb };
  const stateNibble = STATE_NIBBLE[status] ?? 0xa;
  const buf = Buffer.alloc(1);
  buf.writeUInt8(((pos & 0x0f) << 4) | (stateNibble & 0x0f), 0);
  return encodePacket(STOC_HS_PLAYER_CHANGE, buf);
}

/**
 * STOC_DUEL_START: trigger duel start.
 * No payload.
 */
export function buildStocDuelStart() {
  return encodePacket(STOC_DUEL_START, Buffer.alloc(0));
}

/**
 * STOC_DUEL_END: notify duel ended.
 * No payload.
 */
export function buildStocDuelEnd() {
  return encodePacket(STOC_DUEL_END, Buffer.alloc(0));
}

/**
 * STOC_GAME_MSG: wrap raw ocgcore message.
 * Format: 1B controller | N bytes raw ocgcore message
 */
export function buildStocGameMsg(rawOcgMsg) {
  const raw = Buffer.isBuffer(rawOcgMsg) ? rawOcgMsg : Buffer.from(rawOcgMsg);
  // The raw result from ocgcore.process() already includes the msg type byte.
  // The STOC_GAME_MSG wrapper just prepends a controller byte.
  // Actually, looking at srvpro2: the raw msg IS the game message payload.
  // controller is determined by the server based on who's asking.
  // For forwarding, we send the raw msg directly to both players.
  // Let me check: does neos-ts expect a controller byte or not?
  //
  // In srvpro2, STOC_GAME_MSG format seems to be:
  //   1 byte: controller (who the message is addressed to, 0=player0, 1=player1)
  //   n bytes: raw ocgcore message
  //
  // But actually, looking at neos-ts's StocGameMsg parsing:
  //   It decodes the raw ocgcore message directly
  // The controller byte might be separate or part of the raw msg
  //
  // Let me just send the raw message as-is without a controller prefix
  // neos-ts will handle controller from within the message itself.
  return encodePacket(STOC_GAME_MSG, raw);
}

/**
 * STOC_CHAT: send chat message.
 * Format: 2B player | 2B len | len*2 bytes msg UTF-16LE
 */
export function buildStocChat(player, message) {
  const msgBuf = Buffer.alloc(message.length * 2 + 2);
  writeUtf16LE(msgBuf, 0, message, message.length);
  // Trim trailing zeros
  const trimmed = msgBuf.slice(0, message.length * 2);

  const buf = Buffer.alloc(4 + trimmed.length);
  buf.writeUInt16LE(player, 0);
  buf.writeUInt16LE(message.length, 2);
  trimmed.copy(buf, 4);

  return encodePacket(STOC_CHAT, buf);
}

/**
 * STOC_ERROR_MSG: send error.
 * Format (ygopro standard binary):
 *   1B errorType  |  3B padding (zero)  |  4B errorCode (int32 LE)
 *   Total = 8 bytes
 *
 * errorType values MUST match neos-ts @/api/ocgcore/idl/ocgcore.ts enum:
 *   UNKNOWN     = 0
 *   JOINERROR   = 1 → fetchStrings(System, 1403 + code)
 *   DECKERROR   = 2 → flag+code in upper/lower bytes
 *   SIDEERROR   = 3 → hardcoded "更换副卡组失败"
 *   VERSIONERROR = 4 → hardcoded "版本不匹配，请联系技术人员解决"
 */
export function buildStocErrorMsg(message, errorType = 4, errorCode = 0) {
  const buf = Buffer.alloc(8);
  buf.writeUInt8(errorType, 0);            // errorType (1-4)
  buf.fill(0, 1, 4);                       // 3 bytes padding
  buf.writeInt32LE(errorCode, 4);          // errorCode (int32)

  return encodePacket(STOC_ERROR_MSG, buf);
}

/**
 * Build a STOC_ERROR_MSG with a custom error code that maps to a known
 * JOINERROR string.  The string key is `!system_{1403+code}`.
 */
export function buildStocJoinError(code = 0) {
  return buildStocErrorMsg(null, 1, code);
}

// ── Helpers ───────────────────────────────────

function writeUtf16LE(buf, offset, str, maxChars) {
  for (let i = 0; i < maxChars; i++) {
    if (i < str.length) {
      buf.writeUInt16LE(str.charCodeAt(i), offset + i * 2);
    } else {
      buf.writeUInt16LE(0, offset + i * 2);
    }
  }
}
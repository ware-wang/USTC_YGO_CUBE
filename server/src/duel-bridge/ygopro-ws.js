/**
 * ygopro-ws.js — Binary WebSocket endpoint that speaks the YGOPro protocol.
 *
 * neos-ts connects here. Each player gets their own WebSocket connection.
 * When both players for a room are connected and ready, a DuelSession is
 * created and ocgcore messages are relayed to both clients via STOC_GAME_MSG.
 */

import { duelBridge } from './index.js';
import {
  decodePackets, encodePacket,
  CTOS_PLAYER_INFO, CTOS_JOIN_GAME, CTOS_UPDATE_DECK,
  CTOS_HS_READY, CTOS_HS_NOT_READY, CTOS_HS_START,
  CTOS_RESPONSE, CTOS_SURRENDER, CTOS_CHAT,
  STOC_JOIN_GAME, STOC_CHAT, STOC_HS_PLAYER_ENTER, STOC_HS_PLAYER_CHANGE,
  STOC_TYPE_CHANGE, STOC_DUEL_START, STOC_DUEL_END, STOC_GAME_MSG,
  STOC_ERROR_MSG,
  parsePlayerInfo, parseJoinGame, parseUpdateDeck, parseResponse, parseChatMessage,
  buildStocJoinGame, buildStocTypeChange, buildStocHsPlayerEnter,
  buildStocHsPlayerChange, buildStocDuelStart, buildStocDuelEnd,
  buildStocGameMsg, buildStocChat, buildStocErrorMsg,
} from './protocol-adapter.js';

const MSG_START = 0x04;
const MSG_UPDATE_DATA = 0x06;
const LOCATION_DECK = 0x01;
const LOCATION_HAND = 0x02;
const LOCATION_MZONE = 0x04;
const LOCATION_SZONE = 0x08;
const LOCATION_GRAVE = 0x10;
const LOCATION_REMOVED = 0x20;
const LOCATION_EXTRA = 0x40;
const POS_FACEDOWN = 0x0a;
const POS_FACEUP = 0x05;
const QUERY_CODE = 0x01;
const QUERY_POSITION = 0x02;
const WS_OPEN = 1;

// ── Room management ───────────────────────────

/** @type {Map<string, PendingRoom>} */
const pendingRooms = new Map();

/** @type {{ scriptPath: string|null, cardsCdbPath: string|null }} */
let duelOptions = { scriptPath: null, cardsCdbPath: null };

/**
 * @typedef {object} PendingPlayer
 * @property {import('ws').WebSocket|null} ws
 * @property {string} name
 * @property {boolean} ready
 * @property {{main: number[], side: number[]}|null} deck
 * @property {number|null} disconnectedAt
 */

/**
 * @typedef {object} PendingRoom
 * @property {string} passWd
 * @property {PendingPlayer[]} players
 * @property {{main: number[], extra: number[]}[]|null} preloadedDecks  // if preloaded from cube-draft
 * @property {boolean} testMode
 * @property {string|null} tableId
 * @property {string|null} draftRoomId
 * @property {Function|null} onDuelEnd
 * @property {boolean} finished
 * @property {object|null} session
 * @property {string|null} sessionId
 * @property {{main: number[], extra: number[], side: number[]}[]} clientDecks // decks from neos-ts UPDATE_DECK
 * @property {boolean} starting  // prevent concurrent startDuel calls
 */

/**
 * Get or create a pending room by password.
 */
function getOrCreateRoom(passWd) {
  let room = pendingRooms.get(passWd);
  if (!room) {
    room = {
      passWd,
      players: [],
      preloadedDecks: null,
      testMode: false,
      tableId: null,
      draftRoomId: null,
      onDuelEnd: null,
      finished: false,
      session: null,
      sessionId: null,
      clientDecks: [],
      starting: false,
    };
    pendingRooms.set(passWd, room);
  }
  return room;
}

/**
 * Register pre-loaded decks from cube-draft (called before players connect).
 */
export function registerPreloadedDecks(passWd, decks, options = {}) {
  const room = getOrCreateRoom(passWd);
  room.preloadedDecks = decks;
  room.testMode = options.testMode === true;
  room.tableId = options.tableId || room.tableId || null;
  room.draftRoomId = options.roomId || room.draftRoomId || null;
  room.onDuelEnd = typeof options.onDuelEnd === 'function' ? options.onDuelEnd : room.onDuelEnd;
  room.finished = false;
  console.log(`[ygopro-ws] Registered preloaded decks for room "${passWd}"`);
  return room;
}

// ── Player connection handler ─────────────────

/**
 * Handle a new binary WebSocket connection from neos-ts.
 * @param {import('ws').WebSocket} ws
 * @param {object} options
 * @param {string} options.scriptPath
 * @param {string} options.cardsCdbPath
 */
export function handleYgoproConnection(ws, options = {}) {
  let playerName = '';
  let playerPosition = -1;
  let currentRoom = null;

  // Store duel options from server config
  if (options.scriptPath || options.cardsCdbPath) {
    duelOptions = { ...duelOptions, ...options };
  }

  ws.binaryType = 'nodebuffer';

  ws.on('message', async (data) => {
    try {
      const packets = decodePackets(data);

      for (const { proto, exData } of packets) {
        switch (proto) {
          case CTOS_PLAYER_INFO: {
            playerName = parsePlayerInfo(exData);
            console.log(`[ygopro-ws] Player info: ${playerName}`);
            break;
          }

          case CTOS_JOIN_GAME: {
            const { passWd } = parseJoinGame(exData);
            console.log(`[ygopro-ws] ${playerName} joining room "${passWd}"`);

            currentRoom = getOrCreateRoom(passWd);

            const reconnectPosition = [0, 1].find((index) => {
              const player = currentRoom.players[index];
              return player?.name === playerName;
            });

            if (currentRoom.session && reconnectPosition === undefined) {
              ws.send(buildStocErrorMsg(null, 1, 0));
              return;
            }

            // Assign position. A reconnecting player must get the original
            // seat; otherwise private state and response ownership diverge.
            const openPosition = reconnectPosition ?? [0, 1].find((index) => !currentRoom.players[index]);
            if (openPosition === undefined) {
              // Room full → send error and make observer? For now, error
              ws.send(buildStocErrorMsg(null, 1, 0)); // JOINERROR, code=0 → generic join error
              return;
            }
            playerPosition = openPosition;
            const previousPlayer = currentRoom.players[playerPosition];
            currentRoom.players[playerPosition] = {
              ...previousPlayer,
              ws,
              name: playerName,
              ready: previousPlayer?.ready ?? false,
              deck: previousPlayer?.deck ?? null,
              disconnectedAt: null,
            };
            if (previousPlayer?.ws && previousPlayer.ws !== ws && previousPlayer.ws.readyState === WS_OPEN) {
              try { previousPlayer.ws.close(4000, 'replaced by reconnect'); } catch (e) { /* ignore */ }
            }

            sendRoomJoinState(currentRoom, playerPosition);

            console.log(`[ygopro-ws] Room "${passWd}": ${currentRoom.players.filter(Boolean).length}/2 players`);

            if (currentRoom.finished) {
              ws.send(buildStocDuelEnd());
              break;
            }

            if (currentRoom.session) {
              console.log(`[ygopro-ws] ${playerName} reconnected to active duel room "${passWd}" as player ${playerPosition}`);
              sendDuelReconnectSnapshot(currentRoom, playerPosition);

              const otherPlayer = currentRoom.players[1 - playerPosition];
              if (otherPlayer?.ws && otherPlayer.ws.readyState === WS_OPEN) {
                otherPlayer.ws.send(buildStocChat(0, `${playerName} has reconnected`));
              }
              break;
            }

            // ── Auto-ready for preloaded-deck rooms ──────────────────
            // If this room has preloaded decks from cube-draft, auto-mark
            // both players as ready immediately to skip the waitroom.
            if (currentRoom.preloadedDecks && currentRoom.preloadedDecks.length >= 2) {
              const player = currentRoom.players[playerPosition];
              if (player) player.ready = true;

              // Notify all players about ready state change
              for (const p of currentRoom.players) {
                if (p?.ws && p.ws.readyState === WS_OPEN) {
                  p.ws.send(buildStocHsPlayerChange(1, playerPosition));
                }
              }

              console.log(`[ygopro-ws] ${playerName} auto-readied (preloaded room)`);

              // Check if both players are now ready → auto-start duel
              if (currentRoom.players.filter(Boolean).length >= 2 &&
                  currentRoom.players[0]?.ready &&
                  currentRoom.players[1]?.ready) {
                console.log(`[ygopro-ws] Both players ready in preloaded room "${passWd}", auto-starting duel`);
                await startDuel(currentRoom);
              }
            }
            break;
          }

          case CTOS_UPDATE_DECK: {
            const deck = parseUpdateDeck(exData);
            if (currentRoom && playerPosition >= 0) {
              // Store the deck sent by client
              while (currentRoom.clientDecks.length <= playerPosition) {
                currentRoom.clientDecks.push(null);
              }
              currentRoom.clientDecks[playerPosition] = deck;
              console.log(`[ygopro-ws] ${playerName} submitted deck: ${deck.main.length} cards`);
            }
            break;
          }

          case CTOS_HS_READY: {
            if (currentRoom && playerPosition >= 0 && playerPosition < currentRoom.players.length) {
              const player = currentRoom.players[playerPosition];
              if (player) player.ready = true;

              // Notify all players about state change
              for (const p of currentRoom.players) {
                if (p?.ws && p.ws.readyState === WS_OPEN) {
                  p.ws.send(buildStocHsPlayerChange(1, playerPosition)); // 1 = ready
                }
              }

              console.log(`[ygopro-ws] ${playerName} is ready in room "${currentRoom.passWd}"`);

              // Check if both players are ready
              if (currentRoom.players.filter(Boolean).length >= 2 &&
                  currentRoom.players[0]?.ready &&
                  currentRoom.players[1]?.ready) {
                await startDuel(currentRoom);
              }
            }
            break;
          }

          case CTOS_HS_NOT_READY: {
            if (currentRoom && playerPosition >= 0 && playerPosition < currentRoom.players.length) {
              const player = currentRoom.players[playerPosition];
              if (player) player.ready = false;

              for (const p of currentRoom.players) {
                if (p?.ws && p.ws.readyState === WS_OPEN) {
                  p.ws.send(buildStocHsPlayerChange(0, playerPosition)); // 0 = not ready
                }
              }
            }
            break;
          }

          case CTOS_HS_START: {
            // Host requested start — check if both ready
            if (currentRoom && playerPosition === 0) {
              if (currentRoom.players.filter(Boolean).length >= 2 &&
                  currentRoom.players[0]?.ready &&
                  currentRoom.players[1]?.ready) {
                await startDuel(currentRoom);
              }
            }
            break;
          }

          case CTOS_RESPONSE: {
            // Forward raw response buffer to DuelSession
            if (currentRoom?.session) {
              const waitingPlayer = currentRoom.session.waitingResponsePlayer;
              if (waitingPlayer === 0 || waitingPlayer === 1) {
                const expectedPlayer = currentRoom.players[waitingPlayer];
                if (expectedPlayer?.ws !== ws) {
                  console.warn(`[ygopro-ws] Ignoring response from ${playerName}; waiting for player ${waitingPlayer}`);
                  break;
                }
              }
              const responseBuf = parseResponse(exData);
              currentRoom.session.sendResponse(responseBuf);
            }
            break;
          }

          case CTOS_SURRENDER: {
            if (currentRoom?.session) {
              currentRoom.session.surrender(playerPosition);
            }
            break;
          }

          case CTOS_CHAT: {
            // Relay chat to other player
            if (currentRoom) {
              const message = parseChatMessage(exData);
              if (!message) break;

              const pkt = buildStocChat(playerPosition, message);
              const otherPos = 1 - playerPosition;
              const otherPlayer = currentRoom.players[otherPos];
              if (otherPlayer?.ws) {
                otherPlayer.ws.send(pkt);
              }
              const selfPlayer = currentRoom.players[playerPosition];
              if (selfPlayer?.ws) {
                selfPlayer.ws.send(pkt);
              }
            }
            break;
          }

          default: {
            console.log(`[ygopro-ws] Unknown CTOS proto: 0x${proto.toString(16)}`);
            break;
          }
        }
      }
    } catch (err) {
      console.error(`[ygopro-ws] Error processing message from ${playerName}:`, err);
    }
  });

  ws.on('close', () => {
    console.log(`[ygopro-ws] ${playerName} disconnected`);

    if (currentRoom) {
      if (
        playerPosition < 0 ||
        playerPosition >= currentRoom.players.length ||
        currentRoom.players[playerPosition]?.ws !== ws
      ) {
        return;
      }

      const player = currentRoom.players[playerPosition];
      player.ws = null;
      player.disconnectedAt = Date.now();
      if (!currentRoom.session && !currentRoom.starting) {
        player.ready = false;
      }

      // Notify opponent, but do not end the duel. The OCGCore state is kept
      // alive so the same player can reconnect into the original seat.
      const otherPos = 1 - playerPosition;
      const otherPlayer = currentRoom.players[otherPos];
      if (otherPlayer?.ws && otherPlayer.ws.readyState === WS_OPEN) {
        otherPlayer.ws.send(buildStocHsPlayerChange(0, playerPosition));
        otherPlayer.ws.send(buildStocChat(0, `${playerName} has disconnected and may reconnect`));
      }

      if (!currentRoom.session && currentRoom.players.every((p) => !p || !p.ws)) {
        if (currentRoom.preloadedDecks) return;
        pendingRooms.delete(currentRoom.passWd);
        console.log(`[ygopro-ws] Room "${currentRoom.passWd}" cleaned up`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[ygopro-ws] WebSocket error for ${playerName}:`, err.message);
  });
}

// ── Duel lifecycle ────────────────────────────

/**
 * Start the duel for a room where both players are ready.
 */
async function startDuel(room) {
  if (room.session || room.starting) {
    console.log(`[ygopro-ws] Duel already started/starting for room "${room.passWd}"`);
    return;
  }

  room.starting = true;
  console.log(`[ygopro-ws] Starting duel for room "${room.passWd}"`);

  // Determine which decks to use
  let deck0, deck1;

  if (room.preloadedDecks && room.preloadedDecks.length >= 2) {
    // Use cube-draft preloaded decks
    deck0 = room.preloadedDecks[0];
    deck1 = room.preloadedDecks[1];
    console.log(`[ygopro-ws] Using preloaded cube-draft decks`);
  } else if (room.clientDecks.length >= 2 && room.clientDecks[0] && room.clientDecks[1]) {
    // Use decks submitted by neos-ts clients
    deck0 = { main: room.clientDecks[0].main, extra: [] };
    deck1 = { main: room.clientDecks[1].main, extra: [] };
    console.log(`[ygopro-ws] Using client-submitted decks`);
  } else {
    // No decks available
    console.error(
      `[ygopro-ws] Cannot start duel for room "${room.passWd}": no usable decks ` +
      `(preloaded=${room.preloadedDecks?.length || 0}, client0=${describeDeck(room.clientDecks[0])}, client1=${describeDeck(room.clientDecks[1])})`,
    );
    for (const p of room.players) {
      if (p?.ws) p.ws.send(buildStocErrorMsg(null, 4, 0)); // VERSIONERROR → hardcoded "版本不匹配"
    }
    room.starting = false;
    return;
  }

  try {
    // Create DuelSession FIRST, only send DUEL_START after success
    const session = await duelBridge.createSession({
      decks: [deck0, deck1],
      hostinfo: {
        start_lp: 8000,
        start_hand: 5,
        draw_count: 1,
        duel_rule: 5, // master rule
        testMode: room.testMode === true,
      },
      options: {
        scriptPath: duelOptions.scriptPath || null,
        cardsCdbPath: duelOptions.cardsCdbPath || null,
        seed: Date.now() % 0xFFFFFFFF,
      },
    });

    room.session = session;
    room.sessionId = session.sessionId;
    room.starting = false;

    // Send DUEL_START to both players AFTER session is ready
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      if (!p?.ws || p.ws.readyState !== WS_OPEN) continue;
      sendDuelStartSnapshot(room, i, { includeField: false });
    }

    // Hook up events for relay
    session.on('gameMsg', (msg) => {
      // msg format: { type: '...', data: { raw: 'base64...', _rawBuf: <Buffer> } }
      const playerPayloads = msg?.data?.playerPayloads;
      if (Array.isArray(playerPayloads)) {
        for (const view of playerPayloads) {
          const player = room.players[view.player];
          if (!player?.ws || player.ws.readyState !== 1 || !view.raw) continue;
          player.ws.send(buildStocGameMsg(Buffer.from(view.raw, 'base64')));
        }
        return;
      }

      const raw = msg?.data?._rawBuf || msg?.data?.raw;
      let rawBuf = null;
      if (Buffer.isBuffer(raw)) {
        rawBuf = raw;
      } else if (typeof raw === 'string' && raw) {
        rawBuf = Buffer.from(raw, 'base64');
      }

      if (rawBuf && rawBuf.length > 0) {
        const pkt = buildStocGameMsg(rawBuf);
        for (const p of room.players) {
          if (p?.ws && p.ws.readyState === 1) {
            p.ws.send(pkt);
          }
        }
      }
    });

    session.on('select', (msg) => {
      // Select messages also go through STOC_GAME_MSG
      // Format: { type: 'response'|'retry', data: { raw: 'base64...', _rawBuf: <Buffer> } }
      const playerPayloads = msg?.data?.playerPayloads;
      if (Array.isArray(playerPayloads)) {
        for (const view of playerPayloads) {
          const player = room.players[view.player];
          if (!player?.ws || player.ws.readyState !== 1 || !view.raw) continue;
          player.ws.send(buildStocGameMsg(Buffer.from(view.raw, 'base64')));
        }
        return;
      }

      const raw = msg?.data?._rawBuf || msg?.data?.raw;
      let rawBuf = null;
      if (Buffer.isBuffer(raw)) {
        rawBuf = raw;
      } else if (typeof raw === 'string' && raw) {
        rawBuf = Buffer.from(raw, 'base64');
      }

      if (rawBuf && rawBuf.length > 0) {
        const pkt = buildStocGameMsg(rawBuf);
        for (const p of room.players) {
          if (p?.ws && p.ws.readyState === 1) {
            p.ws.send(pkt);
          }
        }
      }
    });

    session.on('win', (winMsg) => {
      console.log(`[ygopro-ws] Duel ended, winner: player ${winMsg.player}`);
      notifyDuelFinished(room, winMsg);
      for (const p of room.players) {
        if (p?.ws && p.ws.readyState === WS_OPEN) p.ws.send(buildStocDuelEnd());
      }
    });

    session.on('done', () => {
      console.log(`[ygopro-ws] Duel session ${room.sessionId} finished`);
    });

    session.on('error', (err) => {
      console.error(
        `[ygopro-ws] Duel runtime error in room "${room.passWd}" session ${room.sessionId}: ${err.message}`,
      );
      notifyDuelFinished(room, { player: null, reason: 'runtime_error' });
      for (const p of room.players) {
        if (p?.ws && p.ws.readyState === WS_OPEN) p.ws.send(buildStocErrorMsg(null, 4, 0)); // VERSIONERROR
      }
    });

    // Now we need to modify the DuelSession to emit raw binary for gameMsg/select events
    // The current implementation parses messages to JSON and emits parsed data.
    // We need it to also emit the raw binary.
    // We'll handle this by overriding the advance behavior or modifying DuelSession.
    // For now, the existing gameMsg events will also be relayed as raw binary through
    // the `armForRawOutput` patching we'll add.

    console.log(`[ygopro-ws] Duel session ${room.sessionId} created successfully`);

  } catch (err) {
    console.error(
      `[ygopro-ws] Failed to start duel for room "${room.passWd}" ` +
      `(scriptPath=${duelOptions.scriptPath || '(unset)'}, cardsCdbPath=${duelOptions.cardsCdbPath || '(unset)'}): ${err.message}`,
    );
    if (err?.stack) {
      console.error(err.stack);
    }
    room.starting = false;
    room.session = null;
    notifyDuelFinished(room, { player: null, reason: 'start_failed' });
    for (const p of room.players) {
      if (p?.ws && p.ws.readyState === WS_OPEN) p.ws.send(buildStocErrorMsg(null, 4, 0)); // VERSIONERROR
    }
  }
}

function sendRoomJoinState(room, playerPosition) {
  const player = room.players[playerPosition];
  if (!player?.ws || player.ws.readyState !== WS_OPEN) return;

  const otherPosition = 1 - playerPosition;
  const otherPlayer = room.players[otherPosition];
  const selfName = player.name || 'Player';
  const oppName = otherPlayer?.name || 'Waiting...';

  const joinMsg = playerPosition === 0
    ? buildStocJoinGame(selfName, oppName)
    : buildStocJoinGame(oppName, selfName);

  player.ws.send(joinMsg);
  player.ws.send(buildStocTypeChange(playerPosition, playerPosition === 0));
  player.ws.send(buildStocHsPlayerEnter(selfName, playerPosition));

  if (otherPlayer) {
    player.ws.send(buildStocHsPlayerEnter(otherPlayer.name, otherPosition));
  }

  for (let i = 0; i < 2; i++) {
    if (room.players[i]?.ready) {
      player.ws.send(buildStocHsPlayerChange(1, i));
    }
  }

  if (otherPlayer?.ws && otherPlayer.ws.readyState === WS_OPEN) {
    otherPlayer.ws.send(buildStocHsPlayerEnter(selfName, playerPosition));
    otherPlayer.ws.send(buildStocHsPlayerChange(player.ready ? 1 : 0, playerPosition));
  }
}

function sendDuelReconnectSnapshot(room, playerIndex) {
  sendDuelStartSnapshot(room, playerIndex, { includeField: true });

  const responsePayload = room.session?.getWaitingResponsePayloadFor?.(playerIndex);
  const player = room.players[playerIndex];
  if (responsePayload && player?.ws && player.ws.readyState === WS_OPEN) {
    player.ws.send(buildStocGameMsg(responsePayload));
  }
}

function notifyDuelFinished(room, winMsg) {
  if (room.finished) return;
  room.finished = true;

  const winnerPosition = Number.isInteger(winMsg?.player) ? winMsg.player : null;
  if (typeof room.onDuelEnd === 'function') {
    try {
      room.onDuelEnd({
        passWd: room.passWd,
        tableId: room.tableId,
        roomId: room.draftRoomId,
        winnerPosition,
        reason: winMsg?.reason ?? null,
      });
    } catch (err) {
      console.warn(`[ygopro-ws] onDuelEnd failed for room "${room.passWd}": ${err?.message || err}`);
    }
  }
}

function sendDuelStartSnapshot(room, playerIndex, { includeField }) {
  const session = room.session;
  const player = room.players[playerIndex];
  if (!session || !player?.ws || player.ws.readyState !== WS_OPEN) return;

  const deckSizes = includeField ? getCurrentDeckSizes(session) : session.getDeckSizes();
  player.ws.send(buildStocDuelStart());
  player.ws.send(buildStocGameMsg(buildMsgStartPayload(playerIndex, deckSizes, room)));

  if (!includeField) {
    player.ws.send(buildStocGameMsg(buildExtraDeckUpdatePayload(playerIndex, session.loadedDecks[playerIndex]?.extra || [])));
    return;
  }

  const fieldInfo = session.queryFieldInfo();
  if (fieldInfo?.raw?.length > 0) {
    player.ws.send(buildStocGameMsg(Buffer.from(fieldInfo.raw)));
  }

  for (const payload of buildVisibleFieldUpdatePayloads(room, playerIndex)) {
    player.ws.send(buildStocGameMsg(payload));
  }
}

function describeDeck(deck) {
  if (!deck) return 'missing';
  const main = Array.isArray(deck.main) ? deck.main.length : 0;
  const extra = Array.isArray(deck.extra) ? deck.extra.length : 0;
  return `main=${main},extra=${extra}`;
}

function buildMsgStartPayload(playerIndex, deckSizes, room) {
  const myDeck = deckSizes[playerIndex] || { main: 0, extra: 0 };
  const opDeck = deckSizes[1 - playerIndex] || { main: 0, extra: 0 };
  const hasMasterRule = room.session?.hostinfo?.duel_rule >= 5;
  const buf = Buffer.alloc(hasMasterRule ? 18 : 17);
  let offset = 0;

  buf.writeUInt8(playerIndex & 0x0f, offset++);
  if (hasMasterRule) {
    buf.writeUInt8(room.session.hostinfo.duel_rule, offset++);
  }

  buf.writeInt32LE(room.session.hostinfo.start_lp, offset); offset += 4;
  buf.writeInt32LE(room.session.hostinfo.start_lp, offset); offset += 4;
  buf.writeInt16LE(myDeck.main, offset); offset += 2;
  buf.writeInt16LE(myDeck.extra, offset); offset += 2;
  buf.writeInt16LE(opDeck.main, offset); offset += 2;
  buf.writeInt16LE(opDeck.extra, offset); offset += 2;

  return Buffer.concat([Buffer.from([MSG_START]), buf]);
}

function buildExtraDeckUpdatePayload(playerIndex, extraCodes) {
  const chunks = extraCodes.map((code, sequence) => {
    const actionDataLength = 12; // flags + code + card location
    const chunk = Buffer.alloc(4 + actionDataLength);
    let offset = 0;
    chunk.writeInt32LE(4 + actionDataLength, offset); offset += 4;
    chunk.writeInt32LE(QUERY_CODE | QUERY_POSITION, offset); offset += 4;
    chunk.writeInt32LE(code, offset); offset += 4;
    chunk.writeUInt8(playerIndex & 0xff, offset++);
    chunk.writeUInt8(LOCATION_EXTRA, offset++);
    chunk.writeUInt8(sequence & 0xff, offset++);
    chunk.writeUInt8(POS_FACEDOWN, offset++);
    return chunk;
  });

  return Buffer.concat([
    Buffer.from([MSG_UPDATE_DATA, playerIndex & 0xff, LOCATION_EXTRA]),
    ...chunks,
  ]);
}

function getCurrentDeckSizes(session) {
  return [0, 1].map((player) => ({
    main: session.queryFieldCount(player, LOCATION_DECK),
    extra: session.queryFieldCount(player, LOCATION_EXTRA),
  }));
}

function buildVisibleFieldUpdatePayloads(room, viewerIndex) {
  if (!room.session) return [];

  const payloads = [];
  const locations = [
    LOCATION_HAND,
    LOCATION_MZONE,
    LOCATION_SZONE,
    LOCATION_GRAVE,
    LOCATION_REMOVED,
    LOCATION_EXTRA,
  ];

  for (let controller = 0; controller < 2; controller++) {
    for (const location of locations) {
      const cards = room.session.queryFieldCards(controller, location, QUERY_CODE | QUERY_POSITION)?.cards || [];
      const chunks = [];

      cards.forEach((card, fallbackSequence) => {
        const normalized = normalizeCardQuery(card, controller, location, fallbackSequence);
        if (!shouldRevealCardToViewer(normalized, viewerIndex)) return;
        chunks.push(buildUpdateDataChunk(normalized));
      });

      if (chunks.length > 0) {
        payloads.push(Buffer.concat([
          Buffer.from([MSG_UPDATE_DATA, controller & 0xff, location & 0xff]),
          ...chunks,
        ]));
      }
    }
  }

  return payloads;
}

function normalizeCardQuery(card, controller, location, sequence) {
  return {
    code: Number(card?.code || 0),
    controller: Number(card?.controller ?? controller),
    location: Number(card?.location ?? location),
    sequence: Number(card?.sequence ?? sequence),
    position: Number(card?.position || 0),
  };
}

function shouldRevealCardToViewer(card, viewerIndex) {
  if (!card.code) return false;
  if (card.location === LOCATION_DECK) return false;

  if (card.controller === viewerIndex) {
    return true;
  }

  if (card.location === LOCATION_HAND) return false;
  if (card.location === LOCATION_EXTRA) return isFaceUp(card.position);
  if (card.location === LOCATION_GRAVE) return !isFaceDown(card.position);
  if (card.location === LOCATION_REMOVED) return isFaceUp(card.position);
  if (card.location === LOCATION_MZONE || card.location === LOCATION_SZONE) {
    return isFaceUp(card.position);
  }

  return false;
}

function buildUpdateDataChunk(card) {
  const actionDataLength = 12; // flags + code + packed card location
  const chunk = Buffer.alloc(4 + actionDataLength);
  let offset = 0;
  chunk.writeInt32LE(4 + actionDataLength, offset); offset += 4;
  chunk.writeInt32LE(QUERY_CODE | QUERY_POSITION, offset); offset += 4;
  chunk.writeInt32LE(card.code, offset); offset += 4;
  chunk.writeUInt8(card.controller & 0xff, offset++);
  chunk.writeUInt8(card.location & 0xff, offset++);
  chunk.writeUInt8(card.sequence & 0xff, offset++);
  chunk.writeUInt8(card.position & 0xff, offset++);
  return chunk;
}

function isFaceUp(position) {
  return (position & POS_FACEUP) !== 0;
}

function isFaceDown(position) {
  return (position & POS_FACEDOWN) !== 0;
}

// ── Cleanup timer ────────────────────────────

// Periodic cleanup of dead rooms (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const ROOM_TIMEOUT = 10 * 60 * 1000; // 10 minutes idle

let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [passWd, room] of pendingRooms) {
      if (room.session) {
        const players = room.players.filter(Boolean);
        const allDisconnected = players.length > 0 && players.every((p) => !p.ws);
        const newestDisconnect = Math.max(0, ...players.map((p) => p.disconnectedAt || 0));
        if (allDisconnected && newestDisconnect > 0 && now - newestDisconnect > ROOM_TIMEOUT) {
          console.log(`[ygopro-ws] Cleaning up disconnected active room "${passWd}"`);
          notifyDuelFinished(room, { player: null, reason: 'all_disconnected_timeout' });
          room.session.dispose?.();
          pendingRooms.delete(passWd);
        }
        continue;
      }

      for (let i = 0; i < room.players.length; i++) {
        const player = room.players[i];
        if (player && !player.ws && player.disconnectedAt && now - player.disconnectedAt > ROOM_TIMEOUT) {
          room.players[i] = null;
        }
      }

      const activePlayers = room.players.filter(Boolean);
      if (room.preloadedDecks && activePlayers.length === 0) continue;

      const allIdle = activePlayers.length === 0 || activePlayers.every(p => !p.ready);
      if (!allIdle) continue;

      console.log(`[ygopro-ws] Cleaning up idle room "${passWd}"`);
      for (const p of activePlayers) {
        if (p?.ws && p.ws.readyState === WS_OPEN) {
          try { p.ws.close(); } catch (e) { /* ignore */ }
        }
      }
      pendingRooms.delete(passWd);
    }
  }, CLEANUP_INTERVAL);
}

startCleanup();

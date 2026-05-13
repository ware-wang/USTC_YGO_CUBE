/**
 * duel-bridge — spawns duel-runner, parses stdin/stdout JSON lines.
 *
 * Response encoding (matching ygopro-core playerop.cpp):
 *   value & 0xffff = command type, value >> 16 = card index
 *
 *   IDLE_CMD: t=0 summon, 1 spsum, 2 repos, 3 mset, 4 sset, 5 chain, 6 BP, 7 EP, 8 shuffle
 *   SELECT_CHAIN: 0..n-1 = chain index, -1 = cancel
 *   SELECT_EFFECTYN: 0 or 1
 *   SELECT_YESNO: 0 or 1
 *   SELECT_OPTION: option index
 *   SELECT_POSITION: position bitmask
 *   SELECT_PLACE: zone index
 *   SELECT_CARD/TRIBUTE: card indices packed in response buffer
 *   SELECT_BATTLECMD: t=0..3 (chain/attack/M2/EP), s=index
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = process.env.DUEL_RUNNER_PATH ||
  path.join(__dirname, '..', '..', 'duel-runner', 'duel-runner');
const SCRIPT_DIR = process.env.OCGCORE_SCRIPT_DIR ||
  path.join(__dirname, '..', '..', '..', '..', 'ygopro', 'script');

export class DuelProcess {
  constructor() {
    this.proc = spawn(RUNNER_PATH, [SCRIPT_DIR], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = new Map();
    this.buffer = '';
    this.nextId = 1;
    this.events = [];

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        this._handleLine(line.trim());
      }
    });

    this.proc.stderr.on('data', (d) => {
      console.error('[duel-runner]', d.toString().trim());
    });

    this.proc.on('exit', (code) => {
      console.log('[duel-runner] exited code', code);
      for (const [, { reject }] of this.pending) {
        reject(new Error('Duel runner process exited'));
      }
      this.pending.clear();
    });

    this._ready = this._waitReady();
  }

  async _waitReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Runner startup timeout')), 5000);
      const handler = (d) => {
        if (d.toString().includes('[runner] Ready')) {
          clearTimeout(timeout);
          this.proc.stderr.removeListener('data', handler);
          resolve();
        }
      };
      this.proc.stderr.on('data', handler);
    });
  }

  _handleLine(line) {
    const spaceIdx = line.indexOf(' ');
    const type = spaceIdx >= 0 ? line.substring(0, spaceIdx) : line;
    const rest = spaceIdx >= 0 ? line.substring(spaceIdx + 1) : '';

    if (type === 'msg') {
      try { this.events.push(JSON.parse(rest)); }
      catch { this.events.push({ raw: rest }); }
      return;
    }

    if (this.pending.size > 0) {
      const [[id, { resolve, reject, autoChain }]] = this.pending;
      this.pending.delete(id);
      const events = [...this.events];
      this.events = [];

      if (type === 'ok') {
        resolve({ type: 'ok', data: rest, events });
      } else if (type === 'waiting') {
        let message;
        try { message = JSON.parse(rest); }
        catch { message = { raw: rest }; }

        // Intelligent auto-response for non-interactive prompts
        if (autoChain !== false) {
          const autoR = _autoRespond(message);
          if (autoR !== null) {
            // Auto-respond and re-enter the loop
            const respVal = autoR;
            this._sendRaw(`respond ${respVal}`).then(newResult => {
              newResult.events = [...events, ...newResult.events];
              resolve(newResult);
            }).catch(reject);
            return;
          }
        }

        resolve({ type: 'waiting', message, events });
      } else if (type === 'end') {
        resolve({ type: 'end', events });
      } else if (type === 'error') {
        resolve({ type: 'error', message: rest, events });
      } else {
        resolve({ type: 'unknown', raw: line, events });
      }
    }
  }

  async _sendRaw(cmd) {
    return new Promise((resolve, reject) => {
      this.events = [];
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(cmd + '\n');
    });
  }

  async _send(cmd, autoChain = true) {
    return new Promise((resolve, reject) => {
      this.events = [];
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, autoChain });
      this.proc.stdin.write(cmd + '\n');
    });
  }

  async create(seed) {
    const result = await this._send(`create ${seed}`, false);
    if (result.type !== 'ok') throw new Error('Create failed: ' + JSON.stringify(result));
    this.duelPtr = result.data;
    return result.data;
  }

  async loadDeck(player, mainDeck, extraDeck = []) {
    const ids = mainDeck.length + ' ' + mainDeck.join(' ') +
      ' ' + extraDeck.length + ' ' + extraDeck.join(' ');
    const result = await this._send(`load_deck ${player} ${ids}`, false);
    if (result.type !== 'ok') throw new Error('load_deck failed');
    return true;
  }

  async start(lp = 8000, startCount = 5, drawCount = 1) {
    return await this._send(`start ${lp} ${startCount} ${drawCount}`, false);
  }

  /**
   * Respond with a value. Auto-handles chain cancellations and other
   * non-interactive prompts automatically between the response and the
   * next real waiting state.
   */
  async respond(value) {
    return await this._send(`respond ${value}`);
  }

  async end() {
    return await this._send('end', false);
  }

  quit() {
    try { this.proc.stdin.write('quit\n'); } catch {}
    this.proc.kill();
  }
}

// Auto-respond to non-interactive prompts
function _autoRespond(msg) {
  if (!msg || !msg.t) return null;

  // End turn / go to battle phase
  if (msg.t === 11) { // MSG_SELECT_IDLECMD
    return null; // Always interactive
  }

  if (msg.t === 16) { // MSG_SELECT_CHAIN
    // Auto-cancel non-forced chains with no chains
    if (msg.fd === 0 && (!msg.chs || msg.chs.length === 0)) return -1;
    return null; // Otherwise interactive
  }

  if (msg.t === 12) return null;  // MSG_SELECT_CARD — always interactive
  if (msg.t === 20) return null;  // MSG_SELECT_TRIBUTE
  if (msg.t === 14) return null;  // MSG_SELECT_POSITION
  if (msg.t === 15) return null;  // MSG_SELECT_PLACE
  if (msg.t === 13) return null;  // MSG_SELECT_OPTION
  if (msg.t === 19) return null;  // MSG_SELECT_EFFECTYN
  if (msg.t === 18) return null;  // MSG_SELECT_YESNO
  if (msg.t === 10) return null;  // MSG_SELECT_BATTLECMD

  // Unknown SELECT — don't auto-respond
  return null;
}

export async function createDuelProcess() {
  const dp = new DuelProcess();
  await dp._ready;
  console.log('[DuelBridge] ready');
  return dp;
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_DIR = path.join(__dirname, '..', '..', 'data', 'logs', 'draft');
const LOG_DIR = path.resolve(process.env.DRAFT_LOG_DIR || DEFAULT_LOG_DIR);

let ensuredLogDir = false;

export function getConnectionInfo(req) {
  const headers = req?.headers || {};
  const forwardedFor = normalizeHeader(headers['x-forwarded-for']);
  const realIp = normalizeHeader(headers['x-real-ip']);
  const cfIp = normalizeHeader(headers['cf-connecting-ip']);
  const remoteAddress = normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
  const ip = normalizeIp((forwardedFor || '').split(',')[0] || realIp || cfIp || remoteAddress);

  return {
    ip: ip || null,
    forwardedFor: forwardedFor || null,
    realIp: realIp || null,
    cfIp: cfIp || null,
    remoteAddress: remoteAddress || null,
    userAgent: normalizeHeader(headers['user-agent']) || null,
  };
}

export function logRoomEvent(roomId, event, payload = {}) {
  if (!roomId || !event) return;
  try {
    ensureLogDir();
    const entry = {
      ts: new Date().toISOString(),
      roomId: String(roomId),
      event,
      ...payload,
    };
    fs.appendFileSync(roomLogPath(roomId), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[DraftLog] Failed to write ${event} for room ${roomId}: ${err?.message || err}`);
  }
}

export function getRoomLogPath(roomId) {
  return roomLogPath(roomId);
}

function ensureLogDir() {
  if (ensuredLogDir) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  ensuredLogDir = true;
}

function roomLogPath(roomId) {
  const safeRoomId = String(roomId).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(LOG_DIR, `${safeRoomId}.jsonl`);
}

function normalizeHeader(value) {
  if (Array.isArray(value)) return value.join(', ').trim();
  if (value == null) return '';
  return String(value).trim();
}

function normalizeIp(value) {
  const ip = normalizeHeader(value);
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

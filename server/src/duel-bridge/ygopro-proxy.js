/**
 * ygopro-proxy.js — Thin WebSocket proxy for neos-ts compatibility.
 *
 * neos-ts connects to ws://host:port (no path, standard ygopro port 7911).
 * This attaches to the existing HTTP server and forwards all binary traffic
 * to cube-draft's internal /ws-duel endpoint.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

const PROXY_PORT = parseInt(process.env.YGOPRO_PROXY_PORT || '7911', 10);

/**
 * Start a dedicated ygopro proxy WebSocket server on port 7911.
 * Each client connection is proxied to the internal /ws-duel endpoint.
 *
 * @param {import('http').Server} httpServer - the main HTTP server (to get its port)
 */
export function startYgoproProxy(httpServer) {
  const addr = httpServer.address();
  const port = addr ? addr.port : 3131;
  const targetUrl = `ws://localhost:${port}/ws-duel`;

  const proxyWss = new WebSocketServer({ port: PROXY_PORT, perMessageDeflate: false });

  console.log(`[ygopro-proxy] External port ${PROXY_PORT} → internal ${targetUrl}`);

  proxyWss.on('connection', (clientWs) => {
    const targetWs = new WebSocket(targetUrl);
    let targetReady = false;
    const queue = [];

    targetWs.on('open', () => {
      targetReady = true;
      for (const buf of queue) targetWs.send(buf);
      queue.length = 0;
    });

    clientWs.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (targetReady) targetWs.send(buf);
      else queue.push(buf);
    });

    targetWs.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(buf);
    });

    clientWs.on('close', () => targetWs.close());
    targetWs.on('close', () => { try { clientWs.close(); } catch(e) { /* ok */ } });
    clientWs.on('error', () => {});
    targetWs.on('error', () => { try { clientWs.close(); } catch(e) { /* ok */ } });
  });

  return proxyWss;
}
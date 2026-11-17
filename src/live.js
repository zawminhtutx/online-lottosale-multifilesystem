// Live updates over WebSocket (/ws?token=<JWT>): the server pushes small change notices such as
// { type: 'terms' } and clients reload what they show, so a term the admin opens appears on the
// online web app without a refresh. Notices carry no data — clients re-fetch through the API,
// which applies the usual permissions.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config, isAllowedOrigin } from './config.js';
import { db, one } from './db.js';

let wss = null;

export function attachLive(server) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

  wss.on('connection', async (socket, req) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {});
    try {
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin, req)) throw new Error('origin');
      const token = new URL(req.url, 'http://x').searchParams.get('token');
      const { sub } = jwt.verify(token ?? '', config.jwtSecret);
      const user = await one(db, 'SELECT id, status FROM users WHERE id = ?', [Number(sub)]);
      if (!user || user.status !== 'active') throw new Error('inactive');
      socket.userId = user.id;
    } catch {
      socket.close(4401, 'Unauthorized');
    }
  });

  // Drops connections that stopped answering pings (sleeping laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

// Drops every live connection (shutdown, tests) — http.Server#close waits for upgraded sockets.
export function closeLive() {
  if (!wss) return;
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  wss = null;
}

// Tells every signed-in client that something changed, e.g. broadcast('terms', { id }).
export function broadcast(type, extra = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, ...extra, at: Date.now() });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && socket.userId) socket.send(message);
  }
}

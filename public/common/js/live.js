// Live change notices from the server over WebSocket (see src/live.js), for the dashboards.
// onLive('tickets', fn) calls fn(message) for every such notice — and fn({ type, reconnected: true })
// after a reconnect, to catch anything missed — until the returned unsubscribe is called.
// The socket opens with the first listener and closes with the last; reconnects with backoff.
import { session } from './api.js';

const listeners = new Set(); // { type, fn }
let socket = null;
let retry = 0;
let retryTimer = null;
const statusListeners = new Set();

function setStatus(connected) {
  for (const fn of statusListeners) fn(connected);
}

function connect() {
  clearTimeout(retryTimer);
  const token = session.get()?.token;
  if (socket || !listeners.size || !token) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket = ws;
  ws.onopen = () => {
    setStatus(true);
    if (retry > 0) for (const l of listeners) l.fn({ type: l.type, reconnected: true });
    retry = 0;
  };
  ws.onmessage = (e) => {
    let message;
    try { message = JSON.parse(e.data); } catch { return; }
    for (const l of listeners) if (l.type === message.type) l.fn(message);
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    setStatus(false);
    if (!listeners.size || e.code === 4401) return; // nobody listening / not signed in
    retry += 1;
    retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
  };
}

export function onLive(type, fn) {
  const listener = { type, fn };
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(retryTimer);
    retry = 0;
    const ws = socket;
    socket = null;
    ws?.close();
  };
}

// fn(connected: boolean) whenever the socket opens or drops; returns unsubscribe.
export function onLiveStatus(fn) {
  statusListeners.add(fn);
  fn(socket?.readyState === WebSocket.OPEN);
  return () => statusListeners.delete(fn);
}

// Live change notices from the OnlineLotto server over WebSocket. useLive('terms', reload) calls
// reload whenever the admin changes a term, and once after every reconnect (to catch anything
// missed while offline). Reconnects with backoff; the socket closes when no page listens.
import { useEffect, useRef } from 'react';
import { getOnlineToken, onlineLiveUrl } from './onlineApi.js';

const listeners = new Set(); // { type, fn }
let socket = null;
let retry = 0;
let retryTimer = null;

function emit(type) {
  for (const l of listeners) if (l.type === type) l.fn();
}

function connect() {
  clearTimeout(retryTimer);
  if (socket || !listeners.size || !getOnlineToken()) return;
  const ws = new WebSocket(onlineLiveUrl());
  socket = ws;
  ws.onopen = () => {
    if (retry > 0) for (const type of new Set([...listeners].map((l) => l.type))) emit(type);
    retry = 0;
  };
  ws.onmessage = (e) => {
    try { emit(JSON.parse(e.data).type); } catch { /* ignore bad frames */ }
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    if (!listeners.size || e.code === 4401) return; // nobody listening / signed out
    retry += 1;
    retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
  };
}

function disconnect() {
  clearTimeout(retryTimer);
  retry = 0;
  const ws = socket;
  socket = null;
  ws?.close();
}

export function useLive(type, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const listener = { type, fn: () => ref.current() };
    listeners.add(listener);
    connect();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) disconnect();
    };
  }, [type]);
}

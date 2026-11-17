import { t } from './i18n.js';

// One session per app (/admin/, /agent/), so both can be signed in side by side.
const KEY = `lotto.${location.pathname.split('/')[1] || 'app'}.session`;
let memory = null; // used when localStorage is unavailable

export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY)) ?? memory; } catch { return memory; }
  },
  set(value) {
    memory = value;
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* memory only */ }
  },
  clear() {
    memory = null;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};

async function request(method, path, body) {
  const token = session.get()?.token;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && path !== '/auth/login') {
    session.clear();
    location.hash = '#/login';
  }
  if (!res.ok) {
    const detail = data.issues?.map((i) => `${i.path}: ${i.message}`).join('; ');
    const message = t(data.error || res.statusText);
    throw new Error(detail ? `${message} — ${detail}` : message);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
};

// Rarely-changing lookups, cached for the page lifetime.
const cache = new Map();
export function cached(path) {
  if (!cache.has(path)) cache.set(path, api.get(path).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path);
}
export function invalidate(path) {
  cache.delete(path);
}

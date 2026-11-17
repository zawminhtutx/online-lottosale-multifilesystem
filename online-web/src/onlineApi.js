// Client for the OnlineLotto API (the Turso-backed Express server). Online users sign in with
// their OnlineLotto account (role "user").

const TOKEN_KEY = 'online_token';
const USER_KEY = 'online_user';

// Same origin: the OnlineLotto server serves this app, and Vite proxies /api in dev.
// VITE_ONLINE_API_URL can point a build at a different server.
const API_BASE = import.meta.env.VITE_ONLINE_API_URL || '';

const REMEMBER_KEY = 'online_remember_username'; // last username, kept while "Remember me" is on
const storage = (name) => { try { return window[name]; } catch { return null; } };

// "Remember me" on: the session lives in localStorage (survives closing the browser).
// Off: sessionStorage (ends with the browser tab/window). Reads check both.
let remember = (() => {
  try { return !storage('sessionStorage')?.getItem(TOKEN_KEY); } catch { return true; }
})();

const store = {
  get(key) {
    try { return storage('localStorage')?.getItem(key) ?? storage('sessionStorage')?.getItem(key) ?? null; } catch { return null; }
  },
  set(key, value) {
    for (const name of ['localStorage', 'sessionStorage']) {
      try {
        const s = storage(name);
        const keep = value != null && value !== '' && (name === 'localStorage') === remember;
        if (keep) s?.setItem(key, value); else s?.removeItem(key);
      } catch { /* private mode: session lasts until reload */ }
    }
  },
};

export function getRememberedUsername() {
  try { return storage('localStorage')?.getItem(REMEMBER_KEY) ?? ''; } catch { return ''; }
}

export const getOnlineToken = () => store.get(TOKEN_KEY);

export function getOnlineUser() {
  try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch { return null; }
}

export function setOnlineSession(token, user) {
  store.set(TOKEN_KEY, token);
  store.set(USER_KEY, JSON.stringify(user));
}

// Signs in an OnlineLotto *user* account (agents/admins have their own dashboards).
export async function onlineLogin(username, password, rememberMe = true) {
  const { token, user } = await onlineApi('/auth/login', { method: 'POST', body: { username, password } });
  if (user.role !== 'user') throw new Error('ဤနေရာသည် ကစားသူ အကောင့်များအတွက်သာ ဖြစ်သည်');
  remember = rememberMe;
  setOnlineSession(token, user);
  try {
    if (rememberMe) storage('localStorage')?.setItem(REMEMBER_KEY, username);
    else storage('localStorage')?.removeItem(REMEMBER_KEY);
  } catch { /* ignore */ }
  return user;
}

export function clearOnlineSession() {
  store.set(TOKEN_KEY, null);
  store.set(USER_KEY, null);
}

// Server messages (English) shown to online users in Myanmar where we know them.
const MESSAGES = {
  'Invalid username or password': 'အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားနေသည်',
  'Account is not active': 'အကောင့် ပိတ်ထားသည်',
  'Invalid or expired token': 'ဝင်ရောက်မှု သက်တမ်းကုန်သွားပြီ၊ ပြန်ဝင်ပါ',
  'Insufficient balance': 'လက်ကျန်ငွေ မလုံလောက်ပါ',
  'Betting is closed for this term': 'ဤအပတ်စဉ်အတွက် ထိုးကြေး ပိတ်ပြီးဖြစ်သည်',
  'Validation failed': 'ဖြည့်သွင်းချက် မှားနေသည်',
  'Current password is wrong': 'လက်ရှိ စကားဝှက် မှားနေသည်',
  'A delete request for this slip is already waiting': 'ဤစလစ်အတွက် ဖျက်ရန် request ပို့ထားပြီး — admin approve ကို စောင့်ပါ',
  'Term already has results': 'ပေါက်ဂဏန်း ထွက်ပြီးသော အပါတ်စဥ်ဖြစ်၍ ဖျက်၍ မရတော့ပါ',
  'Ticket is already cancelled': 'ဤစလစ် ဖျက်ပြီးသားဖြစ်သည်',
  'Ticket not found': 'စလစ် မတွေ့ပါ',
  'Nothing to save: every number is closed, full or at its limit': 'ထိုးထားသော ဂဏန်း တစ်ကွက်မှ မရပါ (ပိတ်ဂဏန်း / ဘရိတ်ပြည့် / ကန့်သတ်ချက်ပြည့်) — စလစ် မသိမ်းပါ',
};
// Messages that carry numbers (unit break / the user's own per-number limit).
const PATTERNS = [
  [/^(.+) (\d+): only (\d+) unit\(s\) left$/, '$1 $2 — ယူနစ် $3 သာ ကျန်ပါသည်'],
  [/^(.+) (\d+): your limit is (\d+) unit\(s\), (\d+) left$/, '$1 $2 — သင့်ကန့်သတ်ချက် $3 ယူနစ်၊ $4 သာ ကျန်ပါသည်'],
  [/^(.+) (\d+) is a hot number: at most (\d+)% of your total bets \((\d+) Ks\)$/, '$1 $2 သည် ဟော့ဂဏန်း — သင့်စုစုပေါင်းထိုးကြေး၏ $3% ($4 Ks) အထိသာ ထိုးနိုင်သည်'],
];
function translate(msg) {
  if (MESSAGES[msg]) return MESSAGES[msg];
  const hit = PATTERNS.find(([re]) => re.test(msg));
  return hit ? msg.replace(hit[0], hit[1]) : msg;
}

export async function onlineApi(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getOnlineToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Online server နှင့် ချိတ်ဆက်၍ မရပါ');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      clearOnlineSession();
      window.dispatchEvent(new Event('online-logout'));
    }
    const detail = data?.issues?.map((i) => i.message).join('; ');
    const message = translate(data?.error || `Request failed (${res.status})`);
    throw new Error(detail ? `${message} — ${detail}` : message);
  }
  return data;
}

// WebSocket URL for live change notices (see ../../src/live.js), on the same server as the API.
export function onlineLiveUrl() {
  const base = new URL(API_BASE || '/', location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws';
  base.search = `?token=${encodeURIComponent(getOnlineToken() ?? '')}`;
  return base.href;
}

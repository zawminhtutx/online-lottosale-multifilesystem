// Display helpers shared by the online pages.

export const money = (n) => Number(n ?? 0).toLocaleString('en-US');

// OnlineLotto stores SQLite datetime('now') values in UTC without a zone marker.
export function parseDate(value) {
  if (!value) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

export function dateTime(value) {
  const d = parseDate(value);
  return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

// "2 နာရီ 15 မိနစ်" until the given time, or null once it has passed.
export function timeLeft(value, now = new Date()) {
  const d = parseDate(value);
  if (!d) return null;
  const minutes = Math.floor((d - now) / 60000);
  if (minutes < 0) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} ရက် ${hours} နာရီ`;
  if (hours) return `${hours} နာရီ ${mins} မိနစ်`;
  return `${mins} မိနစ်`;
}

// Same betting window rule as the server.
export function isTermOpen(term, now = new Date()) {
  if (term.status !== 'open') return false;
  if (term.open_at && now < parseDate(term.open_at)) return false;
  return !(term.close_at && now >= parseDate(term.close_at));
}

export const TICKET_STATUS = {
  active: ['စောင့်ဆိုင်းဆဲ', 'blue'],
  won: ['ပေါက်', 'green'],
  lost: ['မပေါက်', 'gray'],
  cancelled: ['ပယ်ဖျက်', 'red'],
};

export const WALLET_TYPE = {
  deposit: 'ငွေသွင်း',
  withdraw: 'ငွေထုတ်',
  transfer_in: 'ငွေဖြည့်',
  transfer_out: 'ငွေထုတ်',
  bet: 'ထိုးငွေ',
  win: 'ဆုငွေ',
  refund: 'ငွေပြန်အမ်း',
  adjust: 'ချိန်ညှိ',
};

// Twod (တွဒ်) numbers of a 3D result — same rule as the server: the +1/-1 neighbours (wrapping
// 999 <-> 000) and every other ordering of its digits.
export function twodNumbers(r3) {
  if (!r3 || !/^\d{3}$/.test(r3)) return [];
  const n = Number(r3);
  const out = [];
  const seen = new Set([r3]);
  const add = (x) => { if (!seen.has(x)) { seen.add(x); out.push(x); } };
  add(String((n + 1) % 1000).padStart(3, '0'));
  add(String((n + 999) % 1000).padStart(3, '0'));
  const permute = (rest, prefix) => {
    if (!rest.length) return add(prefix);
    for (let i = 0; i < rest.length; i++) permute(rest.slice(0, i) + rest.slice(i + 1), prefix + rest[i]);
  };
  permute(r3, '');
  return out;
}

export const GAME_LABEL = { '2D': '2D', '3D': '3D', '2D3D': '2D·3D' };

// A payment number shown with its middle hidden (09123456789 -> 091*****789); copying it still
// copies the whole number.
export function maskNumber(number) {
  const s = String(number ?? '').trim();
  if (s.length <= 4) return s;
  const keep = s.length >= 9 ? 3 : 2;
  return `${s.slice(0, keep)}${'*'.repeat(s.length - keep * 2)}${s.slice(-keep)}`;
}

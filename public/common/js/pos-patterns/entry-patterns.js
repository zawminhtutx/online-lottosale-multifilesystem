// Copy of online-web/src/entryPatterns.js (the sale page's pattern parser) for the admin dashboard's
// ADD HOT / ADD CLOSE dialogs — keep the two in sync.
// Number-entry patterns of the POS Sale page ("45R", "1P", "SS", "12*", ...), so online entries
// expand exactly like lottery-system/client/src/pages/SalePage.jsx. The rules below are a verbatim
// copy of its parseEntry()/numberPatternLabel — keep them in sync.
import { patternLabel } from './patterns.js';

// Maps physical key position (KeyboardEvent.code) to its pattern letter, independent of the
// active keyboard layout/IME — a Myanmar IME can substitute these letter keys with non-ASCII
// characters that the Number filter would otherwise silently strip.
export const PATTERN_KEYS = {
  KeyR: 'R', KeyS: 'S', KeyM: 'M', KeyP: 'P', KeyW: 'W',
  KeyT: 'T', KeyK: 'K', KeyB: 'B', KeyN: 'N',
};

// Characters the Number box accepts: digits plus the pattern letters/symbols, with "+" typed as
// P and "/" typed as R (as on the POS Sale page). Trailing "-" = အပြီးပေါက် without doubles.
export function normalizeEntryInput(value) {
  return value.toUpperCase().replace(/\+/g, 'P').replace(/\//g, 'R').replace(/[^0-9R*SMPWTKBN-]/gi, '');
}

// All unique permutations of a digit string, deduped — e.g. "112" -> ["112","121","211"].
export function uniquePermutations(str) {
  const results = new Set();
  function permute(remaining, prefix) {
    if (!remaining.length) {
      results.add(prefix);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      permute(remaining.slice(0, i) + remaining.slice(i + 1), prefix + remaining[i]);
    }
  }
  permute(str, '');
  return [...results];
}

export function hasRepeatDigits(digitStr) {
  const d = String(digitStr).replace(/\D/g, '');
  return d.length > 0 && new Set(d).size !== d.length;
}

// 2D အပြီးပေါက်: "145" -> 14R, 15R, 45R, then (if withDoubles) 11, 44, 55.
export function expandApayePauk(digitStr, withDoubles = true) {
  const chars = String(digitStr).split('');
  if (hasRepeatDigits(digitStr)) return { codes: [], numbers: [], error: 'ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ' };
  const codes = [];
  const combine = (start, chosen) => {
    if (chosen.length === 2) {
      codes.push(`${chosen.map((i) => chars[i]).join('')}R`);
      return;
    }
    for (let i = start; i < chars.length; i++) combine(i + 1, [...chosen, i]);
  };
  combine(0, []);
  if (withDoubles) {
    for (const c of new Set(chars)) codes.push(`${c}${c}`);
  }
  const uniqueCodes = [...new Set(codes)];
  const numbers = [];
  const seen = new Set();
  for (const code of uniqueCodes) {
    const parts = code.endsWith('R') ? uniquePermutations(code.slice(0, -1)) : [code];
    for (const n of parts) if (seen.add(n)) numbers.push(n);
  }
  return { codes: uniqueCodes, numbers };
}

// Live hint shown above the Number box, e.g. "ပါဝါ" for W, "12နောက်စီးရီး" for "12*".
export function entryPatternHint(entry, digits) {
  const digitWord = digits === 3 ? 'သုံးလုံး' : 'နှစ်လုံး';
  const raw = entry.trim().toUpperCase();
  if (!raw) return digitWord;
  if (/^\d+R{1,2}$/.test(raw)) return `${digitWord}ပတ်လည်`;
  let m;
  if ((m = /^(\d+)\*(\d+)$/.exec(raw))) return `${m[1]}${m[2]}အလယ်စီးရီး`;
  if ((m = /^(\d+)\*$/.exec(raw))) return `${m[1]}နောက်စီးရီး`;
  if ((m = /^\*(\d+)$/.exec(raw))) return `${m[1]}ရှေ့စီးရီး`;
  if (digits === 2 && /^\d{3,}-?$/.test(raw)) {
    const d = raw.replace(/-$/, '');
    if (hasRepeatDigits(d)) return 'ထပ်ဂဏန်း မရပါ';
    return raw.endsWith('-') ? 'အပြီးခွေ (အပူးမပါ)' : 'အပြီးခွေ';
  }
  if (digits === 2 && /^\d{3,}A$/.test(raw)) return hasRepeatDigits(raw.slice(0, -1)) ? 'ထပ်ဂဏန်း မရပါ' : 'အပြီးခွေ';
  if (/^\d+$/.test(raw)) return digitWord;
  const label = patternLabel(raw);
  return label !== raw ? label : digitWord;
}

// Expands one entry for a 2-digit (2D) or 3-digit (3D) bet type.
// Returns { numbers, grouptype } or { error }.
//
// R suffix = all unique permutations incl. the base ("45R" -> 45,54); RR = excluding the base.
// 145 / 145A = အပြီးပေါက် (14R,15R,45R + 11,44,55). 145- = same without doubles.
// SM/MM/MS/SS = even/odd front x even/odd back (25 numbers each). SP/MP = even/odd doubles.
// <digit>B = pairs whose digit sum ≡ digit (mod 10). N = consecutive digits (both directions).
// <digit>S / <digit>M = digit with each even / odd digit, both directions (kept unreduced).
// P = doubles 00..99. <digit>P = front digit ∪ back digit (19 numbers). T = 3D triples.
// <prefix>* / *<suffix> / <front>*<back> = 3D series filling the last / first / middle digit.
// W = digit with digit+5. K = 07,70,18,81,24,42,35,53,69,96.
export function splitGroupNumbers(input, stored, digits) {
  const rawStored = Array.isArray(stored) ? stored.map((n) => String(n).trim()).filter(Boolean) : [];
  const fromStore = rawStored.filter((n) => /^\d+$/.test(n));
  if (fromStore.length > 1) return fromStore;
  const raw = String(input || '').trim();
  const ap = /^(\d{3,})(A|-)?$/.exec(raw);
  if (digits === 2 && ap && !hasRepeatDigits(ap[1])) {
    const expanded = expandApayePauk(ap[1], ap[2] !== '-');
    if (expanded.numbers.length > 1) return expanded.numbers;
  }
  const parsed = parseEntry(raw, digits);
  if (!parsed.error && parsed.numbers.length > 1) return parsed.numbers;
  if (rawStored.length > 1) return rawStored;
  return fromStore;
}

// Replace one grouped cart line with one line per number, in the same place. Never removes the
// group unless at least two singles can be inserted — so "ungroup" cannot empty the cart.
export function replaceGroupedCartLine(cart, line, digits, newRowId) {
  const nums = splitGroupNumbers(line.input ?? line.key, line.numbers, digits);
  if (nums.length < 2) return { cart, ok: false };
  const byRef = cart.indexOf(line);
  const at = byRef >= 0 ? byRef : (line.rowId ? cart.findIndex((x) => x.rowId === line.rowId) : -1);
  if (at < 0) return { cart, ok: false };
  const parts = nums.map((n, i) => ({
    rowId: newRowId(i),
    bet_type_id: line.bet_type_id,
    input: n,
    key: n,
    numbers: [n],
    unit: line.unit,
    grouptype: null,
  }));
  return { cart: [...cart.slice(0, at), ...parts, ...cart.slice(at + 1)], ok: true, count: parts.length };
}

export function parseEntry(raw, digits) {
  const apaye = /^(\d{3,})(A|-)?$/.exec(raw);
  if (apaye && apaye[2]) {
    if (digits !== 2) return { error: 'အပြီးပေါက် ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const expanded = expandApayePauk(apaye[1], apaye[2] !== '-');
    if (expanded.error) return { error: expanded.error };
    if (!expanded.numbers.length) return { error: 'အပြီးခွေ ဂဏန်း မရပါ' };
    return { numbers: expanded.numbers, grouptype: 30000 };
  }
  if (raw === 'SM') {
    if (digits !== 2) return { error: 'SM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const numbers = [];
    for (const f of [0, 2, 4, 6, 8]) for (const b of [1, 3, 5, 7, 9]) numbers.push(`${f}${b}`);
    return { numbers, grouptype: 30052 };
  }
  if (raw === 'MM') {
    if (digits !== 2) return { error: 'MM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const odds = [1, 3, 5, 7, 9];
    const numbers = [];
    for (const f of odds) for (const b of odds) numbers.push(`${f}${b}`);
    return { numbers, grouptype: 30051 };
  }
  if (raw === 'MS') {
    if (digits !== 2) return { error: 'MS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const numbers = [];
    for (const f of [1, 3, 5, 7, 9]) for (const b of [0, 2, 4, 6, 8]) numbers.push(`${f}${b}`);
    return { numbers, grouptype: 30053 };
  }
  if (raw === 'SS') {
    if (digits !== 2) return { error: 'SS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const evens = [0, 2, 4, 6, 8];
    const numbers = [];
    for (const f of evens) for (const b of evens) numbers.push(`${f}${b}`);
    return { numbers, grouptype: 30050 };
  }
  if (raw === 'SP') {
    if (digits !== 2) return { error: 'SP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    return { numbers: [0, 2, 4, 6, 8].map((d) => `${d}${d}`), grouptype: 30061 };
  }
  if (raw === 'MP') {
    if (digits !== 2) return { error: 'MP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    return { numbers: [1, 3, 5, 7, 9].map((d) => `${d}${d}`), grouptype: 30062 };
  }
  if (raw === 'T') {
    if (digits !== 3) return { error: 'T ပုံစံသည် 3D အတွက်သာ ဖြစ်ပါသည်' };
    return { numbers: Array.from({ length: 10 }, (_, d) => `${d}${d}${d}`), grouptype: 31033 };
  }
  const wildMatch = /^(\d+)\*$/.exec(raw);
  if (wildMatch) {
    const prefix = wildMatch[1];
    if (prefix.length !== digits - 1) return { error: `ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်` };
    return { numbers: Array.from({ length: 10 }, (_, d) => `${prefix}${d}`), grouptype: 31032 };
  }
  const wildFrontMatch = /^\*(\d+)$/.exec(raw);
  if (wildFrontMatch) {
    const suffix = wildFrontMatch[1];
    if (suffix.length !== digits - 1) return { error: `ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်` };
    return { numbers: Array.from({ length: 10 }, (_, d) => `${d}${suffix}`), grouptype: 31030 };
  }
  const wildMidMatch = /^(\d+)\*(\d+)$/.exec(raw);
  if (wildMidMatch) {
    const [, front, back] = wildMidMatch;
    if (front.length + back.length !== digits - 1) return { error: `ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်` };
    return { numbers: Array.from({ length: 10 }, (_, d) => `${front}${d}${back}`), grouptype: 310031 };
  }
  const breakMatch = /^(\d)B$/.exec(raw);
  if (breakMatch) {
    if (digits !== 2) return { error: `${raw} ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်` };
    const k = Number(breakMatch[1]);
    return { numbers: Array.from({ length: 10 }, (_, a) => `${a}${(10 + k - a) % 10}`), grouptype: 31007 };
  }
  if (raw === 'N') {
    if (digits !== 2) return { error: 'N ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const numbers = [];
    for (let b = 0; b <= 9; b++) numbers.push(`${(b + 1) % 10}${b}`);
    for (let f = 0; f <= 9; f++) numbers.push(`${f}${(f + 1) % 10}`);
    return { numbers, grouptype: 30009 };
  }
  if (raw === 'P') {
    if (digits !== 2) return { error: 'P ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    return { numbers: Array.from({ length: 10 }, (_, d) => `${d}${d}`), grouptype: 30060 };
  }
  const powerMatch = /^(\d)P$/.exec(raw);
  if (powerMatch) {
    if (digits !== 2) return { error: 'ဂဏန်းP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const d = powerMatch[1];
    const numbers = new Set();
    for (let i = 0; i <= 9; i++) numbers.add(`${d}${i}`);
    for (let i = 0; i <= 9; i++) numbers.add(`${i}${d}`);
    return { numbers: [...numbers], grouptype: 30004 };
  }
  const evenPairMatch = /^(\d)S$/.exec(raw);
  if (evenPairMatch) {
    if (digits !== 2) return { error: 'ဂဏန်းS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const d = evenPairMatch[1];
    const numbers = [];
    for (const e of [0, 2, 4, 6, 8]) { numbers.push(`${d}${e}`); numbers.push(`${e}${d}`); }
    return { numbers, grouptype: 30083 };
  }
  const oddPairMatch = /^(\d)M$/.exec(raw);
  if (oddPairMatch) {
    if (digits !== 2) return { error: 'ဂဏန်းM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const d = oddPairMatch[1];
    const numbers = [];
    for (const o of [1, 3, 5, 7, 9]) { numbers.push(`${d}${o}`); numbers.push(`${o}${d}`); }
    return { numbers, grouptype: 30080 };
  }
  if (raw === 'W') {
    if (digits !== 2) return { error: 'W ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    const numbers = [];
    for (let d = 0; d < 5; d++) { numbers.push(`${d}${d + 5}`); numbers.push(`${d + 5}${d}`); }
    return { numbers, grouptype: 30070 };
  }
  if (raw === 'K') {
    if (digits !== 2) return { error: 'K ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်' };
    return { numbers: ['07', '70', '18', '81', '24', '42', '35', '53', '69', '96'], grouptype: 30071 };
  }
  const revExcludeMatch = /^(\d+)RR$/.exec(raw);
  if (revExcludeMatch) {
    const base = revExcludeMatch[1];
    if (base.length !== digits) return { error: `ဂဏန်း ${digits} လုံး ဖြစ်ရမည်` };
    const numbers = uniquePermutations(base).filter((n) => n !== base);
    if (!numbers.length) return { error: `${base} ကျန်ဂဏန်း မရှိပါ` };
    return { numbers, grouptype: 31003 };
  }
  const revMatch = /^(\d+)R$/.exec(raw);
  if (revMatch) {
    const base = revMatch[1];
    if (base.length !== digits) return { error: `ဂဏန်း ${digits} လုံး ဖြစ်ရမည်` };
    const numbers = uniquePermutations(base);
    return { numbers, grouptype: numbers.length > 1 ? (digits === 3 ? 31001 : 30001) : null };
  }
  if (raw.includes('R')) return { error: 'R ပုံစံ မှားနေပါတယ် (ဥပမာ - 45R)' };
  if (/^\d+$/.test(raw)) {
    if (raw.length !== digits) return { error: `ဂဏန်း ${digits} လုံး ဖြစ်ရမည်` };
    return { numbers: [raw], grouptype: null };
  }
  return { error: `"${raw}" ပုံစံ မမှန်ကန်ပါ` };
}

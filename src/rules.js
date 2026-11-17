// Game rules: how bet input expands into numbers, and which numbers win for a draw.
//
// Draw results (term_results):
//   slot 1 = 3D result, 3 digits (e.g. "385") — required for 3D terms
//   slot 2 = 2D result, 2 digits — required for 2D terms (older 2D+3D terms default it to the
//            last two digits of slot 1)
import { badRequest } from './errors.js';

function permutations(str) {
  if (str.length <= 1) return [str];
  const out = new Set();
  [...str].forEach((ch, i) => {
    for (const rest of permutations(str.slice(0, i) + str.slice(i + 1))) out.add(ch + rest);
  });
  return [...out];
}

// "12" -> ["12"], "12R" -> ["12","21"], "123R" -> all distinct permutations.
export function expandInput(betType, rawInput) {
  const input = String(rawInput).trim().toUpperCase();
  const match = /^(\d+)(R?)$/.exec(input);
  if (!match) throw badRequest(`Invalid input "${rawInput}" for ${betType.description}`);

  const [, digits, reverse] = match;
  if (digits.length !== betType.digits) {
    throw badRequest(`${betType.description} needs ${betType.digits} digit(s), got "${rawInput}"`);
  }
  if (!reverse) return [digits];
  if (betType.digits < 2) throw badRequest(`"R" is not allowed for ${betType.description}`);
  return permutations(digits).sort();
}

// game: the term's type — '2D', '3D', or '2D3D' for terms created before types were split.
export function parseResults(rows, game = '2D3D') {
  const bySlot = new Map(rows.map((r) => [r.slot, String(r.value)]));
  const r3 = bySlot.get(1) ?? null;
  if (game !== '2D' && (!r3 || !/^\d{3}$/.test(r3))) throw badRequest('Result slot 1 must be a 3-digit number');
  if (r3 != null && !/^\d{3}$/.test(r3)) throw badRequest('Result slot 1 must be a 3-digit number');
  // Only legacy 2D+3D terms fall back to the last two digits of the 3D result.
  const r2 = bySlot.get(2) ?? (game === '2D3D' && r3 ? r3.slice(1) : null);
  if (game !== '3D' && (!r2 || !/^\d{2}$/.test(r2))) throw badRequest('Result slot 2 must be a 2-digit number');
  return { r3, r2 };
}

// Bet types a term accepts: a 2D term takes 2-digit types only, a 3D term 3-digit types only.
export function betTypeFitsTerm(betType, game) {
  if (game === '2D') return betType.digits === 2;
  if (game === '3D') return betType.digits === 3;
  return true;
}

// Twod (တွဒ်) numbers of a 3D result, as in the POS app: the whole number's +1/-1 neighbours
// (wrapping 999 <-> 000) and every other ordering of its digits — never the result itself.
// "640" -> 641, 639, 604, 046, 064, 406, 460.
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

// Returns the list of numbers that win for the given bet type code.
export function winningNumbers(code, { r3, r2 }) {
  // A 2D term has no 3D result and a 3D term may have no 2D one: nothing wins on the missing side.
  if (code === '2D') return r2 ? [r2] : [];
  if (code === '3D') return r3 ? [r3] : [];
  return [];
}

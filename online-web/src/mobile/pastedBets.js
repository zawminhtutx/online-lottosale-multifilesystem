// ကူး (paste): reads bets out of a message copied from Viber / Telegram / SMS — a port of
// parsePastedBets in online-mobile/lib/services/pattern_parser.dart; keep the two in sync.
//
// Full lines — numbers/patterns, then the unit last:
//   "25 1000", "25-1000", "25R 500", "25r500", "47/74 200", "25,52 1,000", "၂၅ ၁၀၀၀",
//   "အပူး 300" (P), "3အပါ 1500" / "2ပါ 100" (3P / 2P), "1ဘရိတ် 200" (1B), "1/5 အပါ 100" (1P and 5P).
// Header lines — the bare numbers on the lines under them take their unit:
//   "R 3100" / "R300": each number as one R card at that unit (16 -> 16R); a double gets the
//   unit twice (11 -> 11 at 600); "300R100": each number at 300 and its reverse at 100.
// Lines that don't fit come back in `skipped`.
import { parseEntry, uniquePermutations } from '../entryPatterns.js';

const PASTE_WORDS = [
  ['စုံပူး', ' SP '], ['မပူး', ' MP '], ['အပူး', ' DOUBLES '], ['ညီကို', ' N '], ['ပါဝါ', ' W '],
  ['နက္ခက်', ' K '], ['ထွိုင်', ' T '], ['စုံစုံ', ' SS '], ['စုံမ', ' SM '], ['မစုံ', ' MS '], ['မမ', ' MM '],
  ['ဘရိတ်', 'B'], ['အပါ', 'P'], ['ပါ', 'P'], ['စုံ', 'S'],
];
const MY_DIGITS = '၀၁၂၃၄၅၆၇၈၉';

export function parsePastedBets(text, digits) {
  const bets = [];
  const skipped = [];
  const plain = /^\d+$/;
  const isNumber = (t) => t.length === digits && plain.test(t);
  const glued = new RegExp(`^(\\d{${digits}}R{1,2})(\\d+)$`);

  const tokensOf = (original) => {
    let line = [...original].map((c) => { const i = MY_DIGITS.indexOf(c); return i >= 0 ? String(i) : c; }).join('');
    for (const [word, code] of PASTE_WORDS) line = line.split(word).join(code);
    line = line.toUpperCase();
    // "1,000" / "10,000" at the end of a line is one amount, not two numbers.
    line = line.replace(/(\d{1,3}(?:,\d{3})+)\s*(KS|ကျပ်)?\s*$/, (_, a) => a.replace(/,/g, ''));
    line = line.replace(/\((\d+)\)/g, ' '); // "(20)" counts in shared slips
    const tokens = [];
    for (const t of line.split(/[^0-9A-Z*]+/).filter(Boolean)) {
      const g = glued.exec(t);
      const last = tokens[tokens.length - 1];
      if (g && !/^\d+R\d+$/.test(t)) {
        tokens.push(g[1], g[2]); // "25RR500" -> "25RR", "500"
      } else if ((t === 'R' || t === 'RR') && last != null && plain.test(last)) {
        tokens[tokens.length - 1] = `${last}${t}`; // "25 R 500"
      } else if (['P', 'B', 'S', 'M'].includes(t) && last != null && /^\d$/.test(last)) {
        // "1/5 P 100" -> 1P, 5P: the suffix goes on every single digit just before it.
        for (let i = tokens.length - 1; i >= 0 && /^\d$/.test(tokens[i]); i--) tokens[i] = `${tokens[i]}${t}`;
      } else {
        tokens.push(t === 'DOUBLES' ? 'P' : t);
      }
    }
    return tokens;
  };

  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const tokenLines = lines.map(tokensOf);
  const nextIsBareNumber = (i) => i + 1 < tokenLines.length && tokenLines[i + 1].length === 1 && isNumber(tokenLines[i + 1][0]);

  let straight = null; // current header: unit for the number itself
  let reverse = null; //  ... and for its reverse
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    let tokens = tokenLines[i];
    const rx = tokens.length === 1 ? /^(\d+)R(\d+)$/.exec(tokens[0]) : null;
    const rOnly = tokens.length === 1 ? /^R(\d+)$/.exec(tokens[0]) : null;
    if (tokens.length === 2 && tokens[0] === 'R' && plain.test(tokens[1])) {
      straight = reverse = Number(tokens[1]);
      continue;
    }
    if (rOnly) {
      straight = reverse = Number(rOnly[1]);
      continue;
    }
    if (rx && (rx[1].length !== digits || nextIsBareNumber(i))) {
      straight = Number(rx[1]);
      reverse = Number(rx[2]);
      continue;
    }
    if (rx) tokens = [`${rx[1]}R`, rx[2]]; // not a header: "25R500" = 25R at 500
    if (tokens.length === 1 && isNumber(tokens[0]) && straight != null) {
      const n = tokens[0];
      const others = uniquePermutations(n).filter((p) => p !== n).sort();
      if (!others.length) {
        if (straight + reverse > 0) bets.push({ key: n, unit: straight + reverse });
      } else if (straight === reverse) {
        if (straight > 0) bets.push({ key: `${n}R`, unit: straight });
      } else {
        if (straight > 0) bets.push({ key: n, unit: straight });
        for (const p of others) if (reverse > 0) bets.push({ key: p, unit: reverse });
      }
      continue;
    }
    // A full line ends the header block.
    if (tokens.length < 2 || !plain.test(tokens[tokens.length - 1])) {
      if (/\d/.test(original)) skipped.push(original);
      continue;
    }
    const unit = Number(tokens[tokens.length - 1]);
    const keys = tokens.slice(0, -1);
    if (unit <= 0 || keys.some((k) => parseEntry(k, digits).error)) {
      skipped.push(original);
      continue;
    }
    straight = reverse = null;
    for (const k of keys) bets.push({ key: k, unit });
  }
  return { bets, skipped };
}

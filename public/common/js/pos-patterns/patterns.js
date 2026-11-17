// Copy of online-web/src/patterns.js — keep the two in sync.
// Myanmar display names for pattern keys — used both in the Sale Digit Display table and on
// the printed/imaged slip, so the wording stays identical wherever a pattern key is shown.
// R/RR and the *-wildcards have no conventional Myanmar name in this business's usage, so they
// stay as-is.
const PATTERN_LABELS = {
  W: 'ပါဝါ',
  SP: 'စုံပူး',
  MP: 'မပူး',
  SM: 'စုံမ',
  MM: 'မမ',
  MS: 'မစုံ',
  SS: 'စုံစုံ',
  P: 'အပူး',
  K: 'နက္ခက်',
  N: 'ညီကို',
  T: 'ထွိုင်'
};

export function patternLabel(key) {
  if (!key) return key;
  if (PATTERN_LABELS[key]) return PATTERN_LABELS[key];
  if (/^\d{3,}A$/.test(key)) return key.slice(0, -1);
  let m;
  if ((m = /^(\d+)P$/.exec(key))) return `${m[1]}အပါ`;
  if ((m = /^(\d+)S$/.exec(key))) return `${m[1]}စုံ`;
  if ((m = /^(\d+)M$/.exec(key))) return `${m[1]}မ`;
  if ((m = /^(\d+)B$/.exec(key))) return `${m[1]} ဘရိတ်`;
  return key;
}

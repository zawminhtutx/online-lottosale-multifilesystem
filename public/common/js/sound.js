// Sale-page feedback (same wavs as the user web betting screen). Best-effort: a blocked
// autoplay must never interrupt entry.
const SRC = {
  digitEntry: '/common/sounds/digit_entry.wav',
  brakLimit: '/common/sounds/brak_limit.wav',
  checkOut: '/common/sounds/check_out.wav',
  click: '/common/sounds/click.wav',
  ho: '/common/sounds/ho.wav',
};

export function playSound(name) {
  const src = SRC[name];
  if (!src) return;
  try {
    new Audio(src).play().catch(() => {});
  } catch {
    // ignore
  }
}

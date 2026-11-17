// Entry feedback sounds (same files as the POS app). Best-effort only: a browser blocking
// autoplay must never interrupt betting.
import digitEntry from './assets/sounds/digit_entry.wav';
import brakLimit from './assets/sounds/brak_limit.wav';
import checkOut from './assets/sounds/check_out.wav';
import click from './assets/sounds/click.wav';
import ho from './assets/sounds/ho.wav';

const SOUNDS = { digitEntry, brakLimit, checkOut, click, ho };
const BUTTONS = 'button, .btn, [role="button"], .tile';

export function playSound(name) {
  const src = SOUNDS[name];
  if (!src) return;
  try {
    new Audio(src).play().catch(() => {});
  } catch {
    // ignore
  }
}

// Hover and click feedback on every button, like the POS app.
export function initButtonSounds() {
  let hovered = null;
  // No hover sound on a touch screen, where a tap also fires mouseover.
  const touch = window.matchMedia?.('(hover: none)').matches;
  document.addEventListener('mouseover', (e) => {
    if (touch) return;
    const btn = e.target.closest?.(BUTTONS);
    if (!btn || btn === hovered || btn.disabled) return;
    hovered = btn;
    playSound('ho');
  });
  document.addEventListener('mouseout', (e) => {
    if (hovered && !hovered.contains(e.relatedTarget)) hovered = null;
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.(BUTTONS);
    if (btn && !btn.disabled) playSound('click');
  });
}

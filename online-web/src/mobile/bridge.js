// Talking to the app that hosts this page as a mini app (the soccer app's WebView). The host adds a
// JavaScript channel named LottoBridge; messages are JSON strings:
//   page -> host  { id, type: 'print', png: <base64>, auto }   print this slip picture on the
//                                                              host's Bluetooth printer (auto: sent
//                                                              on save — the host prints it only if
//                                                              its "print on save" setting is on)
//   host -> page  window.lottoBridgeReply(id, ok, message)     the result of a request
//   host -> page  window.lottoBack() -> 'handled' | 'exit'     the phone's back button
// Outside such an app none of this exists and the page prints / goes back as a browser does.
import { onlineSlipBlob, printOnlineSlip } from '../onlinePrint.js';

const channel = () => (typeof window !== 'undefined' ? window.LottoBridge : null);
export const hasHost = () => !!channel()?.postMessage;

let nextId = 0;
const waiting = new Map();
if (typeof window !== 'undefined') {
  window.lottoBridgeReply = (id, ok, message) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (ok) w.resolve(message);
    else w.reject(new Error(message || 'Print မထွက်ပါ'));
  };
}

function request(body, timeoutMs = 60000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    setTimeout(() => { if (waiting.delete(id)) reject(new Error('App မှ အဖြေ မရပါ')); }, timeoutMs);
    channel().postMessage(JSON.stringify({ id, ...body }));
  });
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Prints a slip (onlinePrint.js args). In the host app: its Bluetooth printer; resolves 'skipped'
// when an automatic print is turned off there. In a browser: the print agent / print dialog.
export async function printSlip(args, { auto = false } = {}) {
  if (!hasHost()) return printOnlineSlip(args);
  return request({ type: 'print', png: await toBase64(await onlineSlipBlob(args)), auto });
}

// Leaves the mini app (back to the host app's own screen).
export function closeHost() {
  if (hasHost()) channel().postMessage(JSON.stringify({ id: ++nextId, type: 'close' }));
}

// The phone's back button (from the host): the screen on show registers what its ← does.
let backHandler = null;
export function setBackHandler(fn) {
  backHandler = fn;
  return () => { if (backHandler === fn) backHandler = null; };
}
if (typeof window !== 'undefined') {
  window.lottoBack = () => {
    // An open dialog / sheet closes first (each one closes on Escape or its ✕ / backdrop).
    const close = document.querySelector('.modal-close, .m-backdrop');
    if (close) { close.click(); return 'handled'; }
    if (!backHandler) return 'exit';
    backHandler();
    return 'handled';
  };
}

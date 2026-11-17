// Prints an online slip with the POS slip renderer (./print/slip.js), so paper width, layout,
// company name/logo and footer follow this device's Slip Printer Settings.
//
// With a Slip Printer set and a POS server running on this machine, the slip goes straight to that
// printer (no dialog). Otherwise it prints from a hidden iframe — not window.open(), because
// printing right after an async save is no longer a direct click and browsers block the popup.
import { buildSlipText, getSlipVoucherBlob } from './print/slip.js';
import { getSlipBranding, getSlipPrinterName, getSlipWidth, printServerApi } from './print/settings.js';
import { parseDate } from './format.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function printImageInIframe(dataUrl, width) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Slip</title><style>
    @page { size: ${width} auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { width: ${width}; margin: 0; padding: 0; }
    img { width: 100%; display: block; }
  </style></head><body><img src="${dataUrl}" /></body></html>`);
  doc.close();
  const img = doc.querySelector('img');
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  if (img.complete) setTimeout(go, 50);
  else img.onload = go;
}

// Grouped lines ({ input, numbers, unit }) of a saved ticket, from its ticket_groups — so "45R" or
// "1P" prints as one line, like the Sale page's cart.
export function ticketLines(ticket) {
  const groups = new Map((ticket.groups ?? []).map((g) => [g.id, { input: g.input, numbers: [], unit: g.units }]));
  const lines = [];
  for (const item of ticket.items) {
    const group = item.group_id != null ? groups.get(item.group_id) : null;
    if (group) {
      if (!group.numbers.length) lines.push(group);
      group.numbers.push(item.number);
    } else {
      lines.push({ input: item.number, numbers: [item.number], unit: item.units });
    }
  }
  return lines;
}

// ticket: POST /tickets or GET /tickets/:id result (with items).
// term: { id, description, unit_price }. lines: grouped lines (see ticketLines) for grouped
// printing; omitted -> item by item.
function slipSale({ ticket, term, user, copy = 1 }) {
  const typeCodes = [...new Set(ticket.items.map((i) => (String(i.number).length === 3 ? '3D' : '2D')))];
  return {
    customerid: user.username,
    termid: term.id,
    term_desc: term.description,
    term_unitprice: term.unit_price,
    datetime: parseDate(ticket.created_at) ?? new Date(),
    slipno: `S${term.id}-${ticket.slip_no}`,
    slipcopy: copy,
    machineid: 'ONLINE',
    type_desc: typeCodes.sort().join(' / '),
    items: ticket.items.map((i) => ({ number: i.number, unit: i.units })),
  };
}
const cartLinesOf = (lines) => lines?.map((l) => ({ key: l.input, numbers: l.numbers, unit: l.unit }));

// The slip as a PNG (same layout as the printout) — for View, Send Image and Save.
export function onlineSlipBlob(args) {
  return getSlipVoucherBlob(slipSale(args), cartLinesOf(args.lines));
}

// The slip as plain text (same content as the printout) — for Send SMS.
export function onlineSlipText(args) {
  return buildSlipText(slipSale(args), cartLinesOf(args.lines));
}

// Printing never involves the online server: the copy number ("Copy (n)" on paper) is counted in
// this browser, per slip.
const copyKey = (ticketId) => `online_print_copies_${ticketId}`;
export function printCopies(ticketId) {
  try { return Number(localStorage.getItem(copyKey(ticketId))) || 0; } catch { return 0; }
}
export function nextPrintCopy(ticketId) {
  const n = printCopies(ticketId) + 1;
  try { localStorage.setItem(copyKey(ticketId), String(n)); } catch { /* counted for this print only */ }
  return n;
}

export async function printOnlineSlip(args) {
  return printImage(await blobToDataUrl(await onlineSlipBlob(args)));
}

// Sends a receipt image to the chosen Slip Printer through the local print agent / POS server on
// this machine (no dialog), else to the browser's print dialog. Resolves to 'direct' or 'dialog'.
export async function printImage(dataUrl) {
  const width = getSlipWidth();
  const printerName = getSlipPrinterName();
  if (printerName) {
    try {
      await printServerApi('/print-image', { method: 'POST', body: { printer: printerName, imageBase64: dataUrl, paperWidth: width } });
      return 'direct';
    } catch (e) {
      console.warn('Direct print unavailable, using the print dialog:', e.message);
    }
  }
  printImageInIframe(dataUrl, width);
  return 'dialog';
}

// စာရင်းများ (my reports) drawn as a receipt image (PNG data URL): header, one block per term, then
// the totals. Shown as a preview first; printImage() prints it. rows: GET /reports/mine rows.
// totals: { tickets, gross, discount, net, win, result }.
export function renderOnlineReport({ user, filterLabel, rows, totals, gameLabel = {}, statusLabel = {} }) {
  const widthMm = Number.parseInt(getSlipWidth(), 10) || 80;
  const scale = 2;
  const pxW = Math.round(widthMm * 8 * scale); // ~203 dpi thermal head
  const pad = 10 * scale;
  const font = (px, bold) => `${bold ? '700 ' : ''}${px * scale}px 'Myanmar Text', 'Padauk', sans-serif`;
  const branding = getSlipBranding();
  const money = (n) => Number(n ?? 0).toLocaleString('en-US');
  const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;

  // Build the lines first ({ left, right, size, bold, align, rule }), then measure and draw.
  const lines = [];
  const add = (line) => lines.push({ size: 15, ...line });
  add({ left: branding.companyName || 'Online Lotto', size: 18, bold: true, align: 'center' });
  add({ left: `စာရင်းများ · ${filterLabel}`, bold: true, align: 'center' });
  add({ left: `${user.username}${user.name ? ` (${user.name})` : ''}`, size: 13, align: 'center' });
  add({ left: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), size: 13, align: 'center' });
  add({ rule: true });
  if (!rows.length) add({ left: 'စာရင်း မရှိသေးပါ', align: 'center' });
  for (const r of rows) {
    add({ left: r.description, right: gameLabel[r.game] ?? r.game, bold: true });
    add({ left: `စလစ် ${r.tickets} · ထိုးငွေ`, right: money(r.net), size: 14 });
    add({ left: 'ဆုငွေ', right: r.win ? money(r.win) : '—', size: 14 });
    add({ left: 'အမြတ်/အရှုံး', right: r.status === 'settled' ? signed(r.result) : (statusLabel[r.status] ?? r.status), size: 14 });
    add({ rule: true, light: true });
  }
  add({ left: 'စုစုပေါင်း', bold: true });
  add({ left: 'စလစ်', right: money(totals.tickets) });
  add({ left: 'စုစုပေါင်း', right: money(totals.gross) });
  if (totals.discount) add({ left: 'ကော်', right: money(totals.discount) });
  add({ left: 'ထိုးငွေ', right: money(totals.net) });
  add({ left: 'ဆုငွေ', right: money(totals.win) });
  add({ left: 'အမြတ်/အရှုံး', right: signed(totals.result), bold: true, size: 16 });

  const lineH = (l) => (l.rule ? 10 * scale : Math.round(l.size * scale * 1.6));
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = lines.reduce((h, l) => h + lineH(l), pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textBaseline = 'middle';
  let y = pad;
  for (const l of lines) {
    const h = lineH(l);
    if (l.rule) {
      ctx.lineWidth = l.light ? 1 : 2;
      ctx.setLineDash(l.light ? [4 * scale, 3 * scale] : []);
      ctx.beginPath();
      ctx.moveTo(pad, y + h / 2);
      ctx.lineTo(pxW - pad, y + h / 2);
      ctx.stroke();
    } else {
      ctx.font = font(l.size, l.bold);
      if (l.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(l.left, pxW / 2, y + h / 2, pxW - pad * 2);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(l.left ?? '', pad, y + h / 2, (pxW - pad * 2) * (l.right != null ? 0.62 : 1));
        if (l.right != null) {
          ctx.textAlign = 'right';
          ctx.fillText(String(l.right), pxW - pad, y + h / 2, (pxW - pad * 2) * 0.36);
        }
      }
    }
    y += h;
  }
  return canvas.toDataURL('image/png');
}

// Slip image renderer — the POS app's print.js slip code (buildSlipModel / layoutSlip /
// renderSlipImage / getSlipVoucherBlob), copied unchanged so online slips print exactly like
// POS slips. Settings come from ./settings.js.
import { getSlipLayout, getSlipWidth } from './settings.js';
import { patternLabel } from '../patterns.js';

function fmt(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Builds a printer-agnostic description of the slip's lines, shared by both the plain-HTML
// renderer and the canvas/image renderer below.
function buildSlipModel(sale, cartLines, layout) {
  const useGroups = layout.groupPrint && Array.isArray(cartLines) && cartLines.length > 0;
  const model = [];

  if (layout.logoDataUrl) model.push({ t: 'image', src: layout.logoDataUrl });
  model.push({ t: 'center', text: layout.companyName, bold: true });
  model.push({ t: 'spacer' });
  model.push({ t: 'pair', left: sale.customerid || '-', right: sale.term_desc || `#${sale.termid}`, bold: true });
  const dateText = new Date(sale.datetime).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
  model.push({ t: 'pair', left: dateText, right: `Copy (${sale.slipcopy || 1})` });
  // The stored slipno is "S<termid>-<5-digit seq>" (globally unique so concurrent machines
  // never collide) — the slip only needs the trailing sequence, shown as 4 digits.
  const slipSeq = /(\d+)$/.exec(sale.slipno || '')?.[1];
  const slipDisplay = slipSeq ? String(Number(slipSeq)).padStart(4, '0') : (sale.slipno || '-');
  model.push({ t: 'pair', left: `Slip:${slipDisplay}`, right: `Host:${sale.machineid || '-'}` });
  model.push({ t: 'hr' });
  model.push({ t: 'spacer' });

  // Items are printed as a type-name header line followed by compact "Label   Unit" entries —
  // e.g. "ပါဝါ   100" — packed 1-per-line (single column) or 2-per-line separated by "|" (two
  // column), unit only, never a split unit/amount per line — the Total/Amount lines below cover
  // that at the slip level instead.
  model.push({ t: 'left', text: sale.type_desc ? `[${sale.type_desc}]` : '' });
  let entries;
  if (useGroups) {
    // per-number unit, not the group's total across all its numbers — e.g. "1P" (19 numbers)
    // at 300 each prints "1P   300", never "1P   5700".
    // Raw digit-combo entries (e.g. "123" -> 11,12,13,21,...) are the one exception to grouped
    // printing: they stay grouped on screen (SalePage cart / Slips detail table), but here —
    // print, and the SMS/Image Send-To options, which share this same model — each number
    // prints on its own line instead of one combined "123" line, since a bare digit string is
    // meaningless as a group label (unlike "45R" or "1P", which do mean something on paper).
    entries = [];
    for (const l of cartLines) {
      const isDigitCombo = (l.numbers?.length || 0) > 1 && /^\d+-?$/.test(l.key || '');
      if (isDigitCombo) {
        for (const num of l.numbers) entries.push({ label: num, unit: fmt(l.unit) });
      } else {
        entries.push({
          label: l.key ? patternLabel(l.key) : (l.numbers?.[0] || '-'),
          unit: fmt(l.unit)
        });
      }
    }
  } else {
    entries = (sale.items || []).map((it) => ({ label: it.number, unit: fmt(it.unit) }));
  }
  model.push({ t: 'items', cols: layout.columns === 'two' ? 2 : 1, entries });

  // Total = every number's raw unit summed. Amount = that total multiplied by the term's unit
  // price — the only place price enters the printed slip; items themselves never show it.
  if (layout.showTotal || layout.showAmount) {
    model.push({ t: 'hr' });
    const totalUnits = useGroups
      ? cartLines.reduce((s, l) => s + l.unit * (l.numbers?.length || 1), 0)
      : (sale.items || []).reduce((s, it) => s + it.unit, 0);
    if (layout.showTotal) model.push({ t: 'total', label: 'Total:', value: fmt(totalUnits) });
    if (layout.showAmount) {
      const unitprice = Number(sale.term_unitprice) || 1;
      model.push({ t: 'total', label: 'Amount:', value: fmt(totalUnits * unitprice) });
    }
  }
  if (layout.footerText) {
    model.push({ t: 'footer', text: layout.footerText });
  }
  return model;
}

// Draws the slip onto a <canvas> using the browser's own Myanmar-script font rendering, then
// prints the resulting bitmap instead of live text. This sidesteps thermal/ESC-POS printers
// that can't render Myanmar Unicode glyphs correctly even though the browser preview looks fine.
// Walks the model once, drawing onto `ctx` if given (real pass) or just accumulating the y
// cursor if `ctx` is null (measure pass) — the two passes share one code path so the canvas
// height computed by the measure pass always exactly matches what the draw pass produces.
function layoutSlip(model, geom, ctx, images) {
  const { pxW, marginPx, itemsMarginPx, fontPx, lineH, bold, fontFamily, logoWidthPx } = geom;
  let y = marginPx + fontPx;

  // Printed at the user's own chosen width (geom.logoWidthPx, from Logo Width (mm) in Slip
  // Printer Settings), height following automatically to keep the image's own aspect ratio;
  // still capped to the paper width so an oversized setting can't run off the edge. Centered
  // above the company name.
  const drawImage = (src) => {
    const img = images?.get(src);
    if (!img || !img.naturalWidth) return;
    const w = Math.min(logoWidthPx, pxW - marginPx * 2);
    const h = img.naturalHeight * (w / img.naturalWidth);
    if (ctx) ctx.drawImage(img, (pxW - w) / 2, y, w, h);
    y += h + lineH * 0.7;
  };

  const setFont = (b, scale = 1) => {
    if (ctx) ctx.font = `${(bold || b) ? '700 ' : ''}${Math.round(fontPx * scale)}px ${fontFamily}`;
  };
  const drawCenter = (text, boldLine) => {
    setFont(boldLine);
    if (ctx) { ctx.textAlign = 'center'; ctx.fillText(text, pxW / 2, y); }
    y += lineH;
  };
  const drawLeft = (text, boldLine) => {
    setFont(boldLine);
    if (ctx) { ctx.textAlign = 'left'; ctx.fillText(text, marginPx, y); }
    y += lineH;
  };
  const drawHr = () => {
    y += lineH * 0.15;
    if (ctx) {
      ctx.save();
      ctx.setLineDash([geom.scale * 2, geom.scale * 2]);
      ctx.beginPath();
      ctx.moveTo(marginPx, y);
      ctx.lineTo(pxW - marginPx, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = geom.scale;
      ctx.stroke();
      ctx.restore();
    }
    y += lineH * 0.5;
  };
  const drawRow = (left, right, boldLine) => {
    setFont(boldLine);
    if (ctx) {
      ctx.textAlign = 'left';
      ctx.fillText(left, marginPx, y);
      ctx.textAlign = 'right';
      ctx.fillText(right, pxW - marginPx, y);
    }
    y += lineH;
  };
  for (const m of model) {
    if (m.t === 'image') drawImage(m.src);
    else if (m.t === 'center') drawCenter(m.text, m.bold);
    else if (m.t === 'left') drawLeft(m.text, m.bold);
    else if (m.t === 'hr') drawHr();
    else if (m.t === 'spacer') y += lineH * 0.4;
    else if (m.t === 'pair') drawRow(m.left, m.right, m.bold);
    else if (m.t === 'items') {
      setFont(false);
      const contentRight = pxW - marginPx;
      const gapPx = Math.round(6 * geom.scale);
      const oneCol = m.cols < 2;
      // two-column mode splits the row into two slots with a small gap between them for the
      // divider; single-column mode uses the whole row as one slot
      const slotW = oneCol ? (contentRight - itemsMarginPx) : (contentRight - itemsMarginPx - gapPx) / 2;
      const slot1 = { left: itemsMarginPx, right: itemsMarginPx + slotW };
      const slot2 = { left: slot1.right + gapPx, right: contentRight };
      const dividerX = slot1.right + gapPx / 2;
      const drawEntry = (entry, slot) => {
        if (!entry || !ctx) return;
        ctx.textAlign = 'left';
        ctx.fillText(entry.label, slot.left, y);
        ctx.textAlign = 'right';
        ctx.fillText(entry.unit, slot.right, y);
      };
      for (let i = 0; i < m.entries.length; i += m.cols) {
        const pair = m.entries.slice(i, i + m.cols);
        // number sticks to the left edge of its slot, unit sticks to the right edge —
        // consistent whether it's the first line or one further down
        drawEntry(pair[0], slot1);
        if (pair[1]) {
          if (ctx) { ctx.textAlign = 'center'; ctx.fillText('|', dividerX, y); }
          drawEntry(pair[1], slot2);
        }
        y += lineH;
      }
    } else if (m.t === 'total') {
      y += lineH * 0.15;
      drawRow(m.label, m.value, true);
    } else if (m.t === 'footer') {
      drawCenter(m.text, false);
    }
  }

  return y;
}

// Resolves once the image has decoded (or immediately fails so a broken/corrupt logo can't hang
// the whole print) — data: URLs still load asynchronously via the element's load event.
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Preloads every {t:'image'} entry's source once, ahead of both layoutSlip passes — the model
// items already loaded and un-resolvable ones just get skipped by layoutSlip's own guard.
async function preloadModelImages(model) {
  const images = new Map();
  const sources = [...new Set(model.filter((m) => m.t === 'image').map((m) => m.src))];
  await Promise.all(sources.map(async (src) => {
    const img = await loadImage(src);
    if (img) images.set(src, img);
  }));
  return images;
}

async function renderSlipImage(model, layout, widthMm, fontSizePx, bold) {
  const SCALE = 3;
  const DPI = 96;
  const pxW = Math.round((widthMm * DPI / 25.4) * SCALE);
  const marginMm = layout.marginMm ?? 1.6;
  const marginPx = Math.round((marginMm * DPI / 25.4) * SCALE);
  const itemsMarginPx = marginPx + Math.round(((layout.itemsExtraMarginMm ?? 0) * DPI / 25.4) * SCALE);
  const fontPx = Math.round(fontSizePx * SCALE);
  const lineH = Math.round(fontPx * 1.55);
  const logoWidthPx = Math.round(((layout.logoWidthMm ?? 20) * DPI / 25.4) * SCALE);
  const geom = { pxW, marginPx, itemsMarginPx, fontPx, lineH, bold, fontFamily: "'Myanmar Text', 'Padauk', sans-serif", scale: SCALE, logoWidthPx };

  const images = await preloadModelImages(model);
  const finalY = layoutSlip(model, geom, null, images);

  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = Math.round(finalY + marginPx);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  layoutSlip(model, geom, ctx, images);
  return canvas.toDataURL('image/png');
}

// PNG blob of the slip in the exact printer-print layout, for the Viber/Telegram Send-To
// options — same rendering path as printSlip(), just returned as a shareable file instead of
// being sent to a printer.
export async function getSlipVoucherBlob(sale, cartLines) {
  const width = getSlipWidth();
  const layout = getSlipLayout();
  const baseSize = width === '58mm' ? 14 : 16;
  const sizeAdj = { small: -1, normal: 0, large: 2 }[layout.fontSize] ?? 0;
  const fontSizePx = baseSize + sizeAdj;
  const model = buildSlipModel(sale, cartLines, layout);
  const widthMm = width === '58mm' ? 58 : 80;
  const dataUrl = await renderSlipImage(model, layout, widthMm, fontSizePx, layout.bold);
  const res = await fetch(dataUrl);
  return res.blob();
}

// Walks the same printer-agnostic model used for the image so the Send-To text option can
// never drift out of sync with what the printed/voucher image actually shows.
function modelToText(model) {
  const lines = [];
  for (const m of model) {
    if (m.t === 'center') lines.push(m.text);
    else if (m.t === 'left') { if (m.text) lines.push(m.text); }
    else if (m.t === 'hr') lines.push('------------------------');
    else if (m.t === 'pair') lines.push(`${m.left}   ${m.right}`);
    else if (m.t === 'items') {
      // packs entries m.cols-per-line, same as the printed image's two-column layout, instead
      // of always one per line regardless of the Slip Layout column setting.
      for (let i = 0; i < m.entries.length; i += m.cols) {
        const pair = m.entries.slice(i, i + m.cols).filter(Boolean);
        lines.push(pair.map((e) => `${e.label} ${e.unit}`).join('  |  '));
      }
    } else if (m.t === 'total') lines.push(`${m.label} ${m.value}`);
    else if (m.t === 'footer') lines.push(m.text);
  }
  return lines.join('\n');
}

// Text version of the slip, for the "Text Message" Send-To option — built from the exact same
// model as the printed/voucher image.
export function buildSlipText(sale, cartLines) {
  const model = buildSlipModel(sale, cartLines, getSlipLayout());
  return modelToText(model);
}

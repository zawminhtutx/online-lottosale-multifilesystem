// "All delete" on the Terms page: wipe every term, folder and slip (the sales records), but only
// after a backup — 1. Excel (.xlsx, every slip and number) and 2. PDF (per-term summary, printed by
// the browser so Myanmar text is right) — and typing DELETE. The server refuses the delete without
// a fresh Excel export (see src/routes/sales-data.js). Unsettled slips are refunded first.
import { api, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { busy, dateTime, h, money, openModal, toast } from '/common/js/ui.js';

export const openDeleteAll = (done) => openBackupDelete({ done });

// Same backup steps before deleting ONE term (closed / settled / cancelled): Excel + PDF of that
// term, then DELETE /terms/:id with the export token. Its unsettled slips are refunded.
export const openDeleteTerm = (term, done) => openBackupDelete({ term, done });

// Folder delete after Excel + PDF of that ဖိုင် (the "Back up then delete" choice). Skip-backup
// deletes the folder directly from terms.js without this dialog.
export const openDeleteFolder = (folder, done) => openBackupDelete({ folder, done });

async function openBackupDelete({ term = null, folder = null, done }) {
  const q = term ? `?term_id=${term.id}` : folder ? `?folder_id=${folder.id}` : '';
  const summary = await api.get(`/sales-data/summary${q}`);
  if (!term && !folder && summary.terms.some((x) => x.status === 'open')) {
    toast(t('Cannot delete all terms while a term is open'), 'bad');
    return;
  }
  if (folder && summary.terms.some((x) => x.status === 'open')) {
    toast(t('Cannot delete a folder that has open terms'), 'bad');
    return;
  }
  // No sales (slips) → nothing to back up: only typing DELETE is asked.
  const needBackup = summary.slips > 0;
  let exportToken = null;
  let pdfDone = !needBackup;

  const excelBtn = h('button', { type: 'button', class: 'btn' }, `📥 ${t('Download Excel backup')}`);
  const pdfBtn = h('button', { type: 'button', class: 'btn' }, `📄 ${t('Save PDF summary')}`);
  const confirmInput = h('input', { name: 'confirm', autocomplete: 'off', placeholder: 'DELETE', disabled: needBackup });
  const step = (n, label, control, doneEl) => h('div', { class: 'wipe-step' }, h('b', {}, `${n}. ${label}`), control, doneEl);
  const excelDone = h('span', { class: 'muted' });
  const pdfDoneEl = h('span', { class: 'muted' });

  const ready = () => {
    confirmInput.disabled = needBackup && !(exportToken && pdfDone);
    if (confirmInput.disabled) confirmInput.value = '';
  };

  excelBtn.addEventListener('click', () => busy(excelBtn, async () => {
    const res = await fetch(`/api/sales-data/export.xlsx${q}`, { headers: { authorization: `Bearer ${session.get()?.token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    exportToken = res.headers.get('x-export-token');
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'sales-backup.xlsx';
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    excelDone.textContent = `✓ ${name}`;
    ready();
  }).catch(() => {}));

  pdfBtn.addEventListener('click', () => {
    printSummary(summary);
    pdfDone = true;
    pdfDoneEl.textContent = `✓ ${t('Choose "Save as PDF" in the print window')}`;
    ready();
  });

  const notice = term
    ? t('Deletes "{name}" with its {slips} slip(s), results and limits. Wallet history stays. This cannot be undone.', { name: term.description, slips: summary.slips })
    : folder
      ? t('Deletes folder "{name}" with its {terms} term(s) and {slips} slip(s). Wallet history stays. This cannot be undone.',
        { name: folder.name, terms: summary.terms.length, slips: summary.slips })
      : t('Deletes every term, folder and slip ({terms} terms, {folders} folders, {slips} slips). Accounts, balances and wallet history stay. This cannot be undone.',
        { terms: summary.terms.length, folders: summary.folders, slips: summary.slips });
  openModal({
    title: term ? `🗑 ${t('Delete term')} — ${term.description}` : folder ? `🗑 ${t('Delete folder')} — ${folder.name}` : `🗑 ${t('All delete')}`,
    danger: true,
    wide: true,
    submitLabel: term ? t('Delete term') : folder ? t('Delete folder') : t('Delete everything'),
    body: [
      h('div', { class: 'notice notice-warn' }, notice),
      summary.active_slips > 0 && h('p', {}, t('{n} unsettled slip(s) are refunded first: {amount} Ks.', { n: summary.active_slips, amount: money(summary.active_amount) })),
      needBackup && step(1, t('Backup as Excel'), excelBtn, excelDone),
      needBackup && step(2, t('Backup as PDF'), pdfBtn, pdfDoneEl),
      step(needBackup ? 3 : 1, t('Type DELETE to confirm'), confirmInput),
    ],
    onSubmit: async (v) => {
      if (needBackup && (!exportToken || !pdfDone)) throw new Error(t('Make both backups first (Excel and PDF).'));
      if (v.confirm !== 'DELETE') throw new Error(t('Type DELETE to confirm'));
      if (term) {
        const r = await api.del(`/terms/${term.id}`, exportToken ? { export_token: exportToken } : {});
        toast(r.refunded ? t('Term deleted · {amount} Ks refunded', { amount: money(r.refunded) }) : t('Term deleted'));
      } else if (folder) {
        const r = await api.del(`/term-folders/${folder.id}`);
        toast(`${folder.name} · ဖျက်ပြီး (အပါတ်စဥ် ${r.deleted_terms} ခု)`);
      } else {
        const r = await api.del('/sales-data', { ...(exportToken && { export_token: exportToken }), confirm: 'DELETE' });
        toast(t('Deleted {terms} terms and {slips} slips · {amount} Ks refunded', { terms: r.terms, slips: r.slips, amount: money(r.refunded) }));
      }
      done();
    },
  });
}

// Per-term summary in a hidden iframe → the browser's print window, where "Save as PDF" makes the file.
function printSummary(summary) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sum = (k) => summary.terms.reduce((a, r) => a + (r[k] || 0), 0);
  const rows = summary.terms.map((r) => `<tr><td>${esc(r.folder)}</td><td>${esc(r.description)}</td><td>${esc(r.game)}</td>
    <td>${esc(r.status)}</td><td>${esc(r.result || '')}</td><td class="n">${r.slips}</td><td class="n">${money(r.gross)}</td>
    <td class="n">${money(r.discount)}</td><td class="n">${money(r.net)}</td><td class="n">${money(r.payout)}</td></tr>`).join('');
  const frame = h('iframe', { 'aria-hidden': 'true', style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  document.body.append(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sales summary ${esc(dateTime(new Date().toISOString()))}</title><style>
    body { font: 12px 'Myanmar Text', 'Padauk', system-ui, sans-serif; margin: 12mm; }
    h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #555; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
    th { background: #eee; } .n { text-align: right; } tfoot td { font-weight: bold; }
  </style></head><body>
    <h1>Sales summary (အရောင်းစာရင်း)</h1>
    <p>${esc(dateTime(new Date().toISOString()))} · ${summary.terms.length} terms · ${summary.slips} slips · ${summary.items} numbers</p>
    <table><thead><tr><th>ဖိုင်</th><th>အပါတ်စဥ်</th><th>Type</th><th>Status</th><th>ပေါက်ဂဏန်း</th><th class="n">Slips</th>
      <th class="n">Gross</th><th class="n">Discount</th><th class="n">Net</th><th class="n">Payout</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10">—</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="n">${sum('slips')}</td><td class="n">${money(sum('gross'))}</td>
      <td class="n">${money(sum('discount'))}</td><td class="n">${money(sum('net'))}</td><td class="n">${money(sum('payout'))}</td></tr></tfoot></table>
  </body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }, 100);
}

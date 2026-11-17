import { api, session } from '/common/js/api.js';
import { openDeleteAll, openDeleteFolder, openDeleteTerm } from './delete-all.js';
import { t } from '/common/js/i18n.js';
import { badge, busy, confirmDialog, dateTime, dateTimeInput, field, fromLocalInput, h, input, money, mount, openModal, pageHeader, select, table, tabs, toast } from '/common/js/ui.js';

// Draft, drawn and cancelled terms still show under "All"; they just have no tab of their own.
// Shown in Myanmar on the admin dashboard too (see EN in i18n.js).
// 'draft' = auto terms not made Active yet (users don't see them).
const STATUSES = [['all', 'All terms'], ['draft', 'Draft terms'], ['open', 'Open terms'], ['closed', 'Closed terms'], ['settled', 'Settled terms']];

export const loadFolders = () => api.get('/term-folders');

// Folders (ဖိုင်): the strip above the list picks one (#/terms?folder=ID); "All folders" shows every
// term. "Delete folder" erases the folder with its terms (only when none of them has sales).
// A master sees the same list read-only: creating, editing, activating and deleting terms and
// folders (အပါတ်စဥ် settings) is the admin's alone. It opens a term for its own tree's tabs.
export default async function terms(main, { query, rerender }) {
  const role = session.get()?.user?.role;
  const admin = role === 'admin' || role === 'master';
  const status = STATUSES.some(([s]) => s === query.get('status')) ? query.get('status') : 'all';
  const folders = await loadFolders();
  const folder = folders.find((f) => String(f.id) === query.get('folder')) ?? null;
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (folder) params.set('folder_id', folder.id);
  const rows = await api.get(`/terms${params.size ? `?${params}` : ''}`);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const go = (next) => {
    const q = new URLSearchParams();
    const f = next.folder === undefined ? folder?.id : next.folder;
    const s = next.status ?? status;
    if (f) q.set('folder', f);
    if (s !== 'all') q.set('status', s);
    location.hash = `#/terms${q.size ? `?${q}` : ''}`;
  };

  const title = folder ? `📁 ${folder.name}` : t('Terms');
  const subtitle = folder
    ? t('{count} term(s) in this folder', { count: folder.term_count })
    : admin ? t('Draw periods: open betting, set limits, enter results and settle') : t('Draw periods set by the admin');

  mount(main,
    pageHeader(title, subtitle, admin && [
      folder && h('button', { class: 'btn', onclick: () => folderDialog(folder) }, t('Rename')),
      folder && h('button', { class: 'btn btn-danger', onclick: (e) => deleteFolder(folder, e.currentTarget) }, t('Delete folder')),
      // All delete: back up (Excel + PDF), then wipe every term, folder and slip.
      role === 'admin' && h('button', { class: 'btn btn-danger', onclick: () => openDeleteAll(() => go({ folder: null, status: 'all' })).catch((e) => toast(e.message, 'bad')) }, `🗑 ${t('All delete')}`),
      h('button', { class: 'btn', onclick: () => autoTermsDialog().catch((e) => toast(e.message, 'bad')) }, '⚙ Auto အပါတ်စဥ်'),
      h('button', { class: 'btn', onclick: () => folderDialog().catch((e) => toast(e.message, 'bad')) }, t('+ New folder')),
      // Every term lives in a folder, so a folder has to exist first.
      h('button', { class: 'btn btn-primary', disabled: !folders.length, title: folders.length ? null : t('Create a folder first'),
        onclick: () => createTerm(folders, folder) }, t('+ New term'))]),
    admin && !folders.length && h('div', { class: 'notice notice-warn' }, t('Create a folder first (+ New folder); new terms go inside a folder.')),
    h('div', { class: 'folder-bar' },
      h('button', { type: 'button', class: folder ? 'folder-chip' : 'folder-chip active', onclick: () => go({ folder: null }) }, t('All folders')),
      folders.map((f) => h('button', { type: 'button', class: f.id === folder?.id ? 'folder-chip active' : 'folder-chip', onclick: () => go({ folder: f.id }) },
        `📁 ${f.name}`, h('span', { class: 'folder-count' }, f.term_count)))),
    tabs(STATUSES.map(([s, label]) => [s, t(label)]), status, (s) => go({ status: s })),
    table(
      [
        // Headers in Myanmar like the POS (this page is admin-only, so no t()); no # column.
        { label: 'ဖိုင်', render: (x) => folderName.get(x.folder_id) ?? '—' },
        { label: 'အပါတ်စဥ်', render: (x) => h('a', { href: `#/terms/${x.id}` }, x.description) },
        { label: 'အမျိုးအစား', render: (x) => GAME_LABELS[x.game] ?? x.game },
        { label: 'ယူနစ်စျေးနှုန်း', align: 'right', render: (x) => money(x.unit_price) },
        { label: 'ဖွင့်', render: (x) => dateTime(x.open_at) },
        { label: 'ပိတ်', render: (x) => dateTime(x.close_at) },
        { label: 'Draw', render: (x) => dateTime(x.draw_at) },
        // Auto terms start as drafts: "▶ Active" opens one so users can see and bet on it,
        // "⏸ Unactive" hides an Active (open) one from users again.
        { label: 'Status', render: (x) => admin && x.can_manage !== false && ['draft', 'open'].includes(x.status)
            ? h('span', {}, badge(x.status), ' ', h('button', {
                type: 'button', class: x.status === 'draft' ? 'btn btn-primary btn-sm' : 'btn btn-sm',
                onclick: (e) => { e.stopPropagation(); setActive(x, x.status === 'draft', e.currentTarget); },
              }, x.status === 'draft' ? '▶ Active' : '⏸ Unactive'))
            : badge(x.status) },
        admin && { label: '', render: (x) => x.can_manage === false ? '' : h('button', {
            type: 'button', class: 'icon-btn', title: t('Delete term'), 'aria-label': t('Delete term'),
            onclick: (e) => { e.stopPropagation(); deleteTerm(x, e.currentTarget, rerender); },
          }, '🗑') },
      ].filter(Boolean),
      rows,
      { empty: folder ? t('No terms in this folder') : t('No terms'), onRowClick: (x) => (location.hash = `#/terms/${x.id}`) }));

  // A new folder also gets the ⚙ Auto အပါတ်စဥ် terms (one per template) for the chosen day.
  async function folderDialog(current) {
    const templates = current ? [] : await api.get('/term-folders/templates');
    openModal({
      title: current ? t('Rename folder') : t('New folder'),
      body: [
        field(t('Folder name'), input('name', { required: true, maxlength: 60, value: current?.name ?? '', placeholder: t('e.g. October 2026') })),
        !current && templates.length && [
          // One term per template for every day from … to.
          h('div', { class: 'form-grid' },
            field('ရက်စွဲ (မှ)', input('date', { type: 'date', required: true, value: todayIso() })),
            field('ရက်စွဲ (ထိ)', input('date_to', { type: 'date', required: true, value: todayIso() }))),
          h('label', { class: 'check' }, input('auto_terms', { type: 'checkbox', checked: true }),
            ` Auto အပါတ်စဥ် ဆောက်မည် — ရက်တိုင်း ${templates.length} ခု (${templates.map((x) => x.name || x.game).join(', ')})`),
        ],
      ],
      submitLabel: current ? t('Save') : t('Create'),
      onSubmit: async (v) => {
        const saved = current
          ? await api.patch(`/term-folders/${current.id}`, { name: v.name.trim() })
          : await api.post('/term-folders', {
              name: v.name.trim(),
              ...(v.date && { date: v.date, date_to: v.date_to || v.date, tz: utcOffset(), auto_terms: v.auto_terms === 'on' }),
            });
        toast(current ? t('Folder saved') : saved.auto_terms ? `${t('Folder created')} · အပါတ်စဥ် ${saved.auto_terms} ခု` : t('Folder created'));
        if (current) rerender(); else go({ folder: saved.id, status: 'all' });
      },
    });
  }

  // ⚙ Auto အပါတ်စဥ်: the term list a new folder starts with. Each row: name (after the date),
  // type, unit price, open / close / draw time, and break (1 if the admin leaves price/break blank).
  async function autoTermsDialog() {
    const list = await api.get('/term-folders/templates');
    const rows = h('tbody');
    const render = () => {
      rows.replaceChildren(...(list.length
        ? list.map((x, i) => h('tr', {},
            h('td', {}, x.name || '—'), h('td', {}, GAME_LABELS[x.game] ?? x.game), h('td', { class: 'num' }, money(x.unit_price)),
            h('td', {}, x.open), h('td', {}, x.close), h('td', {}, x.draw), h('td', { class: 'num' }, x.unit_break ?? 1),
            h('td', {}, h('button', { type: 'button', class: 'icon-btn', title: t('Delete'), onclick: () => { list.splice(i, 1); render(); } }, '🗑'))))
        : [h('tr', {}, h('td', { colspan: 8, class: 'muted' }, 'စာရင်း မရှိသေးပါ — အောက်မှာ ထည့်ပါ'))]));
    };
    render();
    const name = input('tpl_name', { maxlength: 60, placeholder: 'ဥပမာ AM' });
    const game = select('tpl_game', [['2D', '2D LOTT'], ['3D', '3D']], '2D');
    const price = input('tpl_price', { type: 'number', min: 1, step: 1, value: '1' });
    const open = input('tpl_open', { type: 'time', value: '09:30' });
    const close = input('tpl_close', { type: 'time', value: '11:59' });
    const draw = input('tpl_draw', { type: 'time', value: '12:01' });
    const brk = input('tpl_break', { type: 'number', min: 0, step: 1, value: '1' });
    const addError = h('p', { class: 'form-error' });
    const add = () => {
      addError.textContent = '';
      if (!open.value || !close.value || !draw.value) return (addError.textContent = 'ဖွင့်ချိန်၊ ပိတ်ချိန်၊ Draw ချိန် ရွေးပါ');
      if (!(open.value < close.value && close.value <= draw.value)) return (addError.textContent = 'ဖွင့်ချိန် < ပိတ်ချိန် ≤ Draw ချိန် ဖြစ်ရမည်');
      const unitBreak = brk.value.trim() === '' ? 1 : Number(brk.value);
      if (!Number.isInteger(unitBreak) || unitBreak < 0) return (addError.textContent = 'ဘရိတ် ယူနစ် မှန်အောင် ထည့်ပါ');
      list.push({
        name: name.value.trim(), game: game.value, unit_price: Number(price.value) || 1,
        unit_break: unitBreak, open: open.value, close: close.value, draw: draw.value,
      });
      name.value = '';
      render();
    };
    openModal({
      title: '⚙ Auto အပါတ်စဥ်',
      wide: true,
      body: [
        h('p', { class: 'muted', style: 'margin-top:0' },
          'ဖိုင်အသစ် ဆောက်တာနဲ့ ဒီစာရင်းထဲက တစ်ခုစီအတွက် အပါတ်စဥ် တစ်ခုစီ အလိုအလျောက် ဆောက်ပါမယ် (၂ ခုရှိရင် ၂ ခု၊ ၆ ခုရှိရင် ၆ ခု)။ အမည် = ရက်စွဲ + အမည်။ ယူနစ်စျေးနှုန်း / ဘရိတ် မထည့်ရင် 1။ ဘရိတ် 0 = ကန့်သတ်ချက်မရှိ။ မလိုတဲ့ အပါတ်စဥ်ကို ပြန်ဖျက်နိုင်ပါတယ်။'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, ['အမည်', 'အမျိုးအစား', 'ယူနစ်စျေးနှုန်း', 'ဖွင့်ချိန်', 'ပိတ်ချိန်', 'Draw ချိန်', 'ဘရိတ်', ''].map((x) => h('th', {}, x)))),
          rows)),
        h('div', { class: 'form-grid' },
          field('အမည် (ရက်စွဲနောက်မှာ)', name),
          field('အမျိုးအစား', game),
          field('ယူနစ်စျေးနှုန်း', price),
          field('ဖွင့်ချိန်', open),
          field('ပိတ်ချိန်', close),
          field('Draw ချိန်', draw),
          field('ဘရိတ်', brk, 'ဂဏန်းတစ်လုံး အများဆုံး ယူနစ်။ မထည့်ရင် 1။ 0 = ကန့်သတ်ချက်မရှိ')),
        addError,
        h('button', { type: 'button', class: 'btn', onclick: add }, '＋ စာရင်းထဲ ထည့်ရန်'),
      ],
      submitLabel: t('Save'),
      onSubmit: async () => {
        await api.put('/term-folders/templates', list);
        toast(`Auto အပါတ်စဥ် ${list.length} ခု သိမ်းပြီးပါပြီ`);
      },
    });
  }

  async function setActive(term, active, button) {
    await busy(button, () => api.patch(`/terms/${term.id}`, { status: active ? 'open' : 'draft' })).then(() => {
      toast(`${term.description} · ${active ? 'Active' : 'Unactive'}`);
      rerender();
    }, (e) => toast(e.message, 'bad'));
  }

  // Deletes the folder with its terms. Open terms block it (and All delete). A folder with sales
  // is only allowed once every remaining term is settled. Then: backup (Excel + PDF) then delete,
  // or delete without a backup.
  async function deleteFolder(f, button) {
    const rows = await api.get(`/terms?folder_id=${f.id}`).catch((e) => { toast(e.message, 'bad'); return null; });
    if (!rows) return;
    if (rows.some((t) => t.status === 'open')) return toast(t('Cannot delete a folder that has open terms'), 'bad');
    const finished = new Set(['settled', 'cancelled', 'draft']);
    if (rows.some((t) => !finished.has(t.status)) || rows.some((t) => t.slip_count > 0 && t.status !== 'settled')) {
      return toast(t('Only settled folders can be deleted'), 'bad');
    }
    const mode = await pickFolderDeleteMode(f);
    if (!mode) return;
    if (mode === 'backup') {
      return openDeleteFolder(f, () => go({ folder: null })).catch((e) => toast(e.message, 'bad'));
    }
    const message = `📁 ${f.name} နှင့် အထဲက အပါတ်စဥ် ${f.term_count} ခုကို အပြီးဖျက်မလား? Backup မယူပါ။ ပြန်ယူ၍ မရပါ။`;
    if (!(await confirmDialog(message, { title: t('Delete without backup'), confirmLabel: t('Delete') }))) return;
    await busy(button, () => api.del(`/term-folders/${f.id}`)).then((r) => {
      toast(`${f.name} · ဖျက်ပြီး (အပါတ်စဥ် ${r.deleted_terms} ခု)`);
      go({ folder: null });
    }, (e) => toast(e.message, 'bad'));
  }

  function pickFolderDeleteMode(f) {
    return new Promise((resolve) => {
      let picked = null;
      const dialog = openModal({
        title: t('Delete folder'),
        body: [
          h('p', {}, `📁 ${f.name}`),
          h('p', {}, t('{count} term(s) in this folder', { count: f.term_count })),
          h('p', {}, t('Choose how to delete this folder.')),
          h('div', { class: 'modal-foot', style: 'padding:0;border:0;margin-top:12px;flex-wrap:wrap;gap:8px' },
            h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, t('Cancel')),
            h('button', { type: 'button', class: 'btn', onclick: () => { picked = 'backup'; dialog.close(); } }, t('Back up then delete')),
            h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { picked = 'skip'; dialog.close(); } }, t('Delete without backup'))),
        ],
      });
      dialog.addEventListener('close', () => resolve(picked));
    });
  }
}


// A term with sales (slips) needs an Excel + PDF backup of it first (dialog in delete-all.js); one
// without slips only asks to confirm.
export async function deleteTerm(term, button, done) {
  if (term.slip_count === 0) {
    if (!(await confirmDialog(`"${term.description}" ကို ဖျက်မလား? (စလစ် မရှိပါ)`, { title: t('Delete term'), confirmLabel: t('Delete') }))) return;
    return busy(button, () => api.del(`/terms/${term.id}`)).then(() => { toast(t('Term deleted')); done?.(); }, (e) => toast(e.message, 'bad'));
  }
  return busy(button, () => openDeleteTerm(term, done)).catch(() => {});
}

const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// This computer's UTC offset as +hh:mm (the auto terms' times are local times).
function utcOffset() {
  const m = -new Date().getTimezoneOffset();
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// Terms are 2D or 3D; '2D3D' only exists on terms created before the split and is shown for them.
const GAME_LABELS = { '2D': '2D LOTT', '3D': '3D', '2D3D': '2D + 3D' };

// Required: every term lives in a folder (a placeholder only shows for old terms made without one).
export const folderField = (folders, folderId) =>
  field(t('Folder'), select('folder_id', [...(folderId ? [] : [['', t('Choose a folder')]]), ...folders.map((f) => [f.id, f.name])], folderId ?? '', { required: true }));

export function termFormFields(term = {}, folders = []) {
  const dt = (name) => dateTimeInput(name, term[name] ?? '');
  return h('div', { class: 'form-grid' },
    h('div', { class: 'span-all' }, field(t('Term Name'), input('description', { required: true, value: term.description ?? '', placeholder: t('e.g. 25-09-2026 AM') }))),
    h('div', { class: 'span-all' }, folderField(folders, term.folder_id)),
    field(t('Types'), select('game', [['2D', '2D LOTT'], ['3D', '3D'], ...(term.game === '2D3D' ? [['2D3D', '2D + 3D']] : [])], term.game ?? '2D')),
    field(t('Unit Price'), input('unit_price', { type: 'number', min: 1, step: 1, required: true, value: String(term.unit_price ?? 25) })),
    field(t('Ledger'), dt('open_at'), t('Empty = as soon as status is Open')),
    field(t('Close Time'), dt('close_at'), t('Bets are refused after this time')),
    field(t('Draw time'), dt('draw_at')));
}

export function termPayload(v) {
  return {
    description: v.description.trim(),
    game: v.game,
    unit_price: Number(v.unit_price),
    open_at: fromLocalInput(v.open_at),
    close_at: fromLocalInput(v.close_at),
    draw_at: fromLocalInput(v.draw_at),
    ...(v.folder_id && { folder_id: Number(v.folder_id) }),
  };
}

// Defaults for a new term, from today's date: the morning (AM) session until the AM draw at
// 12:02 PM, the afternoon (PM) session after that.
//   AM: "dd-mm-yyyy AM", opens 9:30 AM, closes 11:59 AM, draw 12:02 PM
//   PM: "dd-mm-yyyy PM", opens 12:30 PM, closes 4:00 PM,  draw 4:30 PM
function newTermDefaults(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const am = now.getHours() * 60 + now.getMinutes() < 12 * 60 + 2;
  const at = (hhmm) => `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${hhmm}`; // dd-mm-yyyy HH:mm, local time
  return {
    description: `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${am ? 'AM' : 'PM'}`,
    game: '2D',
    open_at: at(am ? '09:30' : '12:30'),
    close_at: at(am ? '11:59' : '16:00'),
    draw_at: at(am ? '12:02' : '16:30'),
  };
}

function createTerm(folders, folder) {
  openModal({
    title: t('New term'),
    body: [
      termFormFields({ ...newTermDefaults(), folder_id: (folder ?? folders[0]).id }, folders),
      // The Live Ledger's break, set with the term (later changes: the term's Unit break tab).
      field(t('Break'), input('unit_break', { type: 'number', min: 0, step: 1, value: '0' }), t('Maximum units per number across all tickets. 0 = no limit.')),
    ],
    submitLabel: t('Create'),
    onSubmit: async (v) => {
      const term = await api.post('/terms', { ...termPayload(v), status: 'open', unit_break: Number(v.unit_break) || 0 }); // opens straight away
      toast(t('Term created'));
      location.hash = `#/terms/${term.id}`;
    },
  });
}

import { api, cached, session } from '/common/js/api.js';
import { betTypeName, t } from '/common/js/i18n.js';
import {
  badge, busy, confirmDialog, dateTime, field, formValues, h, input, money, mount, openModal, pageHeader, select, table, tabs, toLocalInput, toast,
} from '/common/js/ui.js';
import { onLive } from '/common/js/live.js';
import { ledgerPanel } from '/common/js/ledger.js';
import { parseEntry } from '/common/js/pos-patterns/entry-patterns.js';
import { exposurePanel, summaryPanel, termBetTypes, ticketTable, twodNumbers } from '/common/js/term-reports.js';
import { deleteTerm, loadFolders, termFormFields, termPayload } from './terms.js';

// POS tab names are in Myanmar on the admin dashboard too (t() leaves Myanmar text as it is).
const TABS = [
  ['ledger', 'Live Ledger'],
  ['limits', 'ဘရိတ်'],
  ['settings', 'Settings'],
  ['userlimits', 'ထိုးသား Max Unit'],
  ['blocked', 'ပိတ်ဂဏန်းများ'],
  ['hot', 'ဟော့ဂဏန်းများ'],
  ['purchase', 'အဝယ်'],
  ['results', 'ပေါက်သီး'],
  ['exposure', 'Exposure'],
  ['tickets', 'စလစ်များ'],
  ['summary', 'စာရင်းကြည့်'],
];
// can_manage (own file, or the admin): every tab — settings, break, max unit, closed numbers,
// hot numbers, purchases, results, slips. A master looking at the shared book, and an agent,
// only get the read tabs. An agent has no per-user Max Unit.
const MASTER_TABS = new Set(['ledger', 'userlimits', 'hot', 'exposure', 'tickets', 'summary']);
const AGENT_TABS = new Set([...MASTER_TABS].filter((k) => k !== 'userlimits'));
const READ_ONLY_FOR_MASTER = new Set(['hot']);

export default async function termDetail(main, { params, query, rerender }) {
  const id = Number(params[0]);
  const cachedUser = session.get()?.user;
  const [term, meta] = await Promise.all([api.get(`/terms/${id}`), cached('/meta')]);
  const manages = !!term.can_manage;
  const admin = cachedUser?.role === 'admin' || manages;
  const viewer = admin ? cachedUser : await api.get('/auth/me');
  if (!admin && viewer) session.set({ ...session.get(), user: viewer });
  const canEditHot = admin || (viewer?.role === 'master' && Number(viewer?.hot_edit) === 1);
  const ownTabs = viewer?.role === 'agent' ? AGENT_TABS : MASTER_TABS;
  const tabList = admin ? TABS : TABS.filter(([k]) => ownTabs.has(k));
  const active = tabList.some(([k]) => k === query.get('tab')) ? query.get('tab') : tabList[0][0]; // opens on the first tab
  const betTypes = termBetTypes(meta.bet_types, term.game); // Unit break / closed numbers / exposure: the term's type only
  const locked = ['drawn', 'settled', 'cancelled'].includes(term.status);

  const content = h('div', {});
  mount(main,
    pageHeader(
      h('span', {}, term.description, ' ', badge(term.status)),
      t('Term #{id} · {game} · {price} Ks per unit · closes {close}', {
        id: term.id, game: term.game, price: money(term.unit_price), close: dateTime(term.close_at),
      }),
      h('a', { class: 'btn', href: term.folder_id ? `#/terms?folder=${term.folder_id}` : '#/terms' }, t('← Back')),
      term.status === 'open' && h('a', { class: 'btn btn-primary', href: `#/sale/${term.id}` }, t('Sale')),
      admin && statusActions(term, rerender),
      admin && h('button', {
        class: 'btn btn-danger', onclick: (e) => deleteTerm(term, e.currentTarget, () => (location.hash = '#/terms')),
      }, t('Delete term'))),
    tabs(tabList.map(([k, label]) => [k, t(label)]), active, (tab) => (location.hash = `#/terms/${id}?tab=${tab}`)),
    content);

  const panels = { settings, ledger, limits, userlimits, blocked, hot, purchase, results, exposure, tickets, summary };
  mount(content, h('div', { class: 'loading' }, t('Loading…')));
  const readOnly = !admin && READ_ONLY_FOR_MASTER.has(active) && !(active === 'hot' && canEditHot);
  mount(content, await panels[active]({ term, betTypes, locked: locked || readOnly, readOnly, rerender }));
}

function statusActions(term, rerender) {
  const change = (status, label, danger = false) => {
    const button = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary' }, label);
    button.addEventListener('click', async () => {
      if (danger && !(await confirmDialog(t('{action} "{name}"?', { action: label, name: term.description }), { confirmLabel: label }))) return;
      await busy(button, () => api.patch(`/terms/${term.id}`, { status }))
        .then(() => { toast(t('Term status: {status}', { status: t(status) })); rerender(); }, () => {});
    });
    return button;
  };
  switch (term.status) {
    case 'draft': return change('open', t('Open betting')); // terms made before drafts were dropped
    // ⏸ Unactive: hide the term from users again (back to "Active မလုပ်ရသေး").
    case 'open': return [change('draft', '⏸ Unactive'), change('closed', t('Close betting'))];
    case 'closed': return [change('open', t('Reopen')), h('a', { class: 'btn btn-primary', href: `#/terms/${term.id}?tab=results` }, t('Enter results'))];
    case 'drawn': return h('a', { class: 'btn btn-primary', href: `#/terms/${term.id}?tab=results` }, t('Review & settle'));
    default: return null;
  }
}

const cardTitle = (title, subtitle) =>
  h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), h('p', { class: 'muted', style: 'margin:4px 0 0' }, subtitle)));

// ---------- panels ----------

async function settings({ term, locked, rerender }) {
  const values = { ...term, open_at: toLocalInput(term.open_at), close_at: toLocalInput(term.close_at), draw_at: toLocalInput(term.draw_at) };
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Save'));
  const form = h('form', { class: 'card' },
    locked && h('div', { class: 'notice notice-warn' }, t('This term is {status}; settings can no longer change.', { status: t(term.status) })),
    termFormFields(values, await loadFolders()),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));
  // A locked term can still be moved to another folder.
  if (locked) form.querySelectorAll('input, select:not([name="folder_id"])').forEach((el) => (el.disabled = true));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form); // a locked term's disabled fields are not in here, only its folder
    await busy(save, () => api.patch(`/terms/${term.id}`, locked ? { folder_id: Number(v.folder_id) } : termPayload(v)))
      .then(() => { toast(t('Term saved')); rerender(); }, () => {});
  });
  return form;
}

// UNITBREAK: max units any single number may take for this term.
function limits({ term, betTypes, locked, rerender }) {
  const current = new Map(term.limits.map((l) => [l.bet_type_id, l.max_units]));
  const save = h('button', { type: 'submit', class: 'btn btn-primary', disabled: locked }, t('Save limits'));
  const form = h('form', { class: 'card' },
    cardTitle(t('Unit break'), t('Maximum units per number across all tickets. 0 = no limit.')),
    table(
      [
        { label: t('Bet type'), render: (bt) => betTypeName(bt) },
        { label: t('Max units per number'), align: 'right', render: (bt) =>
            h('input', { class: 'cell', type: 'number', min: 0, step: 1, name: `max:${bt.id}`, value: String(current.get(bt.id) ?? 0), disabled: locked }) },
        { label: t('Max amount (Ks)'), align: 'right', render: (bt) => current.get(bt.id) ? money(current.get(bt.id) * term.unit_price) : '—' },
      ],
      betTypes),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const rows = betTypes
      .map((bt) => ({ bet_type_id: bt.id, max_units: Number(v[`max:${bt.id}`] || 0) }))
      .filter((r) => r.max_units > 0);
    await busy(save, () => api.put(`/terms/${term.id}/limits`, rows)).then(() => { toast(t('Limits saved')); rerender(); }, () => {});
  });
  return form;
}

// Unit per number — per user, for this term only: the most units one user may bet on one
// number, never above the term's unit break (so the admin tunes both side by side).
async function userlimits({ term, betTypes, locked, rerender }) {
  const [saved, users] = await Promise.all([api.get(`/terms/${term.id}/user-limits`), api.get('/users?role=user')]);
  const breakOf = new Map(term.limits.map((l) => [l.bet_type_id, l.max_units]));
  const typeName = new Map(betTypes.map((bt) => [bt.id, betTypeName(bt)]));
  const manyTypes = betTypes.length > 1;
  let rows = saved.map((r) => ({ user_id: r.user_id, username: r.username, name: r.name, bet_type_id: r.bet_type_id, max_units: r.max_units }));

  const box = h('div', {});
  const userSelect = select('user_id', [], '');
  const typeSelect = manyTypes && select('bet_type_id', betTypes.map((bt) => [bt.id, betTypeName(bt)]), betTypes[0]?.id);
  const unitsInput = input('max_units', { type: 'number', min: 1, step: 1, placeholder: t('Max units'), style: 'width:130px;min-width:0' });
  // Max units starts at the break and may not go above it (0 = no break, no cap).
  const capOf = (typeId) => breakOf.get(typeId) || 0;
  const selectedType = () => Number(typeSelect ? typeSelect.value : betTypes[0]?.id);
  const resetUnits = () => {
    const cap = capOf(selectedType());
    unitsInput.value = cap ? String(cap) : '';
    if (cap) unitsInput.max = String(cap); else unitsInput.removeAttribute('max');
  };
  const overCap = (r) => capOf(r.bet_type_id) > 0 && r.max_units > capOf(r.bet_type_id);
  const overCapMessage = (typeId) => t('Max units cannot be above the break ({n})', { n: money(capOf(typeId)) });
  const addButton = h('button', { type: 'button', class: 'btn', disabled: locked }, t('+ Add'));
  const save = h('button', { type: 'button', class: 'btn btn-primary', disabled: locked }, t('Save limits'));
  const error = h('p', { class: 'form-error', role: 'alert' });
  const breakText = (typeId) => (breakOf.get(typeId) ? money(breakOf.get(typeId)) : t('no limit'));

  const render = () => {
    const taken = new Set(rows.map((r) => `${r.user_id}:${r.bet_type_id}`));
    const typeId = Number(typeSelect ? typeSelect.value : betTypes[0]?.id);
    mount(userSelect, h('option', { value: '' }, t('Select user')),
      users.filter((u) => !taken.has(`${u.id}:${typeId}`)).map((u) => h('option', { value: u.id }, u.username)));
    mount(box, table(
      [
        { label: t('Username'), render: (r) => h('a', { href: `#/users/${r.user_id}` }, r.username) },
        { label: t('Name'), render: (r) => r.name ?? '—' },
        manyTypes && { label: t('Bet type'), render: (r) => typeName.get(r.bet_type_id) ?? r.bet_type_id },
        { label: t('Max units per number'), align: 'right', render: (r) => h('input', {
            class: 'cell', type: 'number', min: 1, step: 1, max: capOf(r.bet_type_id) || null, value: String(r.max_units), disabled: locked,
            oninput: (e) => {
              r.max_units = Number(e.target.value || 0);
              error.textContent = overCap(r) ? overCapMessage(r.bet_type_id) : '';
            },
          }) },
        { label: t('Unit break'), align: 'right', render: (r) => breakText(r.bet_type_id) },
        { label: '', render: (r) => !locked && h('button', {
            type: 'button', class: 'icon-btn', title: t('Remove'), 'aria-label': t('Remove'),
            onclick: () => { rows = rows.filter((x) => x !== r); render(); },
          }, '✕') },
      ].filter(Boolean),
      rows,
      { empty: t('No per-user limits for this term. Only the unit break applies.') }));
  };

  if (typeSelect) typeSelect.addEventListener('change', () => { resetUnits(); render(); });
  addButton.addEventListener('click', () => {
    error.textContent = '';
    const user = users.find((u) => u.id === Number(userSelect.value));
    const units = Number(unitsInput.value);
    const typeId = Number(typeSelect ? typeSelect.value : betTypes[0]?.id);
    if (!user) { error.textContent = t('Select a user'); return; }
    if (!(units > 0)) { error.textContent = t('Enter units above 0'); return; }
    if (capOf(typeId) && units > capOf(typeId)) { error.textContent = overCapMessage(typeId); return; }
    rows.push({ user_id: user.id, username: user.username, name: user.name, bet_type_id: typeId, max_units: units });
    rows.sort((x, y) => x.username.localeCompare(y.username));
    resetUnits();
    render();
  });
  save.addEventListener('click', async () => {
    error.textContent = '';
    const bad = rows.find(overCap);
    if (bad) { error.textContent = `${bad.username}: ${overCapMessage(bad.bet_type_id)}`; return; }
    await busy(save, async () => {
      const body = rows.map(({ user_id, bet_type_id, max_units }) => ({ user_id, bet_type_id, max_units }));
      await api.put(`/terms/${term.id}/user-limits`, body);
      toast(t('Limits saved'));
      rerender();
    }).catch((err) => { error.textContent = err.message; });
  });

  resetUnits();
  render();
  return h('div', { class: 'card' },
    cardTitle(t('Unit per number'), t('Most units one user may bet on one number in this term. It can never be above the unit break ({n}).', { n: breakText(betTypes[0]?.id) })),
    !locked && h('div', { class: 'toolbar' }, userSelect, typeSelect || null, unitsInput, addButton),
    box,
    error,
    h('div', { class: 'form-actions' }, save));
}

// Closed numbers: the admin's own list (saved), plus — automatically — every number whose sales
// have reached the break. Those are refused anyway; they are shown here read-only, kept live, and
// open again by themselves if a slip is cancelled (they are not saved into the closed list).
async function blocked({ term, betTypes, locked, rerender }) {
  const byType = new Map();
  for (const b of term.blocked) byType.set(b.bet_type_id, [...(byType.get(b.bet_type_id) ?? []), b.number]);

  const fullBoxes = new Map(betTypes.map((bt) => [bt.id, h('div', { class: 'full-numbers' })]));
  const loadFull = async () => {
    const full = await api.get(`/terms/${term.id}/full-numbers`);
    for (const bt of betTypes) {
      const numbers = full.filter((f) => f.bet_type_id === bt.id).map((f) => f.number);
      mount(fullBoxes.get(bt.id),
        h('span', { class: 'muted' }, t('Break full (auto): ')),
        numbers.length ? numbers.map((n) => h('span', { class: 'badge badge-bad' }, n)) : h('span', { class: 'muted' }, '—'));
    }
  };
  await loadFull();
  let timer = null;
  const stop = [
    onLive('tickets', (m) => {
      if (!form.isConnected) return stop.forEach((fn) => fn()); // left the page
      if (m.reconnected || m.term_id === term.id) { clearTimeout(timer); timer = setTimeout(() => loadFull().catch(() => {}), 250); }
    }),
    onLive('terms', () => { if (form.isConnected) loadFull().catch(() => {}); }), // break changed
  ];

  const save = h('button', { type: 'submit', class: 'btn btn-primary', disabled: locked }, t('Save closed numbers'));
  const form = h('form', { class: 'card' },
    cardTitle(t('Closed numbers'), t('Numbers that cannot be bet this term. Separate with spaces or commas.')),
    h('div', { class: 'form-grid' },
      betTypes.map((bt) => {
        const box = h('textarea', { name: `blocked:${bt.id}`, rows: 2, disabled: locked, placeholder: bt.digits === 2 ? t('e.g. 00 11 99') : '' },
          (byType.get(bt.id) ?? []).join(' '));
        // ADD CLOSE: type numbers in a dialog; they are added to the box below (Save stores them).
        const add = h('button', { type: 'button', class: 'btn btn-sm', disabled: locked, onclick: () => addNumbersDialog(bt, box, 'ADD CLOSE') }, 'ADD CLOSE');
        return field(t('{name} ({n} digits)', { name: betTypeName(bt), n: bt.digits }),
          h('div', {}, h('div', { style: 'margin-bottom:6px' }, add), box, fullBoxes.get(bt.id)));
      })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const rows = [];
    for (const bt of betTypes) {
      for (const number of new Set((v[`blocked:${bt.id}`] ?? '').split(/[\s,]+/).filter(Boolean))) {
        if (!new RegExp(`^\\d{${bt.digits}}$`).test(number)) {
          form.querySelector('.form-error').textContent =
            t('{name}: "{number}" must be {n} digit(s)', { name: betTypeName(bt), number, n: bt.digits });
          return;
        }
        rows.push({ bet_type_id: bt.id, number });
      }
    }
    await busy(save, () => api.put(`/terms/${term.id}/blocked`, rows))
      .then(() => { toast(t('{n} closed number(s) saved', { n: rows.length })); rerender(); }, () => {});
  });
  return form;
}

// Hot numbers: still open, but on each one a user may bet only this term's hot % of their own
// unit-per-number limit (or of the unit break when they have none).
// ADD HOT / ADD CLOSE dialog: numbers typed here (space / comma separated) are checked for this
// bet type's length and added to the hot / closed number box once each. Saving the form stores them.
// အဝယ် (admin): ကျွံ = units bet on a number − the break − units already bought. Every number over
// the break is listed with a units box filled with its ကျွံ (type more to buy more than that, 0 to
// skip it); ADD puts other numbers / patterns (12R, 2* …) on the list too, like ADD HOT. Saving
// records the purchase: it takes the units off the ကျွံ and, after the result, shows what the
// dealer owes on winners (units × unit price × odds). No wallet moves.
async function purchase({ term, betTypes, rerender }) {
  const data = await api.get(`/terms/${term.id}/purchases`);
  const editable = ['open', 'closed'].includes(data.status);
  const typeName = new Map(betTypes.map((bt) => [bt.id, betTypeName(bt)]));
  const manyTypes = betTypes.length > 1;

  // The lines to buy: every number over the break (units = its ကျွံ), plus numbers added by hand.
  const lines = data.excess.map((r) => ({ ...r, buy: r.excess }));
  const linesBox = h('div', {});
  const renderLines = () => mount(linesBox, table(
    [
      manyTypes && { label: t('Type'), render: (r) => typeName.get(r.bet_type_id) },
      { label: 'ဂဏန်း', render: (r) => h('strong', {}, r.number) },
      { label: 'ထိုးယူနစ်', align: 'right', render: (r) => (r.units === undefined ? '—' : money(r.units)) },
      { label: 'ဘရိတ်', align: 'right', render: (r) => (r.break_units === undefined ? '—' : money(r.break_units)) },
      { label: 'ဝယ်ပြီး', align: 'right', render: (r) => (r.purchased ? money(r.purchased) : '—') },
      { label: 'ကျွံ', align: 'right', render: (r) => (r.excess === undefined ? '—' : h('b', { class: r.excess > 0 ? 'amount-neg' : null }, money(r.excess))) },
      { label: 'ဝယ်မည့် ယူနစ်', align: 'right', render: (r) => h('input', {
          class: 'cell', type: 'number', min: 0, step: 1, value: String(r.buy ?? 0), disabled: !editable,
          oninput: (e) => { r.buy = Math.max(0, Math.floor(Number(e.target.value) || 0)); },
        }) },
    ].filter(Boolean),
    lines,
    { empty: 'ဘရိတ်ကျော် ကျွံဂဏန်း မရှိပါ — ADD ဖြင့် ဂဏန်းထည့်ဝယ်နိုင်သည်' }));
  renderLines();

  // ADD: numbers or patterns with a units figure, added to (or raising) the lines above.
  const addLines = (bt) => openModal({
    title: `ADD — ${betTypeName(bt)}`,
    body: h('div', { class: 'form-grid' },
      field(t('Numbers'), input('numbers', { required: true, autofocus: true, autocomplete: 'off', placeholder: bt.digits === 2 ? '12 12R 2* *2' : '123 123R 12* *12 1*2' }),
        t('Numbers or patterns (12R, 2*, *2 …), separated with spaces or commas.')),
      field('ယူနစ်', input('units', { type: 'number', min: 1, step: 1, required: true }))),
    submitLabel: t('Add'),
    onSubmit: async (v) => {
      const units = Math.floor(Number(v.units));
      if (!(units > 0)) throw new Error('ယူနစ် ထည့်ပါ');
      const typed = [];
      for (const entry of v.numbers.split(/[\s,]+/).filter(Boolean)) {
        const parsed = parseEntry(entry.toUpperCase(), bt.digits);
        if (parsed.error) throw new Error(`${entry}: ${parsed.error}`);
        for (const n of parsed.numbers) if (!typed.includes(n)) typed.push(n);
      }
      for (const n of typed) {
        const line = lines.find((l) => l.bet_type_id === bt.id && l.number === n);
        if (line) line.buy = (line.buy ?? 0) + units;
        else lines.push({ bet_type_id: bt.id, number: n, buy: units });
      }
      renderLines();
      toast(`${typed.length} လုံး ထည့်ပြီး — "အဝယ်ရိုက်မည်" နှိပ်ပါ`);
    },
  });

  const oddsInputs = new Map(betTypes.map((bt) => [bt.id,
    input(`odds:${bt.id}`, { type: 'number', min: 0, step: 1, value: String(data.multipliers[bt.id] ?? 0), disabled: !editable, style: 'max-width:140px' })]));
  const note = input('note', { placeholder: 'ဒိုင် / မှတ်ချက် (မဖြည့်လည်းရ)', disabled: !editable });
  const save = h('button', { type: 'button', class: 'btn btn-primary', disabled: !editable }, 'အဝယ်ရိုက်မည်');
  save.addEventListener('click', async () => {
    const items = lines.filter((l) => l.buy > 0).map((l) => ({ bet_type_id: l.bet_type_id, number: l.number, units: l.buy }));
    if (!items.length) return toast('ဝယ်မည့် ယူနစ် ထည့်ပါ', 'bad');
    const units = items.reduce((a, i) => a + i.units, 0);
    if (!(await confirmDialog(`ဂဏန်း ${items.length} လုံး · ${money(units)} ယူနစ် (${money(units * data.unit_price)} Ks) ကို အဝယ်ရိုက်မလား?`,
      { title: 'အဝယ်', confirmLabel: 'အဝယ်ရိုက်မည်', danger: false }))) return;
    const multiplier = Object.fromEntries([...oddsInputs].map(([typeId, el]) => [typeId, Math.max(0, Math.floor(Number(el.value) || 0))]));
    await busy(save, () => api.post(`/terms/${term.id}/purchases`, { items, multiplier, ...(note.value.trim() && { note: note.value.trim() }) }))
      .then(() => { toast('အဝယ် သိမ်းပြီး'); rerender(); }, (e) => toast(e.message, 'bad'));
  });

  const remove = async (p, button) => {
    if (!(await confirmDialog(`${p.number} × ${p.units} ယူနစ် အဝယ်ကို ဖျက်မလား?`, { confirmLabel: t('Delete') }))) return;
    await busy(button, () => api.del(`/terms/${term.id}/purchases/${p.id}`)).then(rerender, (e) => toast(e.message, 'bad'));
  };

  return h('div', {},
    !editable && h('div', { class: 'notice notice-warn' }, 'ပေါက်သီး ထည့်ပြီးနောက် အဝယ် အသစ် မရိုက်နိုင်ပါ။'),
    h('div', { class: 'card' },
      cardTitle('ကျွံဂဏန်းများ — အဝယ်', 'ဘရိတ်ထက် ပိုထိုးထားသော ယူနစ်များ။ ဝယ်မည့် ယူနစ်ကို ပြင်နိုင်သည် (ကျွံထက် ပိုဝယ်လို့ရ၊ 0 = မဝယ်)။'),
      h('div', { class: 'actions', style: 'margin-bottom:10px' },
        betTypes.map((bt) => h('button', { type: 'button', class: 'btn btn-sm', disabled: !editable, onclick: () => addLines(bt) }, `ADD${manyTypes ? ` ${betTypeName(bt)}` : ''}`))),
      linesBox,
      h('div', { class: 'form-grid', style: 'margin-top:12px' },
        betTypes.map((bt) => field(`ဒိုင် အဆ (${betTypeName(bt)})`, oddsInputs.get(bt.id))),
        field('မှတ်ချက်', note)),
      h('div', { class: 'form-actions' }, save)),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, `အဝယ်စာရင်း (${data.purchases.length})`),
        h('span', { class: 'muted' },
          `ယူနစ် ${money(data.totals.units)} · ${money(data.totals.amount)} Ks`,
          data.has_results ? ` · ဒိုင်မှ ရရန် ဆုငွေ ${money(data.totals.win)} Ks` : '')),
      table(
        [
          { label: t('Date'), render: (p) => dateTime(p.created_at) },
          manyTypes && { label: t('Type'), render: (p) => typeName.get(p.bet_type_id) },
          { label: 'ဂဏန်း', render: (p) => h('strong', {}, p.number) },
          { label: 'ယူနစ်', align: 'right', render: (p) => money(p.units) },
          { label: 'ငွေ', align: 'right', render: (p) => money(p.amount) },
          { label: 'အဆ', align: 'right', render: (p) => p.multiplier },
          data.has_results && { label: 'ဆုငွေ', align: 'right', render: (p) => (p.win ? h('b', { class: 'amount-pos' }, money(p.win)) : '—') },
          { label: 'မှတ်ချက်', render: (p) => p.note ?? '—' },
          editable && { label: '', render: (p) => h('button', { type: 'button', class: 'icon-btn', title: t('Delete'), onclick: (e) => remove(p, e.currentTarget) }, '🗑') },
        ].filter(Boolean),
        data.purchases,
        { empty: 'အဝယ် မရှိသေးပါ' })));
}

function addNumbersDialog(bt, box, label) {
  openModal({
    title: `${label} — ${betTypeName(bt)}`,
    body: field(t('Numbers'), input('numbers', { required: true, autofocus: true, autocomplete: 'off', placeholder: bt.digits === 2 ? '12 12R 2* *2' : '123 123R 12* *12 1*2' }),
      t('Numbers or patterns (12R, 2*, *2 …), separated with spaces or commas.')),
    submitLabel: t('Add'),
    onSubmit: async (v) => {
      // Each entry may be a number or a sale-page pattern: 12R -> 12,21 · 2* -> 20..29 ·
      // *2 -> 02..92 · 1*2 (3D) -> 102..192 · P, 1P, SS … (same parser as the online sale page).
      const typed = [];
      for (const entry of v.numbers.split(/[\s,]+/).filter(Boolean)) {
        const parsed = parseEntry(entry.toUpperCase(), bt.digits);
        if (parsed.error) throw new Error(`${entry}: ${parsed.error}`);
        for (const n of parsed.numbers) if (!typed.includes(n)) typed.push(n);
      }
      const current = box.value.split(/[\s,]+/).filter(Boolean);
      box.value = [...new Set([...current, ...typed])].join(' ');
      toast(t('{n} number(s) added — press Save', { n: typed.filter((n) => !current.includes(n)).length }));
    },
  });
}

// Hot numbers: on each one a user may bet at most their hot % of their own total bets in this term
// (gross, all their slips). Each user listed gets their own %; everyone else the default %.
async function hot({ term, betTypes, locked, readOnly = false, rerender }) {
  const byType = new Map();
  for (const b of term.hot) byType.set(b.bet_type_id, [...(byType.get(b.bet_type_id) ?? []), b.number]);
  const users = await api.get('/users?role=user');

  const pctInput = (name, value, attrs = {}) =>
    input(name, { type: 'number', min: 0, max: 100, step: 1, value: value === '' ? '' : String(value), disabled: locked, ...attrs });
  const percent = pctInput('percent', term.hot_percent ?? 10, { required: true, style: 'max-width:140px' });
  const example = h('span', {});
  const showExample = () => {
    const pct = Math.min(100, Math.max(0, Number(percent.value) || 0));
    example.textContent = t('Example: total bets 100,000 Ks → up to {n} Ks on each hot number.', { n: money(Math.floor((100000 * pct) / 100)) });
  };
  percent.addEventListener('input', showExample);
  showExample();

  // User + % rows: every user is listed. A user without their own % follows the default (and keeps
  // following it when the default changes); typing a different % gives them their own. Only users
  // whose % differs from the default are saved as their own.
  const usersBox = h('div', {});
  const own = new Map(term.hot_users.map((u) => [u.user_id, u.percent]));
  const rows = users
    .map((u) => ({ user_id: u.id, username: u.username, name: u.name, percent: own.get(u.id), custom: own.has(u.id) }))
    .sort((x, y) => x.username.localeCompare(y.username));
  const defaultPct = () => Number(percent.value || 0);
  const renderUsers = () => {
    mount(usersBox, table(
      [
        { label: t('Username'), render: (r) => h('a', { href: `#/users/${r.user_id}` }, r.username) },
        { label: t('Name'), render: (r) => r.name ?? '—' },
        { label: 'Hot %', align: 'right', render: (r) => h('input', {
            class: `cell${r.custom ? ' cell-custom' : ''}`, type: 'number', min: 0, max: 100, step: 1, disabled: locked,
            value: String(r.custom ? r.percent : defaultPct()),
            oninput: (e) => { r.percent = Number(e.target.value || 0); r.custom = true; e.target.classList.add('cell-custom'); },
          }) },
        // ↺ back to the default; on a locked / read-only term an own % just shows as it is.
        { label: '', render: (r) => (!r.custom
            ? h('span', { class: 'muted' }, t('default'))
            : !locked && h('button', { type: 'button', class: 'icon-btn', title: t('Back to the default %'), onclick: () => { r.custom = false; renderUsers(); } }, '↺')) },
      ],
      rows,
      { empty: t('No users yet') }));
  };
  // Users still on the default show the new default as it is typed.
  percent.addEventListener('input', renderUsers);
  renderUsers();

  const save = h('button', { type: 'submit', class: 'btn btn-primary', disabled: locked }, t('Save hot numbers'));
  const form = h('form', { class: 'card' },
    cardTitle(t('Hot numbers'), t('On each hot number a user may bet at most their % of their own total bets in this term (all their slips, before discount). 0% = closed.')),
    h('div', { class: 'form-grid' },
      field(t('Default hot %'), percent, example),
      betTypes.map((bt) => {
        const box = h('textarea', { name: `hot:${bt.id}`, rows: 2, disabled: locked, placeholder: bt.digits === 2 ? t('e.g. 00 11 99') : '' },
          (byType.get(bt.id) ?? []).join(' '));
        // ADD HOT: type numbers in a dialog; they are added to the box below (Save stores them).
        const add = h('button', { type: 'button', class: 'btn btn-sm', disabled: locked, onclick: () => addNumbersDialog(bt, box, 'ADD HOT') }, 'ADD HOT');
        return field(t('{name} ({n} digits)', { name: betTypeName(bt), n: bt.digits }), h('div', {}, h('div', { style: 'margin-bottom:6px' }, add), box));
      })),
    h('h3', { style: 'margin:18px 0 8px' }, t('Hot % per user')),
    usersBox,
    h('p', { class: 'form-error', role: 'alert' }),
    !readOnly && h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (readOnly) return;
    const v = formValues(form);
    const error = form.querySelector('.form-error');
    const numbers = [];
    for (const bt of betTypes) {
      for (const number of new Set((v[`hot:${bt.id}`] ?? '').split(/[\s,]+/).filter(Boolean))) {
        if (!new RegExp(`^\\d{${bt.digits}}$`).test(number)) {
          error.textContent = t('{name}: "{number}" must be {n} digit(s)', { name: betTypeName(bt), number, n: bt.digits });
          return;
        }
        numbers.push({ bet_type_id: bt.id, number });
      }
    }
    const bad = rows.find((r) => r.custom && !(r.percent >= 0 && r.percent <= 100));
    if (bad) { error.textContent = `${bad.username}: ${t('Enter a % from 0 to 100')}`; return; }
    const users = rows.filter((r) => r.custom && r.percent !== Number(v.percent)).map(({ user_id, percent: p }) => ({ user_id, percent: p }));
    const body = { percent: Number(v.percent), numbers, users };
    await busy(save, () => api.put(`/terms/${term.id}/hot`, body))
      .then(() => { toast(t('{n} hot number(s) saved', { n: numbers.length })); rerender(); }, () => {});
  });
  return form;
}

function results({ term, rerender }) {
  const bySlot = new Map(term.results.map((r) => [r.slot, r.value]));
  const canEnter = ['open', 'closed', 'drawn', 'settled'].includes(term.status); // settled: correct the result
  const correcting = term.status === 'settled';
  const beforeClose = term.close_at && new Date() < new Date(term.close_at);

  // A 2D term needs only the 2D result, a 3D term only the 3D result (legacy 2D+3D terms: both,
  // 2D optional and taken from the 3D result's last two digits when left empty).
  const needs3 = term.game !== '2D';
  const needs2 = term.game !== '3D';
  const legacy = term.game === '2D3D';
  const shown2 = bySlot.get(2) ?? (legacy ? bySlot.get(1)?.slice(1) : undefined);

  const current = term.results.length
    ? h('div', { class: 'result-digits' },
        needs3 && h('div', { class: 'result-box' }, h('div', { class: 'label' }, '3D'), h('div', { class: 'value' }, bySlot.get(1) ?? '—')),
        needs2 && h('div', { class: 'result-box' }, h('div', { class: 'label' }, '2D'), h('div', { class: 'value' }, shown2 ?? '—')))
    : h('p', { class: 'muted' }, t('No results entered yet.'));

  // ပေါက်သီး သိမ်းပြီး ပိတ်မည်: the result is saved and the term closed. ငွေရှင်း is ticked from the
  // start, so saving the result settles it at once (winners paid, term locked); untick it to leave
  // the term "drawn" until settled with the Settle button. Correcting a settled term always settles.
  const settleBox = h('input', { type: 'checkbox', name: 'settle', checked: true, disabled: correcting });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' },
    correcting ? t('Correct result & settle again') : 'ပေါက်သီး သိမ်းပြီး ပိတ်မည်');
  const form = canEnter && h('form', {},
    beforeClose && h('div', { class: 'notice notice-warn' }, t('Betting is still open until {time}. Results can be entered after that.', { time: dateTime(term.close_at) })),
    h('div', { class: 'form-grid' },
      needs3 && field(t('3D result'), input('r3', { required: true, pattern: '\\d{3}', maxlength: 3, inputmode: 'numeric', value: bySlot.get(1) ?? '', placeholder: '385' })),
      needs2 && field(t('2D result'),
        input('r2', { required: !legacy, pattern: '\\d{2}', maxlength: 2, inputmode: 'numeric', value: bySlot.get(2) ?? '', placeholder: t('e.g. 21') }),
        legacy && t('Leave empty to use the last 2 digits of 3D'))),
    h('label', { class: 'check', style: 'margin-top:12px' },
      settleBox,
      h('span', { class: 'check-label' }, 'ငွေရှင်း')),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const doSettle = correcting || settleBox.checked;
    const rows = [
      ...(v.r3 ? [{ slot: 1, value: v.r3, label: '3D' }] : []),
      ...(v.r2 ? [{ slot: 2, value: v.r2, label: '2D' }] : []),
    ];
    const ok = await confirmDialog(
      correcting
        ? t('The winnings already paid for this term are taken back from the users (a balance may go negative if it was spent), then the slips are settled again on the new result.')
        : doSettle
          ? t('Winning tickets will be paid into user wallets and the term will be locked. This cannot be undone.')
          : 'ပေါက်ဂဏန်းကို သိမ်းပြီး အပါတ်စဥ်ကို ပိတ်ပါမည်။ ဆုငွေ မပေးရသေးပါ — နောက်မှ "Settle & pay winners" ဖြင့် ငွေစာရင်းရှင်းနိုင်သည်။',
      { title: correcting ? t('Correct the result?') : doSettle ? t('Save results and settle?') : 'ပေါက်သီး သိမ်းပြီး ပိတ်မလား?',
        confirmLabel: doSettle ? t('Settle now') : 'သိမ်းပြီး ပိတ်မည်', danger: correcting });
    if (!ok) return;
    await busy(save, () => api.put(`/terms/${term.id}/results${doSettle ? '' : '?settle=0'}`, rows)).then((r) => {
      toast(r.settled === false
        ? 'ပေါက်ဂဏန်း သိမ်းပြီး အပါတ်စဥ် ပိတ်ပြီးပါပြီ (ငွေစာရင်း မရှင်းရသေး)'
        : t(r.corrected ? 'Corrected: {n} winning ticket(s), payout {amount} Ks' : 'Settled: {n} winning ticket(s), payout {amount} Ks',
          { n: r.winning_tickets, amount: money(r.payout) }));
      rerender();
    }, () => {});
  });

  // A "drawn" term (result saved with ငွေရှင်း unticked): settle it now.
  const settle = term.status === 'drawn' && h('button', { class: 'btn btn-good' }, t('Settle & pay winners'));
  if (settle) settle.addEventListener('click', async () => {
    const ok = await confirmDialog(
      t('Winning tickets will be paid into user wallets and the term will be locked. This cannot be undone.'),
      { title: t('Settle this term?'), confirmLabel: t('Settle now'), danger: false });
    if (!ok) return;
    await busy(settle, () => api.post(`/terms/${term.id}/settle`)).then((r) => {
      toast(t('Settled: {n} winning ticket(s), payout {amount} Ks', { n: r.winning_tickets, amount: money(r.payout) }));
      rerender();
    }, () => {});
  });

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Draw results')), settle),
    current,
    needs3 && bySlot.get(1) && h('p', { class: 'muted', style: 'margin:12px 0 0' },
      `${t("Twod numbers (paid at each user's Twod multiplier)")}: `,
      h('strong', {}, twodNumbers(bySlot.get(1)).join(', '))),
    term.status === 'settled' && h('p', { class: 'muted' }, t('This term is settled. See the Report tab for payouts. A wrong result can still be corrected below.')),
    form && h('div', { style: 'margin-top:16px' }, form));
}

const exposure = ({ term, betTypes }) => exposurePanel({ term, betTypes });

const ledger = ({ term, betTypes }) => ledgerPanel({
  term,
  betTypes,
  globalScope: session.get()?.user?.role === 'master',
});
// An agent's rows are always its own users (grouping by agent would be itself alone).
const summary = ({ term }) => summaryPanel({ term, groupByAgent: session.get()?.user?.role !== 'agent' });

async function tickets({ term, betTypes, rerender }) {
  const rows = await api.get(`/tickets?term_id=${term.id}&limit=500`);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Tickets ({n})', { n: rows.length })), h('span', { class: 'muted' }, t('Latest 500 · click a row for details'))),
    ticketTable(rows, {
      betTypes,
      // can_manage 0 / false: a slip outside the caller's tree.
      canCancel: (x) => x.can_manage !== 0 && x.can_manage !== false && ['open', 'closed'].includes(term.status),
      // Editing a slip's lines is the admin's and the master's (PATCH /tickets/:id/items), so an
      // agent gets no Actions column at all.
      canEdit: session.get()?.user?.role === 'agent' ? undefined
        : (x) => x.can_manage !== 0 && x.can_manage !== false && ['open', 'closed'].includes(term.status), // until the result is in
      onChange: rerender,
    }));
}

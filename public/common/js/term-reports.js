// Ticket popup, exposure and sales report panels shared by admin and agent pages.
// The API scopes all of these to what the signed-in account may see.
import { api } from './api.js';
import { betTypeName, t } from './i18n.js';
import { badge, confirmDialog, dateTime, h, input, money, mount, openModal, select, table, toast } from './ui.js';

// canEdit(ticket) (admin only) adds an Actions column with Edit / Delete on the slips it allows.
export function ticketTable(rows, { betTypes, showTerm = false, canCancel, canEdit, onChange }) {
  const action = (label, cls, fn) => h('button', {
    type: 'button', class: `btn btn-sm ${cls}`,
    onclick: (e) => { e.stopPropagation(); fn(); }, // not the row's own click (slip popup)
  }, label);
  return table(
    [
      { label: t('Slip'), key: 'slip_no' },
      showTerm && { label: t('Term'), key: 'term_description' },
      { label: t('User'), render: (x) => h('a', { href: `#/users/${x.user_id}` }, x.username) },
      { label: t('Time'), render: (x) => dateTime(x.created_at) },
      { label: t('Gross'), align: 'right', render: (x) => money(x.gross_amount) },
      { label: t('Discount'), align: 'right', render: (x) => money(x.discount_amount) },
      { label: t('Net'), align: 'right', render: (x) => money(x.net_amount) },
      { label: t('Won'), align: 'right', render: (x) => (x.win_amount ? money(x.win_amount) : '—') },
      { label: t('Status'), render: (x) => badge(x.status) },
      canEdit && {
        label: t('Actions'),
        render: (x) => (x.status === 'active' && canEdit(x)
          ? h('span', { class: 'row-actions' },
              action(t('Edit'), '', () => editTicket(x.id, { betTypes, onChange })),
              ' ',
              action(t('Delete'), 'btn-danger', () => deleteTicket(x, { onChange })))
          : '—'),
      },
    ].filter(Boolean),
    rows,
    { empty: t('No tickets yet'), onRowClick: (x) => showTicket(x.id, { betTypes, canCancel, onChange }) });
}

// Delete = cancel the slip and refund it (logged in the slip edit log the user sees).
async function deleteTicket(ticket, { onChange }) {
  const ok = await confirmDialog(t('Delete slip {slip} ({amount} Ks) and refund it to {user}?',
    { slip: ticket.slip_no, amount: money(ticket.net_amount), user: ticket.username }), { confirmLabel: t('Delete') });
  if (!ok) return;
  try {
    await api.post(`/tickets/${ticket.id}/cancel`);
    toast(t('Slip {slip} cancelled and refunded', { slip: ticket.slip_no }));
    onChange?.();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

// Edit: each line's units can be lowered, 0 removes the line; the difference is refunded.
async function editTicket(ticketId, { betTypes, onChange }) {
  const ticket = await api.get(`/tickets/${ticketId}`);
  const typeById = new Map(betTypes.map((bt) => [bt.id, bt]));
  const unitInput = (i) => input(`u${i.id}`, { type: 'number', min: 0, max: i.units, step: 1, value: i.units, required: true, style: 'width:90px' });
  openModal({
    title: t('Edit slip {slip} · {user}', { slip: ticket.slip_no, user: ticket.username }),
    wide: true,
    body: [
      h('p', { class: 'muted' }, t('Lower the units or set 0 to remove a line. The difference is refunded to the user, and they see the change in their app.')),
      table(
        [
          { label: '#', key: 'serial' },
          { label: t('Bet type'), render: (i) => typeById.has(i.bet_type_id) ? betTypeName(typeById.get(i.bet_type_id)) : i.bet_type },
          { label: t('Number'), render: (i) => h('strong', {}, i.number) },
          { label: t('Units'), align: 'right', render: unitInput },
        ],
        ticket.items),
    ],
    submitLabel: t('Save'),
    onSubmit: async (values) => {
      const items = ticket.items
        .map((i) => ({ id: i.id, units: Number(values[`u${i.id}`]) }))
        .filter((c, n) => c.units !== ticket.items[n].units);
      if (!items.length) return;
      const saved = await api.patch(`/tickets/${ticket.id}/items`, { items });
      toast(saved.status === 'cancelled'
        ? t('Slip {slip} cancelled and refunded', { slip: ticket.slip_no })
        : t('Slip {slip} saved · refunded {amount} Ks', { slip: ticket.slip_no, amount: money(ticket.net_amount - saved.net_amount) }));
      onChange?.();
    },
  });
}

// canCancel(ticket) decides whether the cancel button is offered; the server re-checks.
export async function showTicket(ticketId, { betTypes, canCancel = () => false, onChange }) {
  const ticket = await api.get(`/tickets/${ticketId}`);
  const typeById = new Map(betTypes.map((bt) => [bt.id, bt]));
  openModal({
    title: t('Slip {slip} · {user}', { slip: ticket.slip_no, user: ticket.username }),
    wide: true,
    body: [
      h('p', { class: 'muted' },
        `${ticket.term_description} · `,
        t('{time} · Net {amount} Ks · ', { time: dateTime(ticket.created_at), amount: money(ticket.net_amount) }),
        badge(ticket.status)),
      table(
        [
          { label: '#', key: 'serial' },
          { label: t('Bet type'), render: (i) => typeById.has(i.bet_type_id) ? betTypeName(typeById.get(i.bet_type_id)) : i.bet_type },
          { label: t('Number'), render: (i) => h('strong', {}, i.number) },
          { label: t('Units'), align: 'right', key: 'units' },
          { label: t('Amount'), align: 'right', render: (i) => money(i.amount) },
          { label: t('Disc %'), align: 'right', key: 'discount' },
          { label: t('Odds'), align: 'right', render: (i) => `${i.multiplier}×` },
          { label: t('Won'), align: 'right', render: (i) => (i.is_winner ? h('strong', { class: 'amount-pos' }, money(i.win_amount)) : '—') },
        ],
        ticket.items),
    ],
    submitLabel: t('Cancel ticket & refund'),
    cancelLabel: t('Close'),
    danger: true,
    onSubmit: ticket.status === 'active' && canCancel(ticket)
      ? async () => {
          await api.post(`/tickets/${ticket.id}/cancel`);
          toast(t('Slip {slip} cancelled and refunded', { slip: ticket.slip_no }));
          onChange?.();
        }
      : undefined,
  });
}

export async function exposurePanel({ term, betTypes }) {
  const limitByType = new Map(term.limits.map((l) => [l.bet_type_id, l.max_units]));
  const typeById = new Map(betTypes.map((bt) => [bt.id, bt]));
  const box = h('div', {});
  const typeSelect = select('bet_type_id', [['', t('All bet types')], ...betTypes.map((bt) => [bt.id, betTypeName(bt)])], '');
  const load = async () => {
    const rows = await api.get(`/terms/${term.id}/exposure${typeSelect.value ? `?bet_type_id=${typeSelect.value}` : ''}`);
    const sales = rows.reduce((s, r) => s + r.amount, 0);
    mount(box,
      h('p', { class: 'muted' }, t('{n} numbers · {amount} Ks bet (before discount). Rows in red have used 80% or more of their unit break.', { n: rows.length, amount: money(sales) })),
      table(
        [
          { label: 'အမျိုးအစား', render: (r) => betTypeName(typeById.get(r.bet_type_id)) },
          { label: 'ဂဏန်း', render: (r) => h('strong', {}, r.number) },
          { label: 'ယူနစ်', align: 'right', render: (r) => money(r.units) },
          { label: t('Amount'), align: 'right', render: (r) => money(r.amount) },
          { label: t('Payout if wins'), align: 'right', render: (r) => money(r.potential_payout) },
          { label: t('Limit used'), align: 'right', render: (r) => limitByType.get(r.bet_type_id) ? `${r.units} / ${limitByType.get(r.bet_type_id)}` : '—' },
        ],
        rows,
        { empty: t('No bets yet') }));
    const nearLimit = (r) => limitByType.get(r.bet_type_id) && r.units >= 0.8 * limitByType.get(r.bet_type_id);
    box.querySelectorAll('tbody tr').forEach((tr, i) => rows[i] && nearLimit(rows[i]) && tr.classList.add('hot'));
  };
  typeSelect.addEventListener('change', load);
  await load();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Exposure by number')), h('div', { style: 'min-width:200px' }, typeSelect)),
    box);
}

// groupByAgent: offer the "by agent / by user" switch (admin only; agents always see their users).
export async function summaryPanel({ term, groupByAgent = false }) {
  const box = h('div', {});
  const groupSelect = groupByAgent && select('group_by', [['agent', t('By agent')], ['user', t('By user')]], 'agent');
  const load = async () => {
    const groupBy = groupSelect ? groupSelect.value : 'user';
    const rows = await api.get(`/reports/summary?term_id=${term.id}&group_by=${groupBy}`);
    const total = (key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
    const profitCell = (n) => h('span', { class: n < 0 ? 'amount-neg' : 'amount-pos' }, money(n));
    const totalRow = { username: t('Total'), tickets: total('tickets'), gross: total('gross'), discount: total('discount'), net: total('net'), payout: total('payout'), profit: total('profit') };
    mount(box,
      table(
        [
          { label: groupBy === 'agent' ? t('Agent') : t('User'), render: (r) => r.id ? h('a', { href: `#/users/${r.id}` }, r.username) : r.username },
          { label: t('Tickets'), align: 'right', key: 'tickets' },
          { label: t('Gross'), align: 'right', render: (r) => money(r.gross) },
          { label: t('Discount'), align: 'right', render: (r) => money(r.discount) },
          { label: t('Net sales'), align: 'right', render: (r) => money(r.net) },
          { label: t('Payout'), align: 'right', render: (r) => money(r.payout) },
          { label: t('Profit'), align: 'right', render: (r) => profitCell(r.profit) },
        ],
        rows.length > 1 ? [...rows, totalRow] : rows,
        { empty: t('No sales for this term') }));
    if (rows.length > 1) box.querySelector('tbody tr:last-child').style.fontWeight = '700';
  };
  if (groupSelect) groupSelect.addEventListener('change', load);
  await load();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, t('Sales & payout')),
      groupSelect && h('div', { style: 'min-width:160px' }, groupSelect)),
    term.status !== 'settled' && h('p', { class: 'muted' }, t('Payout and profit are final once the term is settled.')),
    box);
}

// Mirrors the server's betting window check (status open and within open_at/close_at).
export function isTermOpen(term, now = new Date()) {
  if (term.status !== 'open') return false;
  if (term.open_at && now < new Date(term.open_at)) return false;
  return !(term.close_at && now >= new Date(term.close_at));
}

// Bet types a term accepts (same rule as the server's betTypeFitsTerm): a 2D term shows only
// 2-digit types, a 3D term only 3-digit types; legacy 2D+3D terms show both.
export function termBetTypes(betTypes, game) {
  if (game === '2D') return betTypes.filter((bt) => bt.digits === 2);
  if (game === '3D') return betTypes.filter((bt) => bt.digits === 3);
  return betTypes;
}

// Twod (တွဒ်) numbers of a 3D result — same rule as the server (src/rules.js twodNumbers): the
// +1/-1 neighbours (wrapping 999 <-> 000) and every other ordering of its digits.
export function twodNumbers(r3) {
  if (!r3 || !/^\d{3}$/.test(r3)) return [];
  const n = Number(r3);
  const out = [];
  const seen = new Set([r3]);
  const add = (x) => { if (!seen.has(x)) { seen.add(x); out.push(x); } };
  add(String((n + 1) % 1000).padStart(3, '0'));
  add(String((n + 999) % 1000).padStart(3, '0'));
  const permute = (rest, prefix) => {
    if (!rest.length) return add(prefix);
    for (let i = 0; i < rest.length; i++) permute(rest.slice(0, i) + rest.slice(i + 1), prefix + rest[i]);
  };
  permute(r3, '');
  return out;
}

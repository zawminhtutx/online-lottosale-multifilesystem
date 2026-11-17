// Shared by the admin, master, and agent Live Ledger pages. Admin and a master with ledger_access
// see every tree; a master / agent without that flag still sees its own downline.
import { api } from '/common/js/api.js';
import { betTypeName, t } from '/common/js/i18n.js';
import { onLive, onLiveStatus } from '/common/js/live.js';
import { h, money, mount, openModal, select, table, toast } from '/common/js/ui.js';
// Live Ledger — every number of the term (00-99 or 000-999) with the units sold so far, coloured
// against the unit break like the POS Sale page's ledger grid, and updated the moment a slip is
// placed or cancelled (WebSocket "tickets" notices; see src/live.js).
export async function ledgerPanel({ term, betTypes, globalScope = false }) {
  const digits = term.game === '3D' ? 3 : 2;
  const numbers = Array.from({ length: 10 ** digits }, (_, i) => String(i).padStart(digits, '0'));
  const limitByType = new Map(term.limits.map((l) => [l.bet_type_id, l.max_units]));
  const typeSelect = betTypes.length > 1 && select('bet_type_id', betTypes.map((bt) => [bt.id, betTypeName(bt)]), betTypes[0]?.id);
  const sortSelect = select('sort', [['num', t('Sort: number')], ['units', t('Sort: units')]], 'num');
  const liveBadge = h('span', { class: 'badge badge-muted' }, t('Connecting…'));
  const stats = h('div', { class: 'ledger-stats' });
  const grid = h('div', { class: `ledger-grid ledger-grid-${digits}` });
  // Table (the POS Sale page's ledger panel: ● | Num | Unit | Extra) or Grid; remembered per browser.
  let view = 'table';
  try { view = localStorage.getItem('lotto.admin.ledgerView') || 'table'; } catch { /* default */ }
  const viewSelect = select('view', [['table', t('Table view')], ['grid', t('Grid view')]], view);
  const tableBox = h('div', { class: 'ledger-table-wrap' });

  // "Select user": tick users to see only their bets (none ticked = everyone). The list is the
  // users who have bet on this term, refreshed live as new users bet.
  const chosen = new Set();
  let userRows = [];
  const userButton = h('button', { type: 'button', class: 'btn ledger-users-btn', 'aria-haspopup': 'true' });
  const userPanel = h('div', { class: 'ledger-users-panel', hidden: true });
  const userBox = h('div', { class: 'ledger-users' }, userButton, userPanel);
  userButton.addEventListener('click', () => { userPanel.hidden = !userPanel.hidden; });
  const onOutside = (e) => {
    if (!userBox.isConnected) return document.removeEventListener('click', onOutside);
    if (!userBox.contains(e.target)) userPanel.hidden = true;
  };
  document.addEventListener('click', onOutside);

  const renderUsers = () => {
    const names = userRows.filter((u) => chosen.has(u.id)).map((u) => u.username);
    userButton.textContent = `👤 ${names.length === 0 ? t('Select user') + ': ' + t('All')
      : names.length <= 2 ? names.join(', ') : t('{n} users', { n: names.length })} ▾`;
    const box = (checked, onchange, ...label) => h('label', { class: 'ledger-user' },
      h('input', { type: 'checkbox', checked, onchange }), ...label);
    mount(userPanel,
      box(chosen.size === 0, () => { chosen.clear(); changeUsers(); }, h('b', {}, t('All users'))),
      userRows.length
        ? userRows.map((u) => box(chosen.has(u.id), (e) => {
            if (e.target.checked) chosen.add(u.id); else chosen.delete(u.id);
            changeUsers();
          }, h('span', {}, u.username)))
        : h('div', { class: 'muted', style: 'padding:6px 8px' }, t('No bets yet')));
  };
  const loadUsers = async () => {
    userRows = globalScope
      ? await api.get(`/terms/${term.id}/ledger-users`)
      : await api.get(`/reports/summary?term_id=${term.id}&group_by=user`);
    for (const id of [...chosen]) if (!userRows.some((u) => u.id === id)) chosen.delete(id);
    renderUsers();
  };
  const changeUsers = () => { renderUsers(); updated = null; load().catch(() => {}); };
  let selected = null;
  let units = new Map();
  let amounts = new Map();
  let updated = null;

  const typeId = () => Number(typeSelect ? typeSelect.value : betTypes[0]?.id);
  const breakUnits = () => limitByType.get(typeId()) ?? 0;

  const render = (changed = new Set()) => {
    const cap = breakUnits();
    const all = [...units.values()].reduce((a, b) => a + b, 0);
    const extra = cap ? [...units.values()].reduce((a, u) => a + Math.max(0, u - cap), 0) : 0;
    const amount = [...amounts.values()].reduce((a, b) => a + b, 0);
    const stat = (label, value, cls) => h('div', { class: `ledger-stat ${cls ?? ''}` }, h('span', {}, label), h('b', {}, value));
    mount(stats,
      stat(t('All total'), money(all)),
      stat(t('Total'), money(all - extra)),
      stat(t('Unit break'), cap ? money(cap) : '—'),
      // Ratio: Total ÷ unit break, rounded to the nearest whole number, shown with %.
      stat('Ratio %', cap ? `${money(Math.round((all - extra) / cap))}%` : '—'),
      stat(t('Amount (Ks)'), money(amount)),
      stat(t('Numbers bet'), `${units.size} / ${numbers.length}`),
      stat(t('Updated'), updated ? updated.toLocaleTimeString('en-US') : '—'));

    const order = sortSelect.value === 'units'
      ? [...numbers].sort((a, b) => (units.get(b) ?? 0) - (units.get(a) ?? 0) || a.localeCompare(b))
      : numbers;
    grid.hidden = view !== 'grid';
    tableBox.hidden = view !== 'table';
    sortSelect.hidden = view === 'table'; // the table is always in number order
    if (view === 'table') {
      // Like the POS ledger sheet: 10 column pairs (Num | Unit) — 00-09, 10-19 … 90-99
      // (3D: 000-099 … 900-999) — so every number is on one screen.
      const rowsPerCol = numbers.length / 10;
      const cell = (num) => {
        const u = units.get(num) ?? 0;
        const over = cap && u > cap ? u - cap : 0;
        const tone = !u ? 'zero' : over ? 'over' : cap && u >= 0.8 * cap ? 'near' : 'ok';
        const cls = [tone, changed.has(num) && 'flash', num === selected && 'selected'].filter(Boolean).join(' ');
        const pick = () => { selected = num; render(); showNumberBets(num); };
        return [
          h('td', { class: `ledger-num ${cls}`, 'data-num': num, onclick: pick }, num),
          h('td', {
            class: `ledger-unit ${cls}`, onclick: pick,
            title: `${num}: ${money(u)} ${t('units')} · ${money(amounts.get(num) ?? 0)} Ks${over ? ` · ${t('Extra')} ${money(over)}` : ''}`,
          }, u ? money(over ? cap : u) : '', over ? h('small', { class: 'ledger-over' }, ` +${money(over)}`) : null),
        ];
      };
      mount(tableBox, h('table', { class: `ledger-sheet ledger-sheet-${digits}` },
        h('tbody', {}, Array.from({ length: rowsPerCol }, (_, r) =>
          h('tr', {}, Array.from({ length: 10 }, (_, c) => cell(numbers[c * rowsPerCol + r])))))));
      return;
    }
    mount(grid, order.map((num) => {
      const u = units.get(num) ?? 0;
      const tone = !u ? 'zero' : cap && u > cap ? 'over' : cap && u >= 0.8 * cap ? 'near' : 'ok';
      const over = cap && u > cap ? u - cap : 0;
      return h('div', {
        class: `ledger-cell ${tone}${changed.has(num) ? ' flash' : ''}`,
        style: 'cursor:pointer',
        onclick: () => showNumberBets(num),
        title: `${num}: ${money(u)} ${t('units')} · ${money(amounts.get(num) ?? 0)} Ks${over ? ` · ${t('Extra')} ${money(over)}` : ''}`,
      },
        h('span', { class: 'ledger-num' }, num),
        h('span', { class: 'ledger-units' }, u ? money(over ? cap : u) : '-'),
        over ? h('span', { class: 'ledger-extra' }, `+${money(over)}`) : null);
    }));
  };

  // Tap a number: who bet on it (within the chosen users), with each one's units, amount and slips.
  const showNumberBets = async (num) => {
    const q = `bet_type_id=${typeId()}&number=${num}${chosen.size ? `&user_ids=${[...chosen].join(',')}` : ''}`;
    const rows = await api.get(`/terms/${term.id}/number-bets?${q}`).catch((e) => { toast(e.message, 'bad'); return null; });
    if (!rows) return;
    const cap = breakUnits();
    const sum = rows.reduce((a, r) => a + r.units, 0);
    openModal({
      title: t('Number {num} · {units} units', { num, units: money(sum) }),
      body: [
        cap ? h('p', { class: 'muted' }, t('Unit break {cap}', { cap: money(cap) }), sum > cap ? h('b', { class: 'ledger-over' }, ` · ${t('Extra')} ${money(sum - cap)}`) : null) : null,
        table(
          [
            { label: t('User'), render: (r) => [h('b', {}, r.username), r.name && r.name !== r.username ? h('div', { class: 'muted' }, r.name) : null] },
            { label: t('Agent'), render: (r) => r.agent_username ?? '—' },
            { label: t('Units'), align: 'right', render: (r) => h('b', {}, money(r.units)) },
            { label: t('Amount (Ks)'), align: 'right', render: (r) => money(r.amount) },
            { label: t('Slips'), align: 'right', key: 'slips' },
          ],
          rows,
          { empty: t('Nobody has bet on this number') }),
      ],
    });
  };

  const load = async () => {
    const q = new URLSearchParams({ bet_type_id: String(typeId()), live_ledger: '1' });
    if (chosen.size) q.set('user_ids', [...chosen].join(','));
    const rows = await api.get(`/terms/${term.id}/exposure?${q}`);
    const next = new Map(rows.map((r) => [r.number, r.units]));
    const changed = new Set(numbers.filter((n) => updated && (next.get(n) ?? 0) !== (units.get(n) ?? 0)));
    units = next;
    amounts = new Map(rows.map((r) => [r.number, r.amount]));
    updated = new Date();
    render(changed);
  };

  const card = h('div', { class: 'card ledger-card' });

  // View full screen: the browser's Fullscreen API, or a full-window overlay where it's missing.
  const fsButton = h('button', { type: 'button', class: 'btn btn-sm ledger-fs-btn' });
  const isFull = () => document.fullscreenElement === card || card.classList.contains('ledger-max');
  const syncFs = () => {
    fsButton.textContent = isFull() ? `✕ ${t('Exit full screen')}` : `⛶ ${t('Full screen')}`;
  };
  const onFsChange = () => {
    if (!card.isConnected) return document.removeEventListener('fullscreenchange', onFsChange); // left the page
    syncFs();
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('ledger-max')) { card.classList.remove('ledger-max'); syncFs(); } });
  };
  fsButton.addEventListener('click', async () => {
    if (isFull()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      card.classList.remove('ledger-max');
    } else if (card.requestFullscreen) {
      await card.requestFullscreen().catch(() => card.classList.add('ledger-max'));
    } else {
      card.classList.add('ledger-max');
    }
    syncFs();
  });
  document.addEventListener('fullscreenchange', onFsChange);
  syncFs();

  // Several slips in a burst reload once.
  let timer = null;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { load().catch(() => {}); loadUsers().catch(() => {}); }, 250);
  };
  const stop = [
    onLive('tickets', (m) => {
      if (!card.isConnected) return stop.forEach((fn) => fn()); // left the page
      if (m.reconnected || m.term_id === term.id) reload();
    }),
    // Unit break changed (here or in another tab): recolour against the new break.
    onLive('terms', async () => {
      if (!card.isConnected) return;
      const fresh = await api.get(`/terms/${term.id}`).catch(() => null);
      if (!fresh) return;
      limitByType.clear();
      for (const l of fresh.limits) limitByType.set(l.bet_type_id, l.max_units);
      render();
    }),
    onLiveStatus((connected) => {
      liveBadge.className = `badge ${connected ? 'badge-good' : 'badge-warn'}`;
      liveBadge.textContent = connected ? `● ${t('Live')}` : t('Reconnecting…');
    }),
  ];

  if (typeSelect) typeSelect.addEventListener('change', () => { updated = null; load(); });
  sortSelect.addEventListener('change', () => render());
  viewSelect.addEventListener('change', () => {
    view = viewSelect.value;
    try { localStorage.setItem('lotto.admin.ledgerView', view); } catch { /* this visit only */ }
    render();
  });

  mount(card,
    h('div', { class: 'card-head' },
      h('h2', { class: 'ledger-title' }, t('Live Ledger'), ' ', liveBadge, ' ', fsButton),
      h('div', { class: 'toolbar', style: 'margin:0' }, typeSelect || null, userBox, sortSelect, viewSelect)),
    stats,
    h('div', { class: 'ledger-legend muted' },
      h('span', { class: 'ledger-dot ok' }), t('Under break'),
      h('span', { class: 'ledger-dot near' }), t('80% of break'),
      h('span', { class: 'ledger-dot over' }), t('Over break (extra)'),
      h('span', { class: 'ledger-dot zero' }), t('No bets')),
    tableBox,
    grid);
  await Promise.all([load(), loadUsers()]);
  return card;
}

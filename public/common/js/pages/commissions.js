// ကော်မရှင် (Commission) — the commission % per bet type of every account the signed-in account sets,
// on one page, edited in place. It is the same "Discount" an account's own page shows (discount 1,
// taken off the ticket price when the prize set says "use customer discount"); discount 2 / 3 are
// left as they are.
// It is handed down one step at a time (src/routes/users.js): the admin sets its masters', a master
// its own agents' and users' (with an agent filter), an agent its users'.
import { api, cached, session } from '/common/js/api.js';
import { betTypeName, t } from '/common/js/i18n.js';
import { badge, busy, h, input, mount, pageHeader, select, table, toast } from '/common/js/ui.js';

export default async function commissions(main, { query }) {
  const agentId = query.get('agent') ?? '';
  const search = (query.get('search') ?? '').toLowerCase();
  const role = session.get()?.user?.role;
  const isAdmin = role === 'admin'; // lists its masters; no agent filter (they all hang under it)
  const isMaster = role === 'master'; // its agents and users, filtered by agent
  const [all, meta, agents] = await Promise.all([api.get('/users/commissions'), cached('/meta'), isMaster ? api.get('/users?role=agent') : []]);
  const betTypes = meta.bet_types;

  const go = (params) => {
    const next = new URLSearchParams({ ...(agentId && { agent: agentId }), ...(search && { search }), ...params });
    for (const [k, v] of [...next]) if (!v) next.delete(k);
    location.hash = `#/commissions${next.size ? `?${next}` : ''}`;
  };

  const agentIds = new Set(agents.map((a) => a.id));
  const users = all.filter((u) =>
    (agentId === '' || (agentId === 'none' ? !agentIds.has(u.parent_id) : String(u.parent_id) === agentId)) &&
    (!search || [u.username, u.name, u.name_mm].some((s) => s?.toLowerCase().includes(search))));

  const saveAll = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, `💾 ${t('Save all')}`);
  const dirty = new Set();
  const markDirty = (row) => { dirty.add(row); row.save.disabled = false; saveAll.disabled = false; };

  const cell = (row, bt) => {
    const el = h('input', {
      class: 'cell', type: 'number', min: 0, max: 100, step: 0.01,
      value: String(row.user.discounts[bt.id] ?? 0), 'aria-label': `${row.user.username} ${bt.code}`,
    });
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', () => markDirty(row));
    return el;
  };

  const payload = (list) => list.flatMap((row) =>
    betTypes.map((bt) => ({ user_id: row.user.id, bet_type_id: bt.id, discount: Math.min(100, Math.max(0, Number(row.inputs[bt.id].value) || 0)) })));

  const save = async (button, list) => {
    await busy(button, () => api.put('/users/commissions', payload(list)))
      .then(() => {
        for (const row of list) { dirty.delete(row); row.save.disabled = true; }
        saveAll.disabled = dirty.size === 0;
        toast(list.length === 1 ? t('Commission saved for {name}', { name: list[0].user.username }) : t('Commission saved for {n} users', { n: list.length }));
      }, () => {});
  };

  const rows = users.map((user) => {
    const row = { user, save: h('button', { type: 'button', class: 'icon-btn', title: t('Save'), disabled: true }, '💾') };
    row.inputs = Object.fromEntries(betTypes.map((bt) => [bt.id, cell(row, bt)]));
    row.save.addEventListener('click', () => save(row.save, [row]));
    return row;
  });
  saveAll.addEventListener('click', () => save(saveAll, [...dirty]));

  // Fill one % into every user listed below (then 💾 Save all).
  const bulkInputs = Object.fromEntries(betTypes.map((bt) =>
    [bt.id, h('input', { class: 'cell', type: 'number', min: 0, max: 100, step: 0.01, placeholder: '%', 'aria-label': `${t('All')} ${bt.code}` })]));
  const applyAll = h('button', {
    type: 'button',
    class: 'btn',
    onclick: () => {
      for (const bt of betTypes) {
        const v = bulkInputs[bt.id].value;
        if (v === '') continue;
        for (const row of rows) { row.inputs[bt.id].value = v; markDirty(row); }
      }
    },
  }, t('Apply to all listed'));

  const searchBox = input('search', { type: 'search', placeholder: t('Search username, name, phone'), value: query.get('search') ?? '' });
  searchBox.addEventListener('change', () => go({ search: searchBox.value.trim() }));
  const agentFilter = isMaster && select('agent',
    [['', t('All agents')], ['none', t('None (directly under me)')], ...agents.map((a) => [a.id, `${a.username} — ${a.name}`])],
    agentId, { onchange: (e) => go({ agent: e.target.value }) });

  mount(main,
    pageHeader(t('Commission'),
      isAdmin
        ? 'Master တစ်ဦးချင်း၏ ကော်မရှင် % — Master က သူ့အောက်ရှိ Agent / User များကို တဆင့်ပြန် သတ်မှတ်ပါမည်'
        : t('Commission % per bet type for each user, taken off the ticket price when the prize set says "use customer discount".'),
      saveAll),
    h('div', { class: 'toolbar' }, searchBox, agentFilter, h('span', { class: 'badge badge-muted' }, t('{n} users', { n: rows.length }))),
    rows.length > 0 && h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Set for all listed users'))),
      h('div', { class: 'actions', style: 'align-items:flex-end' },
        betTypes.map((bt) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, `${betTypeName(bt)} %`), bulkInputs[bt.id])),
        applyAll)),
    table(
      [
        { label: t('Username'), render: ({ user }) => h('a', { href: `#/users/${user.id}` }, user.username) },
        { label: t('Name'), render: ({ user }) => [user.name, user.name_mm && h('div', { class: 'muted' }, user.name_mm)] },
        isMaster && { label: t('Agent'), render: ({ user }) => user.parent_username ? h('a', { href: `#/users/${user.parent_id}` }, user.parent_username) : '—' },
        !isAdmin && { label: '', render: ({ user }) => badge(user.role) },
        { label: t('Status'), render: ({ user }) => badge(user.status) },
        ...betTypes.map((bt) => ({ label: `${betTypeName(bt)} %`, align: 'right', render: (row) => row.inputs[bt.id] })),
        { label: '', render: (row) => row.save },
      ].filter(Boolean),
      rows,
      { empty: search || agentId ? t('No matches') : isAdmin ? t('No masters yet') : t('No users yet') }));

}

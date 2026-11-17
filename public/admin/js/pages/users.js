import { api, cached, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { badge, balanceCell, busy, checkbox, confirmDialog, dateTime, field, h, input, mount, openModal, pageHeader, select, table, tabs, toast } from '/common/js/ui.js';
import { unlimitedCheckbox } from '/common/js/account-cards.js';

// Account lists of the admin dashboard. The admin sees every role (masters, agents, users, admins)
// and opens any of them — but an agent and a user never hang straight under the admin, so it picks
// the master (for an agent) or the master / agent (for a user) the new account belongs to. A master
// sees only its own tree — its agents and the users under it — and creates those; an agent only its
// own users, straight under itself.
export default async function users(main, { query, rerender }) {
  const viewer = session.get()?.user;
  const role0 = viewer?.role;
  const downline = role0 !== 'admin'; // a master or an agent: its own tree only
  const roles = { admin: ['master'], master: ['agent', 'user'], agent: ['user'] }[role0] ?? ['master'];
  // The roles this dashboard offers a "+ New …" button for.
  const canCreate = (r) => ({ admin: ['master'], master: ['agent', 'user'], agent: ['user'] }[role0] ?? []).includes(r);
  const role = roles.includes(query.get('role')) ? query.get('role') : roles.includes('agent') ? 'agent' : roles[0];
  // The admin is no upline for an agent or a user: it has to name the account they go under.
  const mustPickUpline = role0 === 'admin' && ['agent', 'user'].includes(role);
  const search = query.get('search') ?? '';
  const parentId = query.get('parent_id') ?? '';

  const qs = new URLSearchParams({ role, ...(search && { search }), ...(parentId && { parent_id: parentId }) });
  const [rows, agents, masters, prizeSets] = await Promise.all([
    api.get(`/users?${qs}`),
    role0 === 'agent' ? [] : api.get('/users?role=agent'),
    downline ? [] : api.get('/users?role=master'),
    cached('/prize-sets'),
  ]);
  const setName = (id) => prizeSets.find((s) => s.id === id)?.name ?? id;
  // Accounts an account of role `r` may hang under, besides the viewer itself. (An agent's users
  // hang under the agent itself, so it has none to choose from.)
  const uplines = (r) => (role0 === 'agent' ? [] : { user: [...masters, ...agents], agent: masters }[r] ?? []);

  const go = (params) => {
    const next = new URLSearchParams({ role, ...(search && { search }), ...(parentId && { parent_id: parentId }), ...params });
    for (const [k, v] of [...next]) if (!v) next.delete(k);
    location.hash = `#/users?${next}`;
  };

  const searchBox = input('search', { type: 'search', placeholder: t('Search username, name, phone'), value: search });
  searchBox.addEventListener('change', () => go({ search: searchBox.value.trim() }));

  const parentFilter = uplines(role).length > 0 &&
    select('parent_id', [['', role === 'agent' ? t('All masters') : t('All agents')], ...uplines(role).map((a) => [a.id, accountLabel(a)])], parentId, {
      onchange: (e) => go({ parent_id: e.target.value }),
    });

  // The account above this one (blank when it hangs straight under the viewer).
  const parentColumn = (label) => ({
    label,
    render: (u) => (u.parent_username && u.parent_id !== viewer?.id ? h('a', { href: `#/users/${u.parent_id}` }, u.parent_username) : '—'),
  });
  const columns = role === 'admin' ? [
    { label: t('Username'), render: (u) => h('a', { href: `#/users/${u.id}` }, u.username) },
    { label: t('Name'), render: (u) => [u.name, u.name_mm && h('div', { class: 'muted' }, u.name_mm)] },
    { label: t('Phone'), render: (u) => u.phone ?? '—' },
    { label: t('Status'), render: (u) => badge(u.status) },
    { label: t('Last login'), render: (u) => dateTime(u.last_login_at) },
  ] : [
    role === 'master' && { label: t('Logo'), render: (u) => masterLogo(u) },
    { label: t('Username'), render: (u) => h('a', { href: `#/users/${u.id}` }, u.username) },
    { label: t('Name'), render: (u) => [u.name, u.name_mm && h('div', { class: 'muted' }, u.name_mm)] },
    { label: t('Phone'), render: (u) => u.phone ?? '—' },
    role === 'master' && { label: t('Master name'), render: (u) => u.master_name ?? '—' },
    role !== 'admin' && { label: t('Email'), render: (u) => u.email ?? '—' },
    (role === 'agent' || role === 'user') && { label: t('Ledger email'), render: (u) => ledgerMailToggle(u, rerender) },
    role === 'user' && parentColumn(t('Agent')),
    role === 'agent' && !downline && parentColumn(t('Master')),
    role !== 'user' && {
      label: role === 'master' ? t('Accounts') : t('Users'),
      align: 'right',
      render: (u) => h('a', { href: `#/users?role=${role === 'master' ? 'agent' : 'user'}&parent_id=${u.id}` }, u.child_count),
    },
    role === 'user' && { label: t('Prize set'), render: (u) => setName(u.prize_set_id) },
    role === 'master' && role0 === 'admin' && {
      label: t('Hot numbers edit'),
      render: (u) => hotEditToggle(u, rerender),
    },
    { label: t('Balance'), align: 'right', render: (u) => balanceCell(u) },
    { label: t('Status'), render: (u) => badge(u.status) },
    role === 'master' && role0 === 'admin' && { label: t('Created'), render: (u) => dateTime(u.created_at) },
    role === 'master' && role0 === 'admin' && { label: '', render: (u) => closeMasterButton(u, rerender) },
    { label: t('Last login'), render: (u) => dateTime(u.last_login_at) },
  ].filter(Boolean);

  const titles = { master: t('Masters'), agent: t('Agents'), user: t('Users'), admin: t('Admins') };
  const subtitles = {
    master: t('Masters run their own agents and users, with their own balance'),
    agent: t('Agents sell to their own users and manage their wallets'),
    user: t('Betting accounts'),
    admin: t('Accounts that run this dashboard'),
  };
  const newLabels = { master: t('+ New master'), agent: t('+ New agent'), user: t('+ New user'), admin: t('+ New admin') };
  const empties = { master: t('No masters yet'), agent: t('No agents yet'), user: t('No users yet'), admin: t('No admins yet') };

  mount(main,
    pageHeader(titles[role], subtitles[role],
      canCreate(role) && h('button', {
        class: 'btn btn-primary',
        onclick: () => createAccount(role, uplines(role), prizeSets, parentId, downline, mustPickUpline),
      }, newLabels[role])),
    tabs(roles.map((r) => [r, titles[r]]), role, (r) => (location.hash = `#/users?role=${r}`)),
    h('div', { class: 'toolbar' }, searchBox, parentFilter),
    table(columns, role === 'master' && role0 === 'admin' ? [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))) : rows, {
      empty: search ? t('No matches') : empties[role],
      onRowClick: (u) => (location.hash = `#/users/${u.id}`),
    }));
}

const accountLabel = (a) => `${a.username} — ${a.name}${a.role === 'master' ? ` (${t('master')})` : ''}`;

function masterLogo(u) {
  if (!u.logo) return '—';
  return h('img', {
    src: u.logo, alt: '',
    style: 'width:36px;height:36px;object-fit:cover;border-radius:8px;display:block;background:#f3f4f6',
  });
}

function closeMasterButton(u, rerender) {
  const open = u.status === 'active';
  const set = async (e) => {
    e.stopPropagation();
    const button = e.currentTarget;
    const ok = await confirmDialog(
      open ? t('Close this master? They will not be able to sign in.') : t('Reopen this master account?'),
      { confirmLabel: open ? t('Close') : t('Reopen'), danger: open },
    );
    if (!ok) return;
    await busy(button, async () => {
      await api.patch(`/users/${u.id}`, { status: open ? 'suspended' : 'active' });
      toast(open ? t('Master closed') : t('Master reopened'));
      rerender();
    }).catch(() => {});
  };
  return h('div', { class: 'actions', onclick: (e) => e.stopPropagation() },
    h('button', { type: 'button', class: open ? 'btn btn-sm btn-danger' : 'btn btn-sm', onclick: set }, open ? t('Close') : t('Reopen')));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the logo'));
    reader.readAsDataURL(file);
  });
}

function ledgerMailToggle(u, rerender) {
  const on = !!u.ledger_mail;
  const set = (value) => async (e) => {
    e.stopPropagation();
    if (value === on) return;
    await busy(e.currentTarget, async () => {
      await api.patch(`/users/${u.id}`, { ledger_mail: value });
      toast(value ? t('Ledger email on for {name}', { name: u.username }) : t('Ledger email off for {name}', { name: u.username }));
      rerender();
    }).catch(() => {});
  };
  return h('div', { class: 'actions', onclick: (e) => e.stopPropagation() },
    h('button', { type: 'button', class: on ? 'btn btn-sm btn-good' : 'btn btn-sm', onclick: set(true) }, on ? t('On') : t('Off')));
}

function hotEditToggle(u, rerender) {
  const on = !!u.hot_edit;
  const set = (value) => async (e) => {
    e.stopPropagation();
    if (value === on) return;
    await busy(e.currentTarget, async () => {
      await api.patch(`/users/${u.id}`, { hot_edit: value });
      toast(value ? t('Hot numbers allowed for {name}', { name: u.username }) : t('Hot numbers denied for {name}', { name: u.username }));
      rerender();
    }).catch(() => {});
  };
  return h('div', { class: 'actions', onclick: (e) => e.stopPropagation() },
    h('button', { type: 'button', class: on ? 'btn btn-sm btn-good' : 'btn btn-sm', 'aria-pressed': String(on), onclick: set(true) }, `${on ? '✓ ' : ''}${t('Allow')}`),
    h('button', { type: 'button', class: !on ? 'btn btn-sm btn-danger' : 'btn btn-sm', 'aria-pressed': String(!on), onclick: set(false) }, `${!on ? '✓ ' : ''}${t('Deny')}`));
}

// parents: the accounts the new one may hang under besides its creator (a master's agents for a new
// user; the admin's masters and agents). Left on "None" it goes straight under the creator.
// mustPick: the creator cannot be the upline itself (the admin opening an agent or a user), so one
// of `parents` has to be chosen — the server refuses it otherwise.
function createAccount(role, parents, prizeSets, defaultParent, byDownline, mustPick = false) {
  const under = mustPick
    ? (role === 'agent' ? '— Master ရွေးပါ —' : '— Master / Agent ရွေးပါ —')
    : byDownline ? t('None (directly under me)') : t('None (directly under admin)');
  const body = h('div', { class: 'form-grid' },
    field(t('Username'), input('username', { required: true, minlength: 3, pattern: '[A-Za-z0-9_.]+', autocomplete: 'off' }), t('Letters, numbers, _ and .')),
    field(t('Password'), input('password', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
    field(t('Name'), input('name', { required: true })),
    role === 'master' && field(t('Master name'), input('master_name', { required: true, maxlength: 80 })),
    field(t('Myanmar name'), input('name_mm')),
    role !== 'admin' && field(t('Email'), input('email', { type: 'email', maxlength: 120 })),
    field(t('Phone'), input('phone')),
    field(t('Phone 2'), input('phone2')),
    parents.length > 0 &&
      field(role === 'agent' ? t('Master') : mustPick ? 'Master / Agent' : t('Agent'),
        select('parent_id', [['', under], ...parents.map((a) => [a.id, accountLabel(a)])], defaultParent),
        mustPick ? 'Admin အောက် တိုက်ရိုက် မထားနိုင်ပါ — အထက်အကောင့် ရွေးပါ' : undefined),
    role === 'user' && field(t('Prize set'), select('prize_set_id', prizeSets.map((s) => [s.id, s.name]), prizeSets[0]?.id ?? 0)),
    h('div', { class: 'span-all' }, field(t('Address'), input('address'))),
    role === 'master' && h('div', { class: 'span-all' }, field(t('Logo'), input('logo', { type: 'file', accept: 'image/*' }))),
    (role === 'agent' || role === 'user') && h('div', { class: 'span-all' }, checkbox('ledger_mail', t('Send ledger email'), false, t('When a term closes, email the 00-99 and 000-999 ledger to this account.'))),
    role !== 'admin' && h('div', { class: 'span-all' }, unlimitedCheckbox(role, false)));

  openModal({
    title: { master: t('New master'), agent: t('New agent'), user: t('New user'), admin: t('New admin') }[role],
    body,
    submitLabel: t('Create'),
    onSubmit: async (v, form) => {
      if (mustPick && !v.parent_id) throw new Error(role === 'agent' ? 'ဘယ် Master အောက်လဲ ရွေးပါ' : 'ဘယ် Master / Agent အောက်လဲ ရွေးပါ');
      const payload = { username: v.username.trim(), password: v.password, role, name: v.name.trim() };
      if (role !== 'admin') payload.unlimited = v.unlimited === 'on';
      if (role === 'user') payload.prize_set_id = Number(v.prize_set_id);
      if (role === 'master') {
        if (!v.master_name?.trim()) throw new Error('Master name is required');
        payload.master_name = v.master_name.trim();
        const file = form.querySelector('input[name="logo"]')?.files?.[0];
        if (file) {
          if (file.size > 350000) throw new Error('Logo must be under 350 KB');
          payload.logo = await fileToDataUrl(file);
        }
      }
      if (v.email?.trim()) payload.email = v.email.trim();
      if (role === 'agent' || role === 'user') payload.ledger_mail = v.ledger_mail === 'on';
      for (const key of ['name_mm', 'phone', 'phone2', 'address']) if (v[key]?.trim()) payload[key] = v[key].trim();
      if (v.parent_id) payload.parent_id = Number(v.parent_id);
      const created = await api.post('/users', payload);
      toast(t('{name} created', { name: created.username }));
      location.hash = `#/users/${created.id}`;
    },
  });
}

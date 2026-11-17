import { api, cached, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { activateNav, badge, balanceCell, busy, confirmDialog, field, h, money, mount, pageHeader, select, table, toast } from '/common/js/ui.js';
import { changePasswordCard, discountCard, passwordCard, payAccountsCard, profileCard, walletCard, walletHistoryCard } from '/common/js/account-cards.js';

// Also the signed-in admin's own Profile page (#/profile): no id in the path -> their own account.
export default async function userDetail(main, { params, rerender }) {
  const id = params[0] ? Number(params[0]) : session.get()?.user?.id;
  const [user, meta, prizeSets, transactions] = await Promise.all([
    api.get(`/users/${id}`),
    cached('/meta'),
    cached('/prize-sets'),
    api.get(`/wallet/transactions?user_id=${id}&limit=50`),
  ]);
  const viewer = session.get()?.user;
  const byAdmin = viewer?.role === 'admin';
  const hasChildren = ['master', 'agent'].includes(user.role);
  const children = hasChildren && !byAdmin ? await api.get(`/users?parent_id=${id}`) : [];
  const parent = user.parent_id ? await api.get(`/users/${user.parent_id}`).catch(() => null) : null;
  const isSelf = viewer?.id === user.id;
  const isAdmin = user.role === 'admin';
  // The admin's own cash only moves in and out of a master; a master / agent moves it anywhere in
  // its own tree. ကော်မရှင် is handed down one step at a time (see src/routes/users.js).
  const canMove = !byAdmin && !isSelf;
  const canSetCommission = !byAdmin && !isSelf && ({ master: ['agent', 'user'], agent: ['user'] }[viewer?.role] ?? []).includes(user.role);
  // အကျွံများသိမ်း: the admin turns it on for a master; a master turns it on for an agent.
  const canSetSaleOver = !isSelf && ((byAdmin && user.role === 'master') || (viewer?.role === 'master' && user.role === 'agent'));
  const canSetHotEdit = byAdmin && !isSelf && user.role === 'master';
  // A master / an agent hands over its own money (see services/wallet.js); the admin's deposits are
  // new money.
  const walletHint = !byAdmin && !isSelf && (viewer.unlimited
    ? t('You have an unlimited wallet: you can deposit even without balance ({amount} Ks now).', { amount: money(viewer.balance) })
    : t('Deposits come from your balance ({amount} Ks); withdrawals go back to it.', { amount: money(viewer.balance) }));
  activateNav(params[0] ? `#/users?role=${user.role}` : '#/profile');

  mount(main,
    pageHeader(
      h('span', {}, user.username, ' ', badge(user.role), ' ', badge(user.status)),
      [user.name, user.name_mm && ` · ${user.name_mm}`, parent && ` · ${t('under')} `, parent && h('a', { href: `#/users/${parent.id}` }, parent.username)],
      params[0] && h('a', { class: 'btn', href: `#/users?role=${user.role}` }, t('← Back'))),
    h('div', { class: 'grid grid-2' },
      profileCard(user, { prizeSets: user.role === 'user' ? prizeSets : null, canSetUnlimited: !isAdmin && !isSelf, isSelf, rerender }),
      h('div', { class: 'grid' },
        !byAdmin && !isAdmin && walletCard(user, { isSelf, rerender, hint: walletHint, canMove }),
        isSelf ? changePasswordCard() : passwordCard(user))),
    user.role !== 'user' && payAccountsCard(user, { rerender }),
    canSetCommission && discountCard(user, meta.bet_types),
    canSetSaleOver && saleOverCard(user, rerender),
    canSetHotEdit && hotEditCard(user, rerender),
    viewer?.role === 'admin' && !isSelf && await roleCard(user, rerender),
    !byAdmin && hasChildren && childrenCard(user, children, isSelf),
    !byAdmin && !isAdmin && walletHistoryCard(transactions));
}

function hotEditCard(account, rerender) {
  const on = !!account.hot_edit;
  const set = (value) => async (e) => {
    if (value === on) return;
    await busy(e.currentTarget, async () => {
      await api.patch(`/users/${account.id}`, { hot_edit: value });
      toast(value ? t('Hot numbers allowed for {name}', { name: account.username }) : t('Hot numbers denied for {name}', { name: account.username }));
      rerender();
    }).catch(() => {});
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', {}, t('Hot numbers edit')),
        h('p', { class: 'muted', style: 'margin:4px 0 0' }, t('When allowed, this master can add and edit this term\'s hot numbers.')))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: on ? 'btn btn-good' : 'btn', 'aria-pressed': String(on), onclick: set(true) }, `${on ? '✓ ' : ''}${t('Allow')}`),
      h('button', { type: 'button', class: !on ? 'btn btn-danger' : 'btn', 'aria-pressed': String(!on), onclick: set(false) }, `${!on ? '✓ ' : ''}${t('Deny')}`)));
}

function saleOverCard(account, rerender) {
  const on = !!account.sale_over;
  const set = (value) => async (e) => {
    if (value === on) return;
    await busy(e.currentTarget, async () => {
      await api.patch(`/users/${account.id}`, { sale_over: value });
      toast(value ? t('Over-break save allowed for {name}', { name: account.username }) : t('Over-break save denied for {name}', { name: account.username }));
      rerender();
    }).catch(() => {});
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', {}, t('Save over-limit')),
        h('p', { class: 'muted', style: 'margin:4px 0 0' }, t('When allowed, this account can save bets over the unit break on the Sale page.')))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: on ? 'btn btn-good' : 'btn', 'aria-pressed': String(on), onclick: set(true) }, `${on ? '✓ ' : ''}${t('Allow')}`),
      h('button', { type: 'button', class: !on ? 'btn btn-danger' : 'btn', 'aria-pressed': String(!on), onclick: set(false) }, `${!on ? '✓ ' : ''}${t('Deny')}`)));
}

// Role (admin only): turn an account into another role — e.g. an old view-only admin into a
// user — keeping its login and history. The server refuses changes that would break the tree or
// the ledger (a user with slips, accounts under it that would no longer fit, an admin with money).
const ROLE_NAMES = { admin: 'Admin', master: 'Master', agent: 'Agent', user: 'User' };
// Role change goes by the server's PARENT_ROLES (src/routes/users.js): an account opened before the
// "no agent / user straight under the admin" rule may still sit there, so this keeps admin in.
const PARENT_ROLES = { master: ['admin'], agent: ['admin', 'master'], user: ['admin', 'master', 'agent'] };

async function roleCard(user, rerender) {
  const uplines = (await api.get('/users')).filter((u) => u.id !== user.id && ['admin', 'master', 'agent'].includes(u.role));
  const roleSelect = select('role', Object.entries(ROLE_NAMES), user.role);
  const parentSelect = select('parent_id', [], '');
  const fill = () => {
    const allowed = PARENT_ROLES[roleSelect.value] ?? [];
    parentSelect.replaceChildren(...[['', roleSelect.value === 'admin' ? '— (Admin: အထက်မရှိ)' : 'အလိုအလျောက် (လက်ရှိ အထက် / Admin)'],
      ...uplines.filter((u) => allowed.includes(u.role)).map((u) => [u.id, `${u.username} — ${u.name} (${ROLE_NAMES[u.role]})`])]
      .map(([v, l]) => h('option', { value: v, selected: String(v) === String(user.parent_id ?? '') && roleSelect.value !== 'admin' }, l)));
    parentSelect.disabled = roleSelect.value === 'admin';
  };
  roleSelect.addEventListener('change', fill);
  fill();
  const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Role ပြောင်းမည်');
  save.addEventListener('click', async () => {
    const role = roleSelect.value;
    const ok = await confirmDialog(`${user.username} ကို ${ROLE_NAMES[role]} အဖြစ် ပြောင်းမလား? (login / password / မှတ်တမ်း မပြောင်းပါ)`,
      { title: 'Role ပြောင်းရန်', confirmLabel: 'ပြောင်းမည်', danger: false });
    if (!ok) return;
    await busy(save, () => api.put(`/users/${user.id}/role`, { role, ...(parentSelect.value && { parent_id: Number(parentSelect.value) }) }))
      .then((u) => { toast(`${u.username} → ${ROLE_NAMES[u.role]}`); rerender(); }, (e) => toast(e.message, 'bad'));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {},
      h('h2', {}, 'Role ပြောင်းရန်'),
      h('p', { class: 'muted', style: 'margin:4px 0 0' }, 'Login၊ password၊ ငွေစာရင်း မှတ်တမ်းများ မပြောင်းပါ။ စလစ်ရှိသော user ကို user အဖြစ်သာ ထားရမည်။'))),
    h('div', { class: 'form-grid' }, field('Role', roleSelect), field('အထက်အကောင့်', parentSelect)),
    h('div', { class: 'form-actions' }, save));
}

// The accounts straight under a master (its agents and direct users) or an agent (its users).
function childrenCard(agent, children, isSelf) {
  const listRole = agent.role === 'master' ? 'agent' : 'user';
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, t(agent.role === 'master' ? 'Accounts under {name} ({n})' : 'Users under {name} ({n})', { name: agent.username, n: children.length })),
      !isSelf && h('a', { href: `#/users?role=${listRole}&parent_id=${agent.id}` }, t(listRole === 'agent' ? 'Open in Agents →' : 'Open in Users →'))),
    table(
      [
        { label: t('Username'), render: (u) => h('a', { href: `#/users/${u.id}` }, u.username) },
        { label: '', render: (u) => badge(u.role) },
        { label: t('Name'), key: 'name' },
        { label: t('Balance'), align: 'right', render: (u) => balanceCell(u) },
        { label: t('Status'), render: (u) => badge(u.status) },
      ],
      children,
      { empty: agent.role === 'master' ? t('No accounts under this master yet') : t('This agent has no users yet'), onRowClick: (u) => (location.hash = `#/users/${u.id}`) }));
}

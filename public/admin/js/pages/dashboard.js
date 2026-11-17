import { api, session } from '/common/js/api.js';
import { onLive } from '/common/js/live.js';
import { deleteRequestActions } from './slip-cancel-requests.js';
import { t } from '/common/js/i18n.js';
import { badge, dateTime, h, money, mount, pageHeader, table } from '/common/js/ui.js';

const stat = (label, value, sub, cls = '') =>
  h('div', { class: `card stat ${cls}`.trim() }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub && h('div', { class: 'sub' }, sub));

export default async function dashboard(main, { rerender }) {
  const role = session.get()?.user?.role;
  const admin = role === 'admin';
  const book = role === 'master';
  // A master / an agent runs its own tree: its own balance comes first (every deposit it makes
  // comes out of it). Slip delete requests are scoped to that tree (the agent's own users).
  const own = !admin;
  const [overview, terms, folders, deleteRequests, myAccount] = await Promise.all([
    api.get('/reports/overview'),
    admin ? Promise.resolve([]) : api.get('/terms'),
    admin ? Promise.resolve([]) : api.get('/term-folders'),
    admin ? Promise.resolve([]) : api.get('/slip-cancel-requests?status=pending'),
    own ? api.get('/auth/me') : Promise.resolve(null),
  ]);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const byRole = (role) => overview.accounts.find((a) => a.role === role) ?? { count: 0, active: 0, balance: 0 };
  const termCount = (status) => overview.terms.find((x) => x.status === status)?.count ?? 0;
  const masters = byRole('master');
  const agents = byRole('agent');
  const users = byRole('user');
  mount(main,
    pageHeader(t('Dashboard'), admin ? t('Open master accounts') : t('Overview of accounts, balances and draws'),
      admin && h('a', { class: 'btn btn-primary', href: '#/users?role=master' }, t('Masters')),
      !admin && h('a', { class: 'btn', href: role === 'agent' ? '#/users?role=user' : '#/users?role=agent' },
        role === 'agent' ? t('Users') : t('Manage agents')),
      !admin && h('a', { class: 'btn btn-primary', href: '#/terms' }, book ? t('Manage terms') : t('Terms'))),
    h('div', { class: own ? 'stats stats-compact' : 'stats' },
      own && stat(t('My balance'), `${money(myAccount.balance)} ${t('Ks')}`, myAccount.unlimited ? t('Unlimited wallet') : null, 'stat-hero'),
      admin && masters.count > 0 && stat(t('Masters'), masters.count, t('{n} active', { n: masters.active })),
      admin && masters.count > 0 && stat(t('Master balances'), money(masters.balance), t('Ks held by masters')),
      !admin && role !== 'agent' && stat(t('Agents'), agents.count, t('{n} active', { n: agents.active })),
      !admin && stat(t('Users'), users.count, t('{n} active', { n: users.active })),
      !admin && role !== 'agent' && stat(t('Agent balances'), money(agents.balance), t('Ks held by agents')),
      !admin && stat(t('User balances'), money(users.balance), t('Ks held by users')),
      !admin && stat(t("Today's sales"), money(overview.today.sales), t('{n} tickets', { n: overview.today.tickets })),
      !admin && stat(t('Open terms'), termCount('open'), t('{n} waiting to settle', { n: termCount('drawn') }))),
    // Users' slip delete requests waiting in this tree — Approve / Reject here (all: own page).
    !admin && h('div', { class: 'card delete-requests-card', style: 'margin-bottom:16px' },
      h('div', { class: 'card-head' },
        h('h2', {}, t('Slip delete requests'), ' ', deleteRequests.length > 0 && h('span', { class: 'badge badge-warn' }, deleteRequests.length)),
        h('a', { href: '#/slip-cancel-requests' }, t('View all →'))),
      table(
        [
          { label: t('Date'), render: (r) => dateTime(r.created_at) },
          { label: t('User'), render: (r) => r.username },
          { label: t('Slip'), render: (r) => h('strong', {}, r.slip_no) },
          { label: t('Term'), render: (r) => r.term_description },
          { label: t('Amount'), align: 'right', render: (r) => money(r.net_amount) },
          { label: '', render: (r) => deleteRequestActions(r, rerender) },
        ],
        deleteRequests.slice(0, 8),
        { empty: t('No pending requests') })),
    !admin && h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Recent terms')), h('a', { href: '#/terms' }, t('View all →'))),
      table(
        [
          { label: 'ဖိုင်', render: (x) => folderName.get(x.folder_id) ?? '—' },
          { label: t('Term'), render: (x) => h('a', { href: `#/terms/${x.id}` }, x.description) },
          { label: t('Unit price'), align: 'right', render: (x) => money(x.unit_price) },
          { label: t('Closes'), render: (x) => dateTime(x.close_at) },
          { label: t('Status'), render: (x) => badge(x.status) },
        ],
        terms.slice(0, 8),
        { empty: t('No terms yet — create one on the Terms page'), onRowClick: (x) => (location.hash = `#/terms/${x.id}`) }
      )));

  // A new or decided delete request refreshes the dashboard (stops once another page is shown).
  if (admin) return;
  const card = main.querySelector('.delete-requests-card');
  const stop = onLive('slip-cancel-requests', () => {
    if (!card?.isConnected) return stop();
    rerender();
  });
}

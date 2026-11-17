import { api, cached } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { balanceCell, dateTime, field, h, input, money, mount, openModal, pageHeader, select, table, toast } from '/common/js/ui.js';
import { isTermOpen, ticketTable } from '/common/js/term-reports.js';
import { onLive } from '/common/js/live.js';
import { walletRequestActions, walletRequestTypeCell } from '/common/js/pages/wallet-requests.js';
import { createUser } from './users.js';

// ⇄ Transfer: give money to one of my users (ငွေဖြည့် — out of my balance) or take it back
// (ငွေထုတ် — into my balance). Same as the Deposit / Withdraw buttons on a user's page.
function transfer(users, done) {
  openModal({
    title: t('Transfer'),
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-all' }, field(t('User'), select('user_id', [['', t('Select user')], ...users.map((u) => [u.id, `${u.username} · ${money(u.balance)} Ks`])], '', { required: true }))),
      field(t('Type'), select('kind', [['deposit', t('Deposit')], ['withdraw', t('Withdraw')]], 'deposit')),
      field(t('Amount (Ks)'), input('amount', { type: 'number', min: 1, step: 1, required: true })),
      h('div', { class: 'span-all' }, field(t('Note (optional)'), input('note', { maxlength: 255 })))),
    submitLabel: t('Transfer'),
    onSubmit: async (v) => {
      const amount = Number(v.amount);
      if (!Number.isInteger(amount) || amount <= 0) throw new Error(t('Enter a whole amount above 0'));
      await api.post(`/wallet/${v.kind}`, { user_id: Number(v.user_id), amount, ...(v.note?.trim() && { note: v.note.trim() }) });
      toast(t(v.kind === 'deposit' ? 'Deposited {amount} Ks' : 'Withdrew {amount} Ks', { amount: money(amount) }));
      done();
    },
  });
}

const stat = (label, value, sub) =>
  h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub && h('div', { class: 'sub' }, sub));

export default async function dashboard(main, { rerender }) {
  const [me, overview, terms, recent, meta, requests, myUsers] = await Promise.all([
    api.get('/auth/me'),
    api.get('/reports/overview'),
    api.get('/terms?status=open'),
    api.get('/tickets?limit=8'),
    cached('/meta'),
    api.get('/wallet-requests?status=pending'),
    api.get('/users?role=user'),
  ]);
  const users = overview.accounts.find((a) => a.role === 'user') ?? { count: 0, active: 0, balance: 0 };
  const now = new Date();
  const openTerms = terms.filter((x) => isTermOpen(x, now));
  // Open terms whose Ledger (betting opens) time is still ahead: shown so agents see what's next.
  const upcoming = terms.filter((x) => x.open_at && now < new Date(x.open_at) && !(x.close_at && now >= new Date(x.close_at)));
  const listed = [...openTerms, ...upcoming.reverse()];
  const openIds = new Set(openTerms.map((x) => x.id));

  mount(main,
    pageHeader(t('Dashboard'), t('Welcome, {name}', { name: me.name }),
      h('a', { class: 'btn', href: '#/users' }, t('My users')),
      h('button', { type: 'button', class: 'btn', onclick: () => transfer(myUsers, rerender) }, `⇄ ${t('Transfer')}`),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: createUser }, t('+ New user'))),
    h('div', { class: 'stats' },
      stat(t('My balance'), balanceCell(me), me.unlimited ? t('Unlimited wallet: may go below zero. A negative balance is the amount owed.') : t('Ks available to give users')),
      stat(t('My users'), users.count, t('{n} active', { n: users.active })),
      stat(t('User balances'), money(users.balance), t('Ks held by users')),
      stat(t("Today's sales"), money(overview.today.sales), t('{n} tickets', { n: overview.today.tickets }))),
    // My users' deposit / withdraw requests — Approve / Reject right here.
    h('div', { class: 'card wallet-requests-card' },
      h('div', { class: 'card-head' },
        h('h2', {}, t('Wallet requests'), ' ', requests.length > 0 && h('span', { class: 'badge badge-warn' }, requests.length)),
        h('a', { href: '#/wallet-requests' }, t('View all →'))),
      table(
        [
          { label: t('Date'), render: (r) => dateTime(r.created_at) },
          { label: t('User'), render: (r) => h('a', { href: `#/users/${r.user_id}` }, r.username) },
          { label: t('Type'), render: walletRequestTypeCell },
          { label: t('Amount'), align: 'right', render: (r) => h('strong', {}, money(r.amount)) },
          { label: t('Method'), render: (r) => [r.method, r.txn_ref || r.account_no].filter(Boolean).join(' · ') },
          { label: '', render: (r) => walletRequestActions(r, rerender) },
        ],
        requests.slice(0, 10),
        { empty: t('No pending requests') })),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Open and upcoming terms'))),
      table(
        [
          { label: t('Term'), key: 'description' },
          { label: t('Status'), render: (x) => openIds.has(x.id)
              ? h('span', { class: 'badge badge-good' }, t('Open now'))
              : h('span', { class: 'badge badge-info' }, t('Opens {time}', { time: dateTime(x.open_at) })) },
          { label: t('Unit price'), align: 'right', render: (x) => money(x.unit_price) },
          { label: t('Closes'), render: (x) => dateTime(x.close_at) },
          { label: '', render: (x) => h('div', { class: 'actions' },
              h('a', { class: 'btn btn-sm', href: `#/reports?term=${x.id}` }, t('Report'))) },
        ],
        listed,
        { empty: t('No term is open for betting right now.') })),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Recent slips')), h('a', { href: '#/tickets' }, t('View all →'))),
      ticketTable(recent, { betTypes: meta.bet_types, showTerm: true, canCancel: (x) => openIds.has(x.term_id), onChange: rerender })));

  // A new or decided wallet request refreshes the dashboard (stops once another page is shown).
  const card = main.querySelector('.wallet-requests-card');
  const stop = onLive('wallet-requests', () => {
    if (!card?.isConnected) return stop();
    rerender();
  });
}

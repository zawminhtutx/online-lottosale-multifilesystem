// Deposit / withdraw requests from the caller's downline (the mobile app's ငွေဖြည့် / ငွေထုတ်, and
// agents / masters asking the account above them). Approving moves the money like a manual
// deposit/withdraw (out of or back into the deciding master's / agent's own balance); rejecting
// leaves balances alone. New requests appear live (WebSocket "wallet-requests").
// The admin decides its own masters' requests only; an agent's or a user's request belongs to the
// master / agent above it, so the admin sees those as history with no buttons (the server refuses
// them too).
import { api, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { onLive } from '/common/js/live.js';
import { busy, confirmDialog, dateTime, field, h, input, money, mount, openModal, pageHeader, select, table, tabs, toast } from '/common/js/ui.js';

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad', cancelled: 'muted' };
const TABS = [['pending', 'Pending'], ['all', 'All']];

// Approve (after a confirm): moves the money. Shared with the agent dashboard.
export async function approveWalletRequest(r, button, done) {
  const isAgent = session.get().user.role !== 'admin'; // a master or an agent pays out of its own balance
  const what = r.type === 'deposit'
    ? t('Deposit {amount} Ks to {user}?', { amount: money(r.amount), user: r.username })
    : t('Withdraw {amount} Ks from {user}?', { amount: money(r.amount), user: r.username });
  const hint = isAgent
    ? (r.type === 'deposit' ? t('The amount comes out of your balance.') : t('The amount goes back into your balance.'))
    : '';
  if (!(await confirmDialog(`${what} ${hint}`, { title: t('Approve request'), confirmLabel: t('Approve'), danger: false }))) return;
  await busy(button, async () => {
    await api.post(`/wallet-requests/${r.id}/approve`);
    toast(t('Request approved'));
    done();
  }).catch(() => {});
}

// Reject (optional reason): balances stay as they are. Shared with the agent dashboard.
export function rejectWalletRequest(r, done) {
  openModal({
    title: t('Reject request'),
    body: field(t('Reason (optional)'), input('reason', { maxlength: 255 })),
    submitLabel: t('Reject'),
    danger: true,
    onSubmit: async (v) => {
      await api.post(`/wallet-requests/${r.id}/reject`, { reason: v.reason || undefined });
      toast(t('Request rejected'));
      done();
    },
  });
}

// Approve / Reject buttons for one pending request from the downline. A request the signed-in
// master / agent sent upward itself can only be cancelled (the account above decides it). The admin
// gets buttons on a master's own request only — the rest it just reads.
export function walletRequestActions(r, done) {
  if (r.status !== 'pending') return null;
  if (session.get().user.role === 'admin' && r.user_role !== 'master') {
    return h('span', { class: 'muted' }, 'သက်ဆိုင်ရာ Master / Agent က အတည်ပြုရမည်');
  }
  if (r.user_id === session.get().user.id) {
    const cancel = h('button', { type: 'button', class: 'btn btn-sm' }, t('Cancel'));
    cancel.addEventListener('click', async (e) => {
      e.stopPropagation();
      await busy(cancel, async () => {
        await api.post(`/wallet-requests/${r.id}/cancel`);
        toast(t('Request cancelled'));
        done();
      }).catch(() => {});
    });
    return cancel;
  }
  const ok = h('button', { type: 'button', class: 'btn btn-sm btn-good' }, t('Approve'));
  ok.addEventListener('click', (e) => { e.stopPropagation(); approveWalletRequest(r, ok, done); });
  const no = h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: (e) => { e.stopPropagation(); rejectWalletRequest(r, done); } }, t('Reject'));
  return h('div', { class: 'actions' }, ok, no);
}

export const walletRequestTypeCell = (r) =>
  h('span', { class: `badge ${r.type === 'deposit' ? 'badge-good' : 'badge-warn'}` }, t(r.type === 'deposit' ? 'Deposit' : 'Withdraw'));

export default async function walletRequests(main, { query, rerender }) {
  const tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'pending';
  const rows = await api.get(`/wallet-requests${tab === 'pending' ? '?status=pending' : ''}`);

  const card = h('div', { class: 'card' },
    table(
      [
        { label: t('Date'), render: (r) => dateTime(r.created_at) },
        { label: t('User'), render: (r) => [h('a', { href: `#/users/${r.user_id}` }, r.username), h('div', { class: 'muted' }, r.user_name)] },
        { label: t('Type'), render: walletRequestTypeCell },
        { label: t('Amount'), align: 'right', render: (r) => h('strong', {}, money(r.amount)) },
        { label: t('Method'), render: (r) => r.method },
        { label: t('Account'), render: (r) => [r.account_name, r.account_no].filter(Boolean).join(' · ') || '—' },
        { label: t('Transaction No.'), render: (r) => r.txn_ref || '—' },
        { label: t('Balance'), align: 'right', render: (r) => money(r.user_balance) },
        { label: t('Note'), render: (r) => r.note || '—' },
        { label: t('Status'), render: (r) => [
            h('span', { class: `badge badge-${STATUS_TONE[r.status] ?? 'muted'}` }, t(r.status)),
            r.reject_reason && h('div', { class: 'muted' }, r.reject_reason),
            r.decided_by_username && h('div', { class: 'muted' }, `${r.decided_by_username} · ${dateTime(r.decided_at)}`),
          ] },
        { label: '', render: (r) => walletRequestActions(r, rerender) },
      ],
      rows,
      { empty: tab === 'pending' ? t('No pending requests') : t('No requests yet') }));

  // New / decided requests elsewhere refresh this page.
  const stop = onLive('wallet-requests', () => {
    if (!card.isConnected) return stop();
    rerender();
  });

  const me = session.get().user;
  mount(main,
    pageHeader(t('Wallet requests'),
      me.role === 'admin'
        ? 'Master ၏ တောင်းဆိုမှုကို Admin က အတည်ပြုနိုင်သည် — Agent / User ၏ တောင်းဆိုမှုကို သက်ဆိုင်ရာ Master / Agent က လုပ်ပါမည် (Admin မှာ မှတ်တမ်းသာ)'
        : t('Deposit and withdraw requests from users (mobile app). Approving moves the money.'),
      // ငွေလက်ခံ upward: a master asks the admin, an agent its master (or the admin).
      me.role !== 'admin' && me.parent_id && h('button', { class: 'btn btn-primary', onclick: () => askUpline(rerender).catch((e) => toast(e.message, 'bad')) },
        t('+ Ask my upline'))),
    tabs(TABS.map(([k, label]) => [k, t(label)]), tab, (k) => (location.hash = k === 'pending' ? '#/wallet-requests' : `#/wallet-requests?tab=${k}`)),
    card);
}

const METHODS = ['KPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Cash', 'Other'];

// A deposit / withdraw request from the signed-in master or agent to the account above it. Shows
// where to send the money (that account's KPay / WavePay numbers) for a deposit.
async function askUpline(done) {
  const payTo = await api.get('/wallet-requests/pay-to');
  const payLines = payTo && [
    payTo.kpay_no && `KPay ${payTo.kpay_no}${payTo.kpay_name ? ` (${payTo.kpay_name})` : ''}`,
    payTo.wave_no && `WavePay ${payTo.wave_no}${payTo.wave_name ? ` (${payTo.wave_name})` : ''}`,
  ].filter(Boolean);
  openModal({
    title: t('Ask my upline'),
    body: h('div', { class: 'form-grid' },
      payLines?.length > 0 && h('div', { class: 'span-all notice' }, t('Send deposits to {name}:', { name: payTo.username }), ' ', h('strong', {}, payLines.join(' · '))),
      field(t('Type'), select('type', [['deposit', t('Deposit')], ['withdraw', t('Withdraw')]], 'deposit')),
      field(t('Amount (Ks)'), input('amount', { type: 'number', min: 1, step: 1, required: true })),
      field(t('Method'), select('method', METHODS.map((m) => [m, m]), 'KPay')),
      field(t('Transaction No.'), input('txn_ref', { maxlength: 100 })),
      field(t('Account name'), input('account_name', { maxlength: 100 })),
      field(t('Account number'), input('account_no', { maxlength: 50 }), t('Withdraw: the account to receive the money')),
      h('div', { class: 'span-all' }, field(t('Note (optional)'), input('note', { maxlength: 255 })))),
    submitLabel: t('Send request'),
    onSubmit: async (v) => {
      const body = { type: v.type, amount: Number(v.amount), method: v.method };
      for (const key of ['txn_ref', 'account_name', 'account_no', 'note']) if (v[key]?.trim()) body[key] = v[key].trim();
      await api.post('/wallet-requests', body);
      toast(t('Request sent'));
      done();
    },
  });
}

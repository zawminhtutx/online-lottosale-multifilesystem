// Slip delete requests from users (online web 🗑). Approving cancels the slip and refunds its net
// amount; rejecting leaves the slip valid (it is settled and paid like any other). New requests
// appear live (WebSocket "slip-cancel-requests").
import { api } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { onLive } from '/common/js/live.js';
import { badge, busy, confirmDialog, dateTime, field, h, input, money, mount, openModal, pageHeader, table, tabs, toast } from '/common/js/ui.js';

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad' };
const TABS = [['pending', 'Pending'], ['all', 'All']];

// Approve (after a confirm): the slip is cancelled and refunded. Shared with the dashboard card.
export async function approveDeleteRequest(r, button, done) {
  const message = t('Delete slip {slip} of {user}? {amount} Ks is refunded to the user.', { slip: r.slip_no, user: r.username, amount: money(r.net_amount) });
  if (!(await confirmDialog(message, { title: t('Approve request'), confirmLabel: t('Approve'), danger: true }))) return;
  await busy(button, async () => {
    await api.post(`/slip-cancel-requests/${r.id}/approve`);
    toast(t('Slip deleted'));
    done();
  }).catch(() => {});
}

// Reject (optional reason): the slip stays valid. Shared with the dashboard card.
export function rejectDeleteRequest(r, done) {
  openModal({
    title: t('Reject request'),
    body: field(t('Reason (optional)'), input('reason', { maxlength: 255 })),
    submitLabel: t('Reject'),
    danger: true,
    onSubmit: async (v) => {
      await api.post(`/slip-cancel-requests/${r.id}/reject`, { reason: v.reason || undefined });
      toast(t('Request rejected'));
      done();
    },
  });
}

// Approve / Reject buttons for one pending request.
export function deleteRequestActions(r, done) {
  if (r.status !== 'pending') return null;
  const ok = h('button', { type: 'button', class: 'btn btn-sm btn-danger' }, t('Approve'));
  ok.addEventListener('click', (e) => { e.stopPropagation(); approveDeleteRequest(r, ok, done); });
  const no = h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); rejectDeleteRequest(r, done); } }, t('Reject'));
  return h('div', { class: 'actions' }, ok, no);
}

export default async function slipCancelRequests(main, { query, rerender }) {
  const tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'pending';
  const rows = await api.get(`/slip-cancel-requests${tab === 'pending' ? '?status=pending' : ''}`);

  const card = h('div', { class: 'card' },
    table(
      [
        { label: t('Date'), render: (r) => dateTime(r.created_at) },
        { label: t('User'), render: (r) => [h('a', { href: `#/users/${r.user_id}` }, r.username), h('div', { class: 'muted' }, r.user_name)] },
        { label: t('Slip'), render: (r) => h('strong', {}, r.slip_no) },
        { label: t('Term'), render: (r) => [h('a', { href: `#/terms/${r.term_id}` }, r.term_description), ' ', badge(r.term_status)] },
        { label: t('Amount'), align: 'right', render: (r) => money(r.net_amount) },
        { label: t('Slip status'), render: (r) => badge(r.ticket_status) },
        { label: t('Status'), render: (r) => [
            h('span', { class: `badge badge-${STATUS_TONE[r.status] ?? 'muted'}` }, t(r.status)),
            r.reject_reason && h('div', { class: 'muted' }, r.reject_reason),
            r.decided_by_username && h('div', { class: 'muted' }, `${r.decided_by_username} · ${dateTime(r.decided_at)}`),
          ] },
        { label: '', render: (r) => deleteRequestActions(r, rerender) },
      ],
      rows,
      { empty: tab === 'pending' ? t('No pending requests') : t('No requests yet') }));

  // New / decided requests elsewhere refresh this page.
  const stop = onLive('slip-cancel-requests', () => {
    if (!card.isConnected) return stop();
    rerender();
  });

  mount(main,
    pageHeader(t('Slip delete requests'), t('Users ask to delete a slip. Approve = the slip is cancelled and refunded. Reject or no answer = the slip stays and is paid if it wins.')),
    tabs(TABS.map(([k, label]) => [k, t(label)]), tab, (k) => (location.hash = k === 'pending' ? '#/slip-cancel-requests' : `#/slip-cancel-requests?tab=${k}`)),
    card);
}

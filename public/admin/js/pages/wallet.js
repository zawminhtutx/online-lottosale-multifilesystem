import { api, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { h, money, mount, pageHeader, select } from '/common/js/ui.js';
import { walletTable } from '/common/js/account-cards.js';

const TYPES = [
  ['', 'ALL'],
  ['deposit', 'Deposit'],
  ['withdraw', 'Withdraw'],
  ['transfer_in', 'Transfer In'],
  ['transfer_out', 'Transfer Out'],
  ['bet', 'Bet'],
  ['win', 'Win'],
  ['refund', 'Refund'],
];

// The admin sees every account's movements. A master or an agent has a wallet of its own (money it
// hands down comes out of it), so it sees its balance and can narrow the list to its own movements.
export default async function wallet(main, { query }) {
  const type = TYPES.some(([x]) => x === query.get('type')) ? query.get('type') : '';
  const own = session.get()?.user?.role !== 'admin';
  const mine = own && query.get('mine') === '1';
  const [rows, me] = await Promise.all([
    api.get(`/wallet/transactions?limit=500${type ? `&type=${type}` : ''}${mine ? `&user_id=${session.get().user.id}` : ''}`),
    own ? api.get('/auth/me') : null,
  ]);
  const go = (next) => {
    const params = new URLSearchParams(Object.entries({ type, mine: mine ? '1' : '', ...next }).filter(([, v]) => v));
    location.hash = `#/wallet${params.size ? `?${params}` : ''}`;
  };

  const filter = select('type', TYPES, type, { onchange: (e) => go({ type: e.target.value }) });
  const whose = own && select('mine', [['', t('All accounts')], ['1', `${me.username} (${t('me')})`]], mine ? '1' : '',
    { onchange: (e) => go({ mine: e.target.value }) });

  mount(main,
    pageHeader(t('Wallet'), own
      ? [t('My balance'), `: ${money(me.balance)} ${t('Ks')}`, me.unlimited ? ` · ∞ ${t('Unlimited wallet')}` : '']
      : t('Every balance change across all accounts (latest 500)')),
    h('div', { class: 'toolbar' }, whose, filter),
    walletTable(rows));
}

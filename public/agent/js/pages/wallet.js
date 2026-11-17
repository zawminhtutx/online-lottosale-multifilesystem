import { api, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { h, mount, pageHeader, select } from '/common/js/ui.js';
import { walletTable } from '/common/js/account-cards.js';

const TYPES = ['', 'transfer_in', 'transfer_out', 'bet', 'win', 'refund', 'deposit', 'withdraw'];

export default async function wallet(main, { query }) {
  const type = TYPES.includes(query.get('type')) ? query.get('type') : '';
  const userId = query.get('user') ?? '';
  const qs = new URLSearchParams({ limit: '500', ...(type && { type }), ...(userId && { user_id: userId }) });
  const [rows, users] = await Promise.all([api.get(`/wallet/transactions?${qs}`), api.get('/users?role=user')]);
  const me = session.get().user;

  const go = (next) => {
    const params = new URLSearchParams(Object.entries({ type, user: userId, ...next }).filter(([, v]) => v));
    location.hash = `#/wallet${params.size ? `?${params}` : ''}`;
  };

  mount(main,
    pageHeader(t('Wallet'), t('Money movements for you and your users (latest 500)')),
    h('div', { class: 'toolbar' },
      select('user', [['', t('All accounts')], [me.id, `${me.username} (${t('me')})`], ...users.map((u) => [u.id, u.username])], userId,
        { onchange: (e) => go({ user: e.target.value }) }),
      select('type', TYPES.map((x) => [x, x ? t(x) : t('All types')]), type, { onchange: (e) => go({ type: e.target.value }) })),
    walletTable(rows));
}

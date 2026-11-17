import { api, cached } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { badge, h, money, mount, pageHeader } from '/common/js/ui.js';
import { discountCard, passwordCard, profileCard, walletCard, walletHistoryCard } from '/common/js/account-cards.js';
import { isTermOpen, ticketTable } from '/common/js/term-reports.js';

export default async function userDetail(main, { params, rerender }) {
  const id = Number(params[0]);
  const [user, me, meta, transactions, tickets, openTerms] = await Promise.all([
    api.get(`/users/${id}`),
    api.get('/auth/me'),
    cached('/meta'),
    api.get(`/wallet/transactions?user_id=${id}&limit=50`),
    api.get(`/tickets?user_id=${id}&limit=20`),
    api.get('/terms?status=open'),
  ]);
  const openIds = new Set(openTerms.filter((x) => isTermOpen(x)).map((x) => x.id));

  mount(main,
    pageHeader(
      h('span', {}, user.username, ' ', badge(user.status)),
      [user.name, user.name_mm && ` · ${user.name_mm}`],
      h('a', { class: 'btn', href: '#/users' }, t('← Back'))),
    h('div', { class: 'grid grid-2' },
      profileCard(user, { canSetUnlimited: true, rerender }),
      h('div', { class: 'grid' },
        walletCard(user, {
          rerender,
          hint: me.unlimited
            ? t('You have an unlimited wallet: you can deposit even without balance ({amount} Ks now).', { amount: money(me.balance) })
            : t('Deposits come from your balance ({amount} Ks); withdrawals go back to it.', { amount: money(me.balance) }),
        }),
        passwordCard(user))),
    discountCard(user, meta.bet_types),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, t('Recent slips')), h('a', { href: `#/tickets?user=${user.id}` }, t('View all →'))),
      ticketTable(tickets, { betTypes: meta.bet_types, showTerm: true, canCancel: (x) => openIds.has(x.term_id), onChange: rerender })),
    walletHistoryCard(transactions));
}

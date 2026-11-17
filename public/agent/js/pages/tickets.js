import { api, cached } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { h, mount, pageHeader, select } from '/common/js/ui.js';
import { isTermOpen, ticketTable } from '/common/js/term-reports.js';

const STATUSES = ['', 'active', 'won', 'lost', 'cancelled'];

export default async function tickets(main, { query, rerender }) {
  const filters = { term_id: query.get('term') ?? '', user_id: query.get('user') ?? '', status: query.get('status') ?? '' };
  const qs = new URLSearchParams({ limit: '500' });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);

  const [rows, terms, users, meta] = await Promise.all([
    api.get(`/tickets?${qs}`),
    api.get('/terms'),
    api.get('/users?role=user'),
    cached('/meta'),
  ]);
  const openIds = new Set(terms.filter((x) => isTermOpen(x)).map((x) => x.id));

  const go = (key, value) => {
    const next = { term: filters.term_id, user: filters.user_id, status: filters.status, [key]: value };
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    location.hash = `#/tickets${params.size ? `?${params}` : ''}`;
  };

  mount(main,
    pageHeader(t('Slips'), t('Slips of your users (latest 500) · click a row for details')),
    h('div', { class: 'toolbar' },
      select('term', [['', t('All terms')], ...terms.map((x) => [x.id, x.description])], filters.term_id, { onchange: (e) => go('term', e.target.value) }),
      select('user', [['', t('All users')], ...users.map((u) => [u.id, u.username])], filters.user_id, { onchange: (e) => go('user', e.target.value) }),
      select('status', STATUSES.map((s) => [s, s ? t(s) : t('All statuses')]), filters.status, { onchange: (e) => go('status', e.target.value) })),
    ticketTable(rows, { betTypes: meta.bet_types, showTerm: true, canCancel: (x) => openIds.has(x.term_id), onChange: rerender }));
}

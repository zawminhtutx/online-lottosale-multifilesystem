// Live Ledger for an agent: every number of a term with the units the agent's own users have bet,
// coloured against the unit break and updated live. Own-tree sales are always visible.
import { api, cached } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { h, mount, pageHeader, select } from '/common/js/ui.js';
import { ledgerPanel } from '/common/js/ledger.js';
import { termBetTypes } from '/common/js/term-reports.js';

export default async function agentLedger(main, { query }) {
  // Terms still taking or holding bets (open / closed), newest first.
  const terms = (await api.get('/terms')).filter((x) => ['open', 'closed'].includes(x.status));
  if (!terms.length) {
    return mount(main, pageHeader(t('Live Ledger')), h('div', { class: 'card' }, h('p', { class: 'muted' }, t('No open terms'))));
  }
  const termId = terms.some((x) => String(x.id) === query.get('term')) ? Number(query.get('term')) : terms[0].id;
  const [term, meta] = await Promise.all([api.get(`/terms/${termId}`), cached('/meta')]);

  const header = pageHeader(t('Live Ledger'), t('Units your users have bet on each number'),
    select('term', terms.map((x) => [x.id, x.description]), termId, { onchange: (e) => (location.hash = `#/ledger?term=${e.target.value}`) }));
  mount(main, header, h('div', { class: 'loading' }, t('Loading…')));
  mount(main, header, await ledgerPanel({ term, betTypes: termBetTypes(meta.bet_types, term.game) }));
}

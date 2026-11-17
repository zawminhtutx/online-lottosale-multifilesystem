import { api, cached } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { badge, h, mount, pageHeader, select, tabs } from '/common/js/ui.js';
import { exposurePanel, summaryPanel, termBetTypes } from '/common/js/term-reports.js';

export default async function reports(main, { query }) {
  const terms = (await api.get('/terms')).filter((x) => x.status !== 'draft');
  const header = pageHeader(t('Reports'), t('Sales, payouts and exposure for your users'));
  if (!terms.length) return mount(main, header, h('p', { class: 'muted' }, t('No terms')));

  const termId = terms.some((x) => String(x.id) === query.get('term')) ? query.get('term') : String(terms[0].id);
  const tab = query.get('tab') === 'exposure' ? 'exposure' : 'summary';
  const [term, meta] = await Promise.all([api.get(`/terms/${termId}`), cached('/meta')]);

  const termSelect = select('term', terms.map((x) => [x.id, `${x.description} · ${t(x.status)}`]), termId, {
    onchange: (e) => (location.hash = `#/reports?term=${e.target.value}&tab=${tab}`),
  });

  mount(main,
    header,
    h('div', { class: 'toolbar' }, termSelect, badge(term.status)),
    tabs([['summary', t('Report')], ['exposure', t('Exposure')]], tab, (next) => (location.hash = `#/reports?term=${termId}&tab=${next}`)),
    tab === 'exposure' ? await exposurePanel({ term, betTypes: termBetTypes(meta.bet_types, term.game) }) : await summaryPanel({ term }));
}

// အဆတွဲ (Prize set assign) — admin-made prize sets, given only to users (bettors). A master /
// agent picks any of those sets for its own users; the admin can assign any user in the tree.
import { api, cached, invalidate, session } from '/common/js/api.js';
import { betTypeName, t } from '/common/js/i18n.js';
import { h, input, mount, pageHeader, select, table, toast } from '/common/js/ui.js';

export default async function prizeAssign(main, { query }) {
  invalidate('/prize-sets');
  const me = session.get().user;
  const [accounts, sets, meta] = await Promise.all([
    api.get('/users?role=user'),
    cached('/prize-sets'),
    cached('/meta'),
  ]);
  const betTypes = meta.bet_types;
  const people = accounts.filter((u) => u.id !== me.id);
  const setFilter = query.get('set') ?? '';

  const hasThreeD = betTypes.some((bt) => bt.code === '3D');
  const setLabel = (s) => `${s.name} (${[
    ...betTypes.map((bt) => `${betTypeName(bt)}×${s.rates.find((r) => r.bet_type_id === bt.id)?.multiplier ?? 0}`),
    ...(hasThreeD ? [`${t('Twod')}×${s.twod_multiplier ?? 0}`] : []),
  ].join(' ')})`;
  const setOptions = sets.map((s) => [s.id, setLabel(s)]);

  const counter = h('span', { class: 'badge badge-muted' });
  const box = h('div', {});
  const search = input('search', { type: 'search', placeholder: t('Search username, name, phone') });
  const setSelect = select('set', [['', t('All prize sets')], ...sets.map((s) => [s.id, s.name])], setFilter, {
    onchange: (e) => go({ set: e.target.value }),
  });

  function go(next) {
    const params = new URLSearchParams(Object.entries({ set: setFilter, ...next }).filter(([, v]) => v));
    location.hash = `#/prize-assign${params.size ? `?${params}` : ''}`;
  }

  async function assign(account, prizeSetId, control) {
    control.disabled = true;
    try {
      await api.patch(`/users/${account.id}`, { prize_set_id: Number(prizeSetId) });
      account.prize_set_id = Number(prizeSetId);
      invalidate('/prize-sets');
      toast(t('{name} — prize set updated', { name: account.username }));
    } catch (err) {
      control.value = String(account.prize_set_id);
      toast(err.message, 'bad');
    } finally {
      control.disabled = false;
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = people.filter((u) =>
      (setFilter === '' || String(u.prize_set_id) === setFilter)
      && (!q || [u.username, u.name, u.phone].some((v) => v && v.toLowerCase().includes(q))));
    counter.textContent = t('{n} accounts', { n: shown.length });
    mount(box, table(
      [
        { label: '', render: () => '🧑' },
        { label: t('Account'), render: (u) => [h('a', { href: `#/users/${u.id}` }, h('strong', {}, u.username)), ` — ${u.name}`] },
        me.role !== 'agent' && { label: t('Upline'), render: (u) => (u.parent_username && u.parent_id !== me.id ? u.parent_username : '—') },
        {
          label: t('Prize set'),
          render: (u) => {
            const options = setOptions.some(([id]) => id === u.prize_set_id) ? setOptions : [[u.prize_set_id, `#${u.prize_set_id}`], ...setOptions];
            const control = select(`ps-${u.id}`, options, u.prize_set_id, { 'aria-label': `${u.username} ${t('Prize set')}`, style: 'min-width:260px' });
            control.addEventListener('change', () => assign(u, control.value, control));
            return control;
          },
        },
      ].filter(Boolean),
      shown,
      { empty: q ? t('No matches') : t('No accounts yet') }));
  }
  search.addEventListener('input', render);

  mount(main,
    pageHeader(t('Prize set assign'),
      t('Choose the prize set (odds) each of your users gets. Changes save at once.'),
      me.role === 'admin' && h('a', { class: 'btn', href: '#/prizes' }, `🏅 ${t('Prize rates')}`)),
    h('div', { class: 'toolbar' }, search, setSelect, counter, h('span', { class: 'badge badge-accent' }, t('{n} prize sets', { n: sets.length }))),
    box);
  render();
}

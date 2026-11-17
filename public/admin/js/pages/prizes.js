// အလျှော် (Prize rates) — same layout as the POS app's PrizeTime page: one row per prize set with
// its payout multiplier per bet type, edited in place (💾), via ✏️, or created with ➕.
// Which account uses which set is on the "Prize set assign" page (prize-assign.js).
import { api, cached, invalidate } from '/common/js/api.js';
import { betTypeName, t } from '/common/js/i18n.js';
import { badge, busy, confirmDialog, field, h, input, mount, openModal, pageHeader, table, toast } from '/common/js/ui.js';

const multiplierOf = (set, betTypeId) => set.rates.find((r) => r.bet_type_id === betTypeId)?.multiplier ?? 0;

// Only the multipliers are edited here; each type keeps its discount override (-1 = user's own).
function ratesPayload(set, betTypes, values) {
  return betTypes.map((bt) => ({
    bet_type_id: bt.id,
    multiplier: Number(values[bt.id]) || 0,
    discount: set?.rates.find((r) => r.bet_type_id === bt.id)?.discount ?? -1,
  }));
}

export default async function prizes(main, { rerender }) {
  invalidate('/prize-sets');
  const [sets, meta] = await Promise.all([cached('/prize-sets'), cached('/meta')]);
  const betTypes = meta.bet_types;
  const reload = () => { invalidate('/prize-sets'); rerender(); };
  // New sets start from the Default set's odds.
  const template = sets.find((s) => s.id === 0) ?? sets[0];
  // Twod (တွဒ်) is a 3D-only payout, so its column shows only while 3D is offered.
  const hasThreeD = betTypes.some((bt) => bt.code === '3D');

  const numberCell = (value, label, onDirty) => {
    const el = h('input', { class: 'cell', type: 'number', min: 0, step: 1, value: String(value), 'aria-label': label });
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', onDirty);
    return el;
  };

  const rowActions = (set, inputs, twodInput, saveBtn) => {
    saveBtn.addEventListener('click', async () => {
      const values = Object.fromEntries(Object.entries(inputs).map(([id, el]) => [id, el.value]));
      await busy(saveBtn, async () => {
        await api.put(`/prize-sets/${set.id}/rates`, ratesPayload(set, betTypes, values));
        if (twodInput) await api.patch(`/prize-sets/${set.id}`, { twod_multiplier: Number(twodInput.value) || 0 });
      }).then(() => { toast(t('{name} saved', { name: set.name })); reload(); }, () => {});
    });
    const edit = h('button', { type: 'button', class: 'icon-btn', title: t('Edit'), onclick: () => editSet(set, betTypes, reload) }, '✏️');
    const del = h('button', {
      type: 'button',
      class: 'icon-btn',
      title: set.id === 0 ? t('The default prize set cannot be deleted') : t('Delete'),
      disabled: set.id === 0,
    }, '🗑️');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(t('Delete prize set "{name}"?', { name: set.name }), { confirmLabel: t('Delete') }))) return;
      await busy(del, () => api.del(`/prize-sets/${set.id}`)).then(() => { toast(t('Prize set deleted')); reload(); }, () => {});
    });
    return h('span', { class: 'row-actions' }, edit, saveBtn, del);
  };

  const rows = sets.map((set) => {
    const locked = set.can_manage === false;
    const saveBtn = h('button', { type: 'button', class: 'icon-btn', title: t('Save'), disabled: true }, '💾');
    const dirty = () => { saveBtn.disabled = false; };
    const inputs = Object.fromEntries(betTypes.map((bt) => [bt.id, numberCell(multiplierOf(set, bt.id), `${set.name} ${bt.code}`, dirty)]));
    const twodInput = hasThreeD ? numberCell(set.twod_multiplier ?? 0, `${set.name} Twod`, dirty) : null;
    if (locked) {
      Object.values(inputs).forEach((el) => { el.disabled = true; });
      if (twodInput) twodInput.disabled = true;
    }
    return { set, inputs, twodInput, actions: locked ? '' : rowActions(set, inputs, twodInput, saveBtn) };
  });

  const nameCell = ({ set }) => [h('strong', {}, set.name), set.id === 0 ? [' ', badge('Default')] : null];

  mount(main,
    pageHeader(t('Prize rates'), t('Payout multiplier per bet type. Assign a prize set to each user on the Prize set assign page.'),
      h('a', { class: 'btn', href: '#/prize-assign' }, `🔗 ${t('Prize set assign')}`),
      h('button', { class: 'btn btn-primary', onclick: () => editSet(null, betTypes, reload, template) }, `➕ ${t('New prize set')}`)),
    h('div', { class: 'toolbar' }, h('span', { class: 'badge badge-muted' }, t('{n} prize sets', { n: sets.length }))),
    table(
      [
        { label: '', render: () => '🏅' },
        { label: t('Name'), render: nameCell },
        ...betTypes.map((bt) => ({ label: `${betTypeName(bt)} ×`, align: 'right', render: ({ inputs }) => inputs[bt.id] })),
        hasThreeD && { label: `${t('3D Twod')} ×`, align: 'right', render: ({ twodInput }) => twodInput },
        { label: t('Accounts'), align: 'right', render: ({ set }) => h('a', { href: `#/prize-assign?set=${set.id}` }, String(set.user_count)) },
        { label: '', render: ({ actions }) => actions },
      ].filter(Boolean),
      rows,
      { empty: t('No prize sets yet') }));
}

// ✏️ Edit (set given) or ➕ New (set null; multipliers start from `template`).
function editSet(set, betTypes, reload, template) {
  const source = set ?? template;
  openModal({
    title: set ? `✏️ ${t('Edit prize set')}` : `➕ ${t('New prize set')}`,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-all' }, field(t('Name'), input('name', { required: true, value: set?.name ?? '', placeholder: t('e.g. VIP agents') }))),
      betTypes.map((bt) => field(`${betTypeName(bt)} ×`,
        input(`m${bt.id}`, { type: 'number', min: 0, step: 1, required: true, value: String(source ? multiplierOf(source, bt.id) : 0) }))),
      betTypes.some((bt) => bt.code === '3D') && field(`${t('3D Twod')} ×`,
        input('twod', { type: 'number', min: 0, step: 1, required: true, value: String(source?.twod_multiplier ?? 10) }),
        t('3D neighbours (+1/-1) and other orderings of the winning number pay this multiplier'))),
    submitLabel: `💾 ${t('Save')}`,
    onSubmit: async (v) => {
      const values = Object.fromEntries(betTypes.map((bt) => [bt.id, v[`m${bt.id}`]]));
      const name = v.name.trim();
      const twod = v.twod !== undefined ? { twod_multiplier: Number(v.twod) || 0 } : {};
      let target = set;
      if (!set) {
        target = await api.post('/prize-sets', { name, ...twod, ...(template && { copy_from: template.id }) });
        target.rates = template?.rates ?? [];
      } else {
        await api.patch(`/prize-sets/${set.id}`, { name, ...twod });
      }
      await api.put(`/prize-sets/${target.id}/rates`, ratesPayload(target, betTypes, values));
      toast(set ? t('{name} saved', { name }) : t('Prize set created'));
      reload();
    },
  });
}

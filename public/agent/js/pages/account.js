import { api } from '/common/js/api.js';
import { payAccountsCard } from '/common/js/account-cards.js';
import { t } from '/common/js/i18n.js';
import { busy, dateTime, field, formValues, h, input, money, mount, pageHeader, toast } from '/common/js/ui.js';

export default async function account(main, { rerender }) {
  const me = await api.get('/auth/me');

  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Change password'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Change password'))),
    h('div', { class: 'form-grid' },
      field(t('Current password'), input('current_password', { type: 'password', required: true, autocomplete: 'current-password' })),
      field(t('New password'), input('new_password', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
      field(t('Repeat new password'), input('repeat', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' }))),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const errorBox = form.querySelector('.form-error');
    if (v.new_password !== v.repeat) return void (errorBox.textContent = t('The new passwords do not match'));
    await busy(save, () => api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password }))
      .then(() => { form.reset(); errorBox.textContent = ''; toast(t('Password updated')); }, () => {});
  });

  const row = (label, value) => h('div', { class: 'slip-total' }, h('span', { class: 'muted' }, label), h('strong', {}, value));
  mount(main,
    pageHeader(t('My account'), me.username),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, t('Profile'))),
        row(t('Name'), [me.name, me.name_mm && ` · ${me.name_mm}`]),
        row(t('Phone'), me.phone ?? '—'),
        row(t('Balance'), [`${money(me.balance)} ${t('Ks')}`, me.unlimited ? ` · ∞ ${t('Unlimited wallet')}` : '']),
        row(t('Last login'), dateTime(me.last_login_at)),
        h('p', { class: 'hint' }, t('Ask your admin to change your name, phone or prize rates.'))),
      form),
    payAccountsCard(me, { rerender }));
}

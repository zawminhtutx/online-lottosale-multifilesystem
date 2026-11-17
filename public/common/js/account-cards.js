// Account management cards shared by the admin and agent "account detail" pages.
import { api } from './api.js';
import { betTypeName, t } from './i18n.js';
import { badge, balanceCell, busy, checkbox, dateTime, field, formValues, h, input, money, select, table, toast } from './ui.js';

// prizeSets: pass the list to allow changing the prize set (admin only); omit to hide it.
// canSetUnlimited: show the unlimited-wallet switch (admin only).
export function profileCard(user, { prizeSets, canSetUnlimited = false, isSelf = false, rerender }) {
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Save changes'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Profile'))),
    h('div', { class: 'form-grid' },
      field(t('Name'), input('name', { value: user.name, required: true })),
      user.role === 'master' && field(t('Master name'), input('master_name', { value: user.master_name ?? '' })),
      field(t('Myanmar name'), input('name_mm', { value: user.name_mm ?? '' })),
      user.role !== 'admin' && field(t('Email'), input('email', { type: 'email', value: user.email ?? '' })),
      field(t('Phone'), input('phone', { value: user.phone ?? '' })),
      field(t('Phone 2'), input('phone2', { value: user.phone2 ?? '' })),
      field(t('Status'), select('status', [['active', t('Active')], ['suspended', t('Suspended')], ['closed', t('Closed')]], user.status, { disabled: isSelf })),
      prizeSets && field(t('Prize set'), select('prize_set_id', prizeSets.map((s) => [s.id, s.name]), user.prize_set_id, { disabled: isSelf })),
      h('div', { class: 'span-all' }, field(t('Address'), input('address', { value: user.address ?? '' }))),
      user.role === 'master' && h('div', { class: 'span-all' },
        user.logo ? h('img', { src: user.logo, alt: '', style: 'max-height:64px;margin-bottom:8px' }) : null,
        field(t('Logo'), input('logo', { type: 'file', accept: 'image/*' }))),
      canSetUnlimited && h('div', { class: 'span-all' }, unlimitedCheckbox(user.role, user.unlimited))),
    h('p', { class: 'muted' }, t('Created {created} · Last login {login}', { created: dateTime(user.created_at), login: dateTime(user.last_login_at) })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const payload = { name: v.name.trim() };
    for (const key of ['name_mm', 'phone', 'phone2', 'address']) payload[key] = v[key].trim() || null;
    if (user.role === 'master') payload.master_name = v.master_name.trim() || null;
    if (user.role !== 'admin') payload.email = v.email.trim() || null;
    if (user.role === 'master') {
        const file = form.querySelector('input[name="logo"]')?.files?.[0];
      if (file) {
        if (file.size > 350000) throw new Error('Logo must be under 350 KB');
        payload.logo = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the logo'));
          reader.readAsDataURL(file);
        });
      }
    }
    if (!isSelf) payload.status = v.status;
    if (!isSelf && prizeSets) payload.prize_set_id = Number(v.prize_set_id);
    if (canSetUnlimited) payload.unlimited = v.unlimited === 'on';
    await busy(save, () => api.patch(`/users/${user.id}`, payload)).then(() => { toast(t('Profile saved')); rerender(); }, () => {});
  });
  return form;
}

// KPay / WavePay accounts of an admin, master or agent: the accounts under it see these on their
// ငွေဖြည့် screen.
export function payAccountsCard(user, { rerender }) {
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Save'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', {}, t('KPay / WavePay')),
        h('p', { class: 'muted', style: 'margin:4px 0 0' }, t('Users send money to these numbers. They are shown on the deposit screen of the app.')))),
    h('div', { class: 'form-grid' },
      field(t('KPay number'), input('kpay_no', { value: user.kpay_no ?? '', inputmode: 'tel', placeholder: '09…' })),
      field(t('KPay account name'), input('kpay_name', { value: user.kpay_name ?? '' })),
      field(t('WavePay number'), input('wave_no', { value: user.wave_no ?? '', inputmode: 'tel', placeholder: '09…' })),
      field(t('WavePay account name'), input('wave_name', { value: user.wave_name ?? '' }))),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const payload = Object.fromEntries(['kpay_no', 'kpay_name', 'wave_no', 'wave_name'].map((k) => [k, v[k].trim() || null]));
    await busy(save, () => api.patch(`/users/${user.id}`, payload)).then(() => { toast(t('Payment numbers saved')); rerender(); }, () => {});
  });
  return form;
}

export function unlimitedCheckbox(role, checked) {
  return checkbox('unlimited', t('Unlimited wallet'), checked,
    role === 'agent' || role === 'master'
      ? t('Can give money to their users without having balance. Their balance goes negative (amount owed).')
      : t('Can bet without balance. The balance goes negative (amount owed).'));
}

// hint: optional line under the balance (e.g. the agent's own balance).
// canMove: show the ငွေသွင်း / ငွေထုတ် form. The admin's own cash only moves in and out of a master
// (the server refuses the rest), so the admin sees the figures but no form on an agent or a user.
export function walletCard(user, { isSelf = false, rerender, hint, canMove = true, noMoveNote }) {
  const amount = input('amount', { type: 'number', min: 1, step: 1, placeholder: t('Amount (Ks)'), required: true });
  const note = input('note', { placeholder: t('Note (optional)') });
  const deposit = h('button', { type: 'button', class: 'btn btn-good' }, t('Deposit'));
  const withdraw = h('button', { type: 'button', class: 'btn' }, t('Withdraw'));

  const act = (kind, button) => async () => {
    const value = Number(amount.value);
    if (!Number.isInteger(value) || value <= 0) return toast(t('Enter a whole amount above 0'), 'bad');
    await busy(button, () =>
      api.post(`/wallet/${kind}`, { user_id: user.id, amount: value, ...(note.value.trim() && { note: note.value.trim() }) })
    ).then(() => {
      toast(t(kind === 'deposit' ? 'Deposited {amount} Ks' : 'Withdrew {amount} Ks', { amount: money(value) }));
      rerender();
    }, () => {});
  };
  deposit.addEventListener('click', act('deposit', deposit));
  withdraw.addEventListener('click', act('withdraw', withdraw));

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Wallet'))),
    h('div', { class: 'big-balance' }, balanceCell(user), h('span', { class: 'muted', style: 'font-size:14px;font-weight:500' }, ` ${t('Ks')}`)),
    user.unlimited ? h('p', { class: 'hint', style: 'margin:4px 0 0' }, t('Unlimited wallet: may go below zero. A negative balance is the amount owed.')) : null,
    hint && h('p', { class: 'hint', style: 'margin:4px 0 0' }, hint),
    isSelf
      ? h('p', { class: 'muted' }, t('You cannot move money into your own account.'))
      : !canMove
        ? h('p', { class: 'muted' }, noMoveNote ?? '')
        : [
            h('div', { class: 'form-grid', style: 'margin-top:14px' }, amount, note),
            h('p', { class: 'form-error', role: 'alert' }),
            h('div', { class: 'form-actions' }, withdraw, deposit),
          ]);
}

export function passwordCard(user) {
  const save = h('button', { type: 'submit', class: 'btn' }, t('Reset password'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Reset password'))),
    field(t('New password'), input('password', { type: 'password', minlength: 6, required: true, autocomplete: 'new-password' })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(save, () => api.patch(`/users/${user.id}`, { password: formValues(form).password }))
      .then(() => { form.reset(); toast(t('Password updated')); }, () => {});
  });
  return form;
}

// The signed-in account's own password: needs the current one.
export function changePasswordCard() {
  const save = h('button', { type: 'submit', class: 'btn' }, t('Change password'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Change password'))),
    field(t('Current password'), input('current_password', { type: 'password', required: true, autocomplete: 'current-password' })),
    field(t('New password'), input('new_password', { type: 'password', minlength: 6, required: true, autocomplete: 'new-password' })),
    field(t('Confirm new password'), input('confirm', { type: 'password', minlength: 6, required: true, autocomplete: 'new-password' })),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (v.new_password !== v.confirm) {
      form.querySelector('.form-error').textContent = t('The new passwords do not match');
      return;
    }
    await busy(save, () => api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password }))
      .then(() => { form.reset(); toast(t('Password updated')); }, () => {});
  });
  return form;
}

// DISCOUNTS: commission % per bet type, taken off the ticket price.
export function discountCard(user, betTypes) {
  const current = new Map(user.discounts.map((d) => [d.bet_type_id, d]));
  const cell = (bt, key) =>
    h('input', { class: 'cell', type: 'number', min: 0, max: 100, step: 0.01, name: `${key}:${bt.id}`, value: String(current.get(bt.id)?.[key] ?? 0) });

  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Save discounts'));
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, t('Discounts (%)')), h('p', { class: 'muted', style: 'margin:4px 0 0' }, t('Discount 1 is applied to tickets when the prize set says "use customer discount".')))),
    table(
      [
        { label: t('Bet type'), render: (bt) => betTypeName(bt) },
        { label: t('Discount'), align: 'right', render: (bt) => cell(bt, 'discount') },
        { label: t('Discount 2'), align: 'right', render: (bt) => cell(bt, 'discount2') },
        { label: t('Discount 3'), align: 'right', render: (bt) => cell(bt, 'discount3') },
      ],
      betTypes),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const rows = betTypes
      .map((bt) => ({
        bet_type_id: bt.id,
        discount: Number(v[`discount:${bt.id}`] || 0),
        discount2: Number(v[`discount2:${bt.id}`] || 0),
        discount3: Number(v[`discount3:${bt.id}`] || 0),
      }))
      .filter((r) => r.discount || r.discount2 || r.discount3);
    await busy(save, () => api.put(`/users/${user.id}/discounts`, rows)).then(() => toast(t('Discounts saved')), () => {});
  });
  return form;
}

export function walletHistoryCard(transactions) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, t('Wallet history')), h('span', { class: 'muted' }, t('Last 50'))),
    walletTable(transactions, { showAccount: false }));
}

export function walletTable(rows, { showAccount = true } = {}) {
  return table(
    [
      { label: t('Time'), render: (x) => dateTime(x.created_at) },
      showAccount && { label: t('Account'), render: (x) => h('a', { href: `#/users/${x.user_id}` }, x.username) },
      { label: t('Type'), render: (x) => badge(x.type) },
      { label: t('Amount'), align: 'right', render: (x) => h('span', { class: x.amount < 0 ? 'amount-neg' : 'amount-pos' }, (x.amount > 0 ? '+' : '') + money(x.amount)) },
      { label: t('Balance after'), align: 'right', render: (x) => money(x.balance_after) },
      { label: t('Note'), render: (x) => x.note ?? '—' },
    ].filter(Boolean),
    rows,
    { empty: t('No transactions yet') });
}


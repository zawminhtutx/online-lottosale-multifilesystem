import { api } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { badge, balanceCell, dateTime, field, h, input, mount, openModal, pageHeader, table, toast } from '/common/js/ui.js';
import { unlimitedCheckbox } from '/common/js/account-cards.js';

export default async function users(main, { query }) {
  const search = query.get('search') ?? '';
  const rows = await api.get(`/users?role=user${search ? `&search=${encodeURIComponent(search)}` : ''}`);

  const searchBox = input('search', { type: 'search', placeholder: t('Search username, name, phone'), value: search });
  searchBox.addEventListener('change', () => {
    const value = searchBox.value.trim();
    location.hash = value ? `#/users?search=${encodeURIComponent(value)}` : '#/users';
  });

  mount(main,
    pageHeader(t('My users'), t('Betting accounts under you'),
      h('button', { class: 'btn btn-primary', onclick: createUser }, t('+ New user'))),
    h('div', { class: 'toolbar' }, searchBox),
    table(
      [
        { label: t('Username'), render: (u) => h('a', { href: `#/users/${u.id}` }, u.username) },
        { label: t('Name'), render: (u) => [u.name, u.name_mm && h('div', { class: 'muted' }, u.name_mm)] },
        { label: t('Phone'), render: (u) => u.phone ?? '—' },
        { label: t('Balance'), align: 'right', render: (u) => balanceCell(u) },
        { label: t('Status'), render: (u) => badge(u.status) },
        { label: t('Last login'), render: (u) => dateTime(u.last_login_at) },
      ],
      rows,
      { empty: search ? t('No matches') : t('No users yet'), onRowClick: (u) => (location.hash = `#/users/${u.id}`) }));
}

// New user form (also opened from the dashboard). Creating one opens its page.
export function createUser() {
  openModal({
    title: t('New user'),
    body: h('div', { class: 'form-grid' },
      field(t('Username'), input('username', { required: true, minlength: 3, pattern: '[A-Za-z0-9_.]+', autocomplete: 'off' }), t('Letters, numbers, _ and .')),
      field(t('Password'), input('password', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
      field(t('Name'), input('name', { required: true })),
      field(t('Myanmar name'), input('name_mm')),
      field(t('Phone'), input('phone')),
      field(t('Phone 2'), input('phone2')),
      h('div', { class: 'span-all' }, field(t('Address'), input('address'))),
      h('div', { class: 'span-all' }, unlimitedCheckbox('user', false))),
    submitLabel: t('Create'),
    onSubmit: async (v) => {
      const payload = { username: v.username.trim(), password: v.password, role: 'user', name: v.name.trim(), unlimited: v.unlimited === 'on' };
      for (const key of ['name_mm', 'phone', 'phone2', 'address']) if (v[key]?.trim()) payload[key] = v[key].trim();
      const created = await api.post('/users', payload);
      toast(t('{name} created', { name: created.username }));
      location.hash = `#/users/${created.id}`;
    },
  });
}

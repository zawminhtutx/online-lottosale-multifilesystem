// App shell shared by the admin and agent dashboards: login, sidebar, hash router.
import { api, session } from './api.js';
import { t } from './i18n.js';
import { busy, field, formValues, h, input, mount } from './ui.js';

// role: the account role this dashboard is for, or a list of them (the admin dashboard also
// serves masters). title: a string, or title(user) for a per-role name once signed in.
// routes: [[RegExp, page(main, ctx)]]
// nav: [{ href, icon, label, active(path, query), visible?(user) }]
export function startApp({ role, title, routes, nav }) {
  const app = document.getElementById('app');
  const roles = [role].flat();
  let verified = false;

  const titleFor = (user) => (typeof title === 'function' ? title(user) : title);
  const brand = (user) => h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '2D'), t(titleFor(user)));

  function parseHash() {
    const [path, qs] = (location.hash.slice(1) || '/').split('?');
    return { path: path || '/', query: new URLSearchParams(qs) };
  }

  function logout() {
    session.clear();
    verified = false;
    location.hash = '#/login';
  }

  function layout(path, query, user) {
    // One dashboard serves more than one role (admin + master), so the accent colour says which
    // account is signed in — like the app's per-role background (see online-admin-mobile).
    for (const role of ['master', 'agent']) document.body.classList.toggle(`app-${role}`, user.role === role);
    const main = h('main', { class: 'main' });
    mount(app,
      h('div', { class: 'shell' },
        h('aside', { class: 'sidebar' },
          brand(user),
          h('nav', { class: 'nav' },
            nav.filter((item) => !item.visible || item.visible(user)).map((item) =>
              h('a', { href: item.href, class: item.active(path, query) ? 'active' : null },
                h('span', { class: 'nav-icon' }, item.icon), t(item.label)))),
          h('div', { class: 'sidebar-foot' },
            h('div', { class: 'who muted' }, t('Signed in as {name}', { name: user.username })),
            h('button', { class: 'btn btn-sm', onclick: logout }, t('Sign out')))),
        main));
    return main;
  }

  function loginPage() {
    const button = h('button', { type: 'submit', class: 'btn btn-primary' }, t('Sign in'));
    const form = h('form', {},
      field(t('Username'), input('username', { autocomplete: 'username', required: true })),
      field(t('Password'), input('password', { type: 'password', autocomplete: 'current-password', required: true })),
      h('p', { class: 'form-error', role: 'alert' }),
      button);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await busy(button, async () => {
        const { token, user } = await api.post('/auth/login', formValues(form));
        if (!roles.includes(user.role)) throw new Error(t(`This dashboard is for ${roles[0]} accounts only`));
        session.set({ token, user });
        verified = true;
        location.hash = '#/dashboard';
      }).catch(() => {});
    });

    mount(app,
      h('div', { class: 'login-wrap' },
        h('div', { class: 'card login-card' },
          h('div', { class: 'login-top' }, brand()),
          form)));
    form.querySelector('input').focus();
  }

  async function render() {
    const { path, query } = parseHash();
    const current = session.get();
    document.title = t(titleFor(current?.user));

    if (path === '/login' || !current?.token) {
      if (path !== '/login') return void (location.hash = '#/login');
      return loginPage();
    }

    // Re-check the token once per page load (account may be suspended or the role wrong).
    if (!verified) {
      try {
        const me = await api.get('/auth/me');
        if (!roles.includes(me.role)) throw new Error('wrong role');
        session.set({ ...current, user: me });
        verified = true;
      } catch {
        return logout();
      }
    }

    const main = layout(path, query, session.get().user);
    const route = routes.find(([re]) => re.test(path));
    if (!route) return mount(main, h('div', { class: 'error-page' }, t('Page not found')));

    mount(main, h('div', { class: 'loading' }, t('Loading…')));
    try {
      await route[1](main, { params: path.match(route[0]).slice(1), query, rerender: render });
    } catch (err) {
      console.error(err);
      mount(main, h('div', { class: 'error-page' }, err.message));
    }
  }

  window.addEventListener('hashchange', render);
  render();
}

import { session } from '/common/js/api.js';
import { startApp } from '/common/js/shell.js';
import dashboard from './pages/dashboard.js';
import users from './pages/users.js';
import userDetail from './pages/user-detail.js';
import terms from './pages/terms.js';
import termDetail from './pages/term-detail.js';
import prizes from './pages/prizes.js';
import prizeAssign from '/common/js/pages/prize-assign.js';
import walletRequests from '/common/js/pages/wallet-requests.js';
import slipCancelRequests from './pages/slip-cancel-requests.js';
import wallet from './pages/wallet.js';
import walletTransfer from '/common/js/pages/wallet-transfer.js';
import commissions from '/common/js/pages/commissions.js';
import sale from './pages/sale.js';
import masterSettings from './pages/master-settings.js';

// The admin only opens master accounts. A master runs its own book and its own tree: files, terms,
// sale, prize rates, agents, users, commissions, wallets and slip-delete requests. An agent runs
// its own users. The sidebar accent follows the role (see shell.js).
const roleOf = (user) => user?.role;
const isAdmin = (user) => roleOf(user) === 'admin';
const isMaster = (user) => roleOf(user) === 'master';
const notAdmin = (user) => !isAdmin(user);
// Pages for one group of roles only; anyone else is sent back to the dashboard.
const onlyFor = (allowed, page) => (main, ctx) =>
  (allowed.includes(roleOf(session.get()?.user)) ? page(main, ctx) : void (location.hash = '#/dashboard'));
const bookOnly = (page) => onlyFor(['master'], page);
const staffOnly = (page) => onlyFor(['master', 'agent'], page);
const adminNav = isAdmin;
const masterNav = isMaster;

const usersTab = (role) => (path, query) => path === '/users' && (query.get('role') ?? 'agent') === role;

startApp({
  role: ['admin', 'master', 'agent'],
  title: (user) => ({ master: 'Lotto Master', agent: 'Lotto Agent' }[roleOf(user)] ?? 'Lotto Admin'),
  routes: [
    [/^\/(dashboard)?$/, dashboard],
    [/^\/users$/, users],
    [/^\/users\/(\d+)$/, userDetail],
    [/^\/profile$/, userDetail],
    [/^\/sale(?:\/(\d+))?$/, staffOnly(sale)],
    [/^\/terms$/, staffOnly(terms)],
    [/^\/terms\/(\d+)$/, staffOnly(termDetail)],
    [/^\/prizes$/, bookOnly(prizes)],
    [/^\/prize-assign$/, staffOnly(prizeAssign)],
    [/^\/commissions$/, staffOnly(commissions)],
    [/^\/wallet$/, staffOnly(wallet)],
    [/^\/wallet-transfer$/, staffOnly(walletTransfer)],
    [/^\/wallet-requests$/, staffOnly(walletRequests)],
    [/^\/slip-cancel-requests$/, staffOnly(slipCancelRequests)],
    [/^\/settings$/, bookOnly(masterSettings)],
  ],
  nav: [
    { href: '#/dashboard', icon: '◧', label: 'Dashboard', active: (p) => /^\/(dashboard)?$/.test(p) },
    { href: '#/users?role=master', icon: '◆', label: 'Masters', active: usersTab('master'), visible: adminNav },
    { href: '#/users?role=agent', icon: '◎', label: 'Agents', active: usersTab('agent'), visible: masterNav },
    { href: '#/users?role=user', icon: '◉', label: 'Users', active: usersTab('user'), visible: notAdmin },
    { href: '#/sale', icon: '✎', label: 'Sale', active: (p) => p.startsWith('/sale'), visible: notAdmin },
    { href: '#/terms', icon: '▦', label: 'Terms', active: (p) => p.startsWith('/terms'), visible: notAdmin },
    { href: '#/prizes', icon: '🏅', label: 'Prize rates', active: (p) => p === '/prizes', visible: masterNav },
    { href: '#/prize-assign', icon: '🔗', label: 'Prize set assign', active: (p) => p === '/prize-assign', visible: notAdmin },
    { href: '#/commissions', icon: '%', label: 'Commission', active: (p) => p === '/commissions', visible: notAdmin },
    { href: '#/wallet', icon: '⇄', label: 'Wallet', active: (p) => p === '/wallet', visible: notAdmin },
    { href: '#/wallet-transfer', icon: '⇆', label: 'ငွေ Transfer', active: (p) => p === '/wallet-transfer', visible: notAdmin },
    { href: '#/wallet-requests', icon: '⇅', label: 'Wallet requests', active: (p) => p === '/wallet-requests', visible: notAdmin },
    { href: '#/slip-cancel-requests', icon: '🗑', label: 'Slip delete requests', active: (p) => p === '/slip-cancel-requests', visible: notAdmin },
    { href: '#/settings', icon: '⚙', label: 'Settings', active: (p) => p === '/settings', visible: masterNav },
    { href: '#/profile', icon: '👤', label: 'Profile', active: (p) => p === '/profile' },
  ],
});

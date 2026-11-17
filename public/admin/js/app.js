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

// Masters and agents sign in here too and run their own tree (its accounts, money and slips): a
// master its agents and their users, an agent its own users. What belongs to the admin alone —
// admin and master accounts, prize-rate tables, creating and editing အပါတ်စဥ် and their break,
  // ငွေ Transfer — is hidden from them (and refused by the server anyway). An agent decides
  // slip delete requests for its own users. The sidebar accent follows the role (see shell.js).
const roleOf = (user) => user?.role;
const isAdmin = (user) => roleOf(user) === 'admin';
const isBook = (user) => roleOf(user) === 'admin' || roleOf(user) === 'master';
const isAgent = (user) => roleOf(user) === 'agent';
// Pages for one group of roles only; anyone else is sent back to the dashboard.
const onlyFor = (allowed, page) => (main, ctx) =>
  (allowed.includes(roleOf(session.get()?.user)) ? page(main, ctx) : void (location.hash = '#/dashboard'));
const bookOnly = (page) => onlyFor(['admin', 'master'], page);
const adminNav = isAdmin;
const bookNav = isBook;
const notAgentNav = (user) => !isAgent(user);

const usersTab = (role) => (path, query) => path === '/users' && (query.get('role') ?? 'agent') === role;

startApp({
  role: ['admin', 'master', 'agent'],
  title: (user) => ({ master: 'Lotto Master', agent: 'Lotto Agent' }[roleOf(user)] ?? 'Lotto Admin'),
  routes: [
    [/^\/(dashboard)?$/, dashboard],
    [/^\/users$/, users],
    [/^\/users\/(\d+)$/, userDetail],
    [/^\/profile$/, userDetail],
    [/^\/sale(?:\/(\d+))?$/, sale],
    [/^\/terms$/, terms],
    [/^\/terms\/(\d+)$/, termDetail],
    [/^\/prizes$/, bookOnly(prizes)],
    [/^\/prize-assign$/, prizeAssign],
    [/^\/commissions$/, commissions],
    [/^\/wallet$/, wallet],
    [/^\/wallet-transfer$/, walletTransfer],
    [/^\/wallet-requests$/, walletRequests],
    [/^\/slip-cancel-requests$/, slipCancelRequests],
  ],
  nav: [
    { href: '#/dashboard', icon: '◧', label: 'Dashboard', active: (p) => /^\/(dashboard)?$/.test(p) },
    { href: '#/users?role=master', icon: '◆', label: 'Masters', active: usersTab('master'), visible: adminNav },
    { href: '#/users?role=agent', icon: '◎', label: 'Agents', active: usersTab('agent'), visible: notAgentNav },
    { href: '#/users?role=user', icon: '◉', label: 'Users', active: usersTab('user') },
    { href: '#/users?role=admin', icon: '★', label: 'Admins', active: usersTab('admin'), visible: adminNav },
    { href: '#/sale', icon: '✎', label: 'Sale', active: (p) => p.startsWith('/sale') },
    { href: '#/terms', icon: '▦', label: 'Terms', active: (p) => p.startsWith('/terms') },
    { href: '#/prizes', icon: '🏅', label: 'Prize rates', active: (p) => p === '/prizes', visible: bookNav },
    { href: '#/prize-assign', icon: '🔗', label: 'Prize set assign', active: (p) => p === '/prize-assign' },
    { href: '#/commissions', icon: '%', label: 'Commission', active: (p) => p === '/commissions' },
    { href: '#/wallet', icon: '⇄', label: 'Wallet', active: (p) => p === '/wallet' },
    { href: '#/wallet-transfer', icon: '⇆', label: 'ငွေ Transfer', active: (p) => p === '/wallet-transfer' },
    { href: '#/wallet-requests', icon: '⇅', label: 'Wallet requests', active: (p) => p === '/wallet-requests' },
    { href: '#/slip-cancel-requests', icon: '🗑', label: 'Slip delete requests', active: (p) => p === '/slip-cancel-requests' },
    { href: '#/profile', icon: '⚙', label: 'Profile', active: (p) => p === '/profile' },
  ],
});

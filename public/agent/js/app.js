import { startApp } from '/common/js/shell.js';
import dashboard from './pages/dashboard.js';
import users from './pages/users.js';
import userDetail from './pages/user-detail.js';
import tickets from './pages/tickets.js';
import reports from './pages/reports.js';
import wallet from './pages/wallet.js';
import account from './pages/account.js';
import agentLedger from './pages/ledger.js';
import prizeAssign from '/common/js/pages/prize-assign.js';
import walletRequests from '/common/js/pages/wallet-requests.js';
import walletTransfer from '/common/js/pages/wallet-transfer.js';
import commissions from '/common/js/pages/commissions.js';

startApp({
  role: 'agent',
  title: 'Lotto Agent',
  routes: [
    [/^\/(dashboard)?$/, dashboard],
    [/^\/users$/, users],
    [/^\/users\/(\d+)$/, userDetail],
    [/^\/tickets$/, tickets],
    [/^\/reports$/, reports],
    [/^\/wallet$/, wallet],
    [/^\/wallet-requests$/, walletRequests],
    [/^\/wallet-transfer$/, walletTransfer],
    [/^\/prize-assign$/, prizeAssign],
    [/^\/commissions$/, commissions],
    [/^\/account$/, account],
    [/^\/ledger$/, agentLedger],
  ],
  nav: [
    { href: '#/dashboard', icon: '◧', label: 'Dashboard', active: (p) => /^\/(dashboard)?$/.test(p) },
    { href: '#/users', icon: '◉', label: 'My users', active: (p) => p.startsWith('/users') },
    { href: '#/tickets', icon: '▤', label: 'Slips', active: (p) => p === '/tickets' },
    { href: '#/ledger', icon: '▦', label: 'Live Ledger', active: (p) => p === '/ledger' },
    { href: '#/reports', icon: '▦', label: 'Reports', active: (p) => p === '/reports' },
    { href: '#/wallet', icon: '⇄', label: 'Wallet', active: (p) => p === '/wallet' },
    { href: '#/wallet-requests', icon: '⇅', label: 'Wallet requests', active: (p) => p === '/wallet-requests' },
    { href: '#/wallet-transfer', icon: '⇆', label: 'ငွေ Transfer', active: (p) => p === '/wallet-transfer' },
    { href: '#/commissions', icon: '%', label: 'Commission', active: (p) => p === '/commissions' },
    { href: '#/prize-assign', icon: '🔗', label: 'Prize set assign', active: (p) => p === '/prize-assign' },
    { href: '#/account', icon: '⚙', label: 'My account', active: (p) => p === '/account' },
  ],
});

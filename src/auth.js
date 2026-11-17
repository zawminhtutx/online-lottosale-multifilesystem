import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db, one } from './db.js';
import { HttpError, forbidden, notFound } from './errors.js';

// Own profile, GET /users/:id, and login: phone/address for the account, KPay/Wave only for
// upline pay-in numbers. Never includes password_hash.
export const PUBLIC_USER_COLUMNS =
  'id, username, role, parent_id, name, name_mm, phone, phone2, address, email, master_name, logo, ledger_mail, prize_set_id, balance, unlimited, ledger_access, sale_over, hot_edit, kpay_no, kpay_name, wave_no, wave_name, status, last_login_at, created_at';

// Directory (GET /users): enough to search and work accounts. Address and payment numbers stay
// on the detail page so a list cannot dump every customer's private contact / pay accounts.
export const USER_LIST_COLUMNS =
  'id, username, role, parent_id, name, name_mm, phone, email, master_name, logo, ledger_mail, prize_set_id, balance, unlimited, ledger_access, sale_over, hot_edit, status, last_login_at, created_at';

// Account levels, highest first: admin is the superadmin (one per system, no parent), then master,
// agent and user. users.parent_id chains them, so each account has exactly one upline and its own
// downline underneath — a master's agents and their users, an agent's users.
export const ROLES = ['admin', 'master', 'agent', 'user'];
const LEVEL = { admin: 3, master: 2, agent: 1, user: 0 };

export const levelOf = (role) => LEVEL[role] ?? -1;
// True when `role` sits strictly above `other` in the chain (master is above agent, not above master).
export const isAbove = (role, other) => levelOf(role) > levelOf(other);

// The roles that run a back office of their own: accounts, money and slips for their downline.
// (The admin does it for everyone, a master for its agents and users, an agent for its users.)
export const UPLINE_ROLES = ['admin', 'master', 'agent'];

export function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
}

// Loads the user on every request so suspensions and role changes apply immediately.
export async function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Missing token'));

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }

  const user = await one(db, `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [Number(payload.sub)]);
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Account is not active'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

// Every account above `userId` in the parent chain, so an upline is recognised however deep it
// sits (a master reaching a user under one of its agents). ? = the account to walk up from.
const UPLINE_OF = `WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM users WHERE id = ?
      UNION ALL
      SELECT u.id, u.parent_id FROM users u JOIN chain c ON u.id = c.parent_id
    )
    SELECT id FROM chain`;

// Every account below `actorId` in the parent chain, at any depth. ? = the account to walk down from.
const DOWNLINE_OF = `WITH RECURSIVE sub(id) AS (
      SELECT id FROM users WHERE parent_id = ?
      UNION ALL
      SELECT u.id FROM users u JOIN sub s ON u.parent_id = s.id
    )
    SELECT id FROM sub`;

// admin: everyone; master / agent: themselves and their whole downline; user: themselves only.
// `target` only needs an `id` — the chain is read from the database, so a stale parent_id snapshot
// (e.g. tickets.agent_id) cannot widen or narrow access.
export async function canAccess(client, actor, target) {
  if (actor.role === 'admin' || actor.id === target.id) return true;
  if (actor.role === 'user') return false;
  return Boolean(await one(client, `${UPLINE_OF} WHERE id = ? LIMIT 1`, [target.id, actor.id]));
}

export async function loadAccessibleUser(client, actor, userId) {
  const target = await one(client, `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [userId]);
  if (!target || !(await canAccess(client, actor, target))) throw notFound('User not found');
  return target;
}

// Like loadAccessibleUser, but the target must sit strictly below the actor — used where acting on
// yourself makes no sense (handing money over, setting someone's commission).
export async function loadDownlineUser(client, actor, userId) {
  const target = await loadAccessibleUser(client, actor, userId);
  if (target.id === actor.id) throw forbidden('That account is your own');
  return target;
}

// SQL fragment restricting a user-id column to what the actor may see: an admin everything, a
// master or agent themselves plus their whole downline, a user only themselves.
export function userScope(actor, column) {
  if (actor.role === 'admin') return { sql: '1 = 1', args: [] };
  if (actor.role === 'user') return { sql: `${column} = ?`, args: [actor.id] };
  return { sql: `(${column} = ? OR ${column} IN (${DOWNLINE_OF}))`, args: [actor.id, actor.id] };
}

// Only the admin sees every account. A master's cross-tree read permission is limited to the Live Ledger.
export const seesAll = (actor) => actor.role === 'admin';

export const readScope = (actor, column) => (seesAll(actor) ? { sql: '1 = 1', args: [] } : userScope(actor, column));

// Live Ledger: admin always sees every account. A master / agent always sees its own downline
// (so they can work their bettors). Only a master with ledger_access also sees other masters' trees.
export function liveLedgerScope(actor, column) {
  if (actor.role === 'admin' || (actor.role === 'master' && Number(actor.ledger_access) === 1)) {
    return { sql: '1 = 1', args: [] };
  }
  if (['master', 'agent'].includes(actor.role)) return userScope(actor, column);
  throw forbidden('Live Ledger access is not enabled');
}

export async function canView(client, actor, target) {
  return seesAll(actor) || canAccess(client, actor, target);
}

export async function loadViewableUser(client, actor, userId) {
  const target = await one(client, `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [userId]);
  if (!target || !(await canView(client, actor, target))) throw notFound('User not found');
  return target;
}

// Deposit / withdraw requests (ငွေဖြည့် / ငွေထုတ် / ငွေလက်ခံ). They run up one hop: a user asks its
// parent, an agent asks its master, a master asks the admin. A user created directly under a master
// asks that master. A user under an agent asks that agent only — it cannot skip the agent and ask
// the master. The account it was sent to, or a master / agent above that account, approves.
// Approving as a master credits or debits the account below and does not use the master's own
// balance. An agent still pays out of its own balance. The admin decides its own masters' requests
// only (the accounts its cash moves in and out of; see routes/wallet.js).
import { Router } from 'express';
import { z } from 'zod';
import { all, db, one, withTransaction } from '../db.js';
import { UPLINE_ROLES, canAccess, requireRole, userScope } from '../auth.js';
import { houseMasterId } from '../books.js';
import { getMasterSettings } from './master-settings.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { depositTo, withdrawFrom } from '../services/wallet.js';
import { broadcast } from '../live.js';

export const router = Router();

const id = z.coerce.number().int().positive();
export const METHODS = ['KPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Cash', 'Other'];

const listSql = `SELECT r.*, u.username, u.name AS user_name, u.role AS user_role, u.balance AS user_balance, d.username AS decided_by_username
  FROM wallet_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by`;

// Who may decide a request: the master / agent above the asking account, and the admin for a
// master's own request. The admin does not reach into a master's tree — an agent's or a user's
// request is decided by the master / agent above it, and the admin only reads it.
function assertDecidable(actor, target) {
  if (actor.role === 'admin' && target.role !== 'master') {
    throw forbidden('Agent / User ၏ ငွေသွင်း / ငွေထုတ် တောင်းဆိုမှုကို သက်ဆိုင်ရာ Master / Agent က အတည်ပြုရပါမည် — Admin မှာ မှတ်တမ်းသာ ကြည့်နိုင်သည်');
  }
}

// The decider is the account the request was sent to, or a master / agent above that account.
async function assertRecipient(client, actor, request) {
  if (request.agent_id == null || actor.role === 'admin') return;
  if (!(await canAccess(client, actor, { id: request.agent_id }))) throw notFound('Request not found');
}

const loadRequest = async (client, requestId) => {
  const row = await one(client, `${listSql} WHERE r.id = ?`, [requestId]);
  if (!row) throw notFound('Request not found');
  return row;
};

router.get('/', async (req, res) => {
  const q = z
    .object({
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    })
    .parse(req.query);
  const scope = userScope(req.user, 'r.user_id');
  const where = [scope.sql];
  const args = [...scope.args];
  if (q.status) { where.push('r.status = ?'); args.push(q.status); }
  res.json(await all(db, `${listSql} WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ?`, [...args, q.limit]));
});

// Pending requests from the caller's downline, waiting to be acted on (dashboard badge).
router.get('/pending-count', requireRole(...UPLINE_ROLES), async (req, res) => {
  const scope = userScope(req.user, 'r.user_id');
  res.json(await one(db, `SELECT COUNT(*) AS count FROM wallet_requests r WHERE r.status = 'pending' AND ${scope.sql}`, scope.args));
});

// Where to send money (ငွေဖြည့်): the KPay / WavePay numbers of the account the caller hangs under.
// A user under an agent sees that agent. A user created directly under a master sees that master.
// An agent sees its master, a master the admin. null when that account has set none.
// If the master has set user_wallet_display = 'master', users always see the master's wallet info
// instead of their direct upline's.
router.get('/pay-to', requireRole('master', 'agent', 'user'), async (req, res) => {
  // For user accounts, check if the master prefers a single wallet display for all users.
  if (req.user.role === 'user') {
    const masterId = await houseMasterId(db, req.user);
    if (masterId) {
      const settings = await getMasterSettings(masterId);
      if (settings.user_wallet_display === 'master') {
        const master = await one(db, 'SELECT username, name, role, kpay_no, kpay_name, wave_no, wave_name FROM users WHERE id = ?', [masterId]);
        return res.json(master && (master.kpay_no || master.wave_no) ? master : null);
      }
    }
  }
  const up = req.user.parent_id
    ? await one(db, 'SELECT username, name, role, kpay_no, kpay_name, wave_no, wave_name FROM users WHERE id = ?', [req.user.parent_id])
    : null;
  res.json(up && (up.kpay_no || up.wave_no) ? up : null);
});

// Any account with an upline may ask it for money: a user, an agent, a master. (The admin has
// none — it is where money enters a master and moves it directly.)
router.post('/', requireRole('master', 'agent', 'user'), async (req, res) => {
  if (!req.user.parent_id) throw badRequest('Your account has no upline to ask');
  const body = z
    .object({
      type: z.enum(['deposit', 'withdraw']),
      amount: z.number().int().positive().max(1_000_000_000),
      method: z.enum(METHODS),
      account_name: z.string().trim().max(100).optional(),
      account_no: z.string().trim().max(50).optional(),
      txn_ref: z.string().trim().max(100).optional(),
      note: z.string().trim().max(255).optional(),
    })
    .parse(req.body);
  // One hop only: the parent. A user under a master therefore asks the master; a user under an
  // agent asks the agent and cannot name the master instead.
  if (body.type === 'withdraw') {
    if (!body.account_no) throw badRequest('Enter the account to receive the money');
    // Pending withdrawals count against the balance, so a user can't ask for the same money twice.
    const { pending } = await one(
      db,
      `SELECT COALESCE(SUM(amount), 0) AS pending FROM wallet_requests WHERE user_id = ? AND type = 'withdraw' AND status = 'pending'`,
      [req.user.id]
    );
    if (body.amount + pending > req.user.balance) throw badRequest('Insufficient balance');
  }
  const row = await one(
    db,
    `INSERT INTO wallet_requests (user_id, agent_id, type, amount, method, account_name, account_no, txn_ref, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [req.user.id, req.user.parent_id ?? null, body.type, body.amount, body.method,
      body.account_name || null, body.account_no || null, body.txn_ref || null, body.note || null]
  );
  broadcast('wallet-requests');
  res.status(201).json(await loadRequest(db, row.id));
});

router.post('/:id/cancel', requireRole('master', 'agent', 'user'), async (req, res) => {
  const request = await loadRequest(db, id.parse(req.params.id));
  if (request.user_id !== req.user.id) throw notFound('Request not found');
  if (request.status !== 'pending') throw badRequest(`Request is already ${request.status}`);
  await db.execute({ sql: `UPDATE wallet_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?`, args: [request.id] });
  broadcast('wallet-requests');
  res.json(await loadRequest(db, request.id));
});

// Approve: moves the money. A master fills the account below without using its own balance. An
// agent pays out of its own balance. The admin's cash moves in and out of a master's request.
router.post('/:id/approve', requireRole(...UPLINE_ROLES), async (req, res) => {
  const requestId = id.parse(req.params.id);
  await withTransaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    const target = await one(tx, 'SELECT id, parent_id, role, status FROM users WHERE id = ?', [request.user_id]);
    if (target.id === req.user.id || !(await canAccess(tx, req.user, target))) throw notFound('Request not found');
    await assertRecipient(tx, req.user, request);
    assertDecidable(req.user, target);
    if (request.status !== 'pending') throw badRequest(`Request is already ${request.status}`);
    const note = [request.type === 'deposit' ? 'ငွေဖြည့်' : 'ငွေထုတ်', request.method, request.txn_ref || request.account_no]
      .filter(Boolean).join(' · ');
    if (request.type === 'deposit') await depositTo(tx, req.user, target, request.amount, note);
    else await withdrawFrom(tx, req.user, target, request.amount, note);
    const updated = await one(
      tx,
      `UPDATE wallet_requests SET status = 'approved', decided_by = ?, decided_at = datetime('now')
       WHERE id = ? AND status = 'pending' RETURNING id`,
      [req.user.id, request.id]
    );
    if (!updated) throw badRequest('Request was already decided');
  });
  broadcast('wallet-requests');
  res.json(await loadRequest(db, requestId));
});

// Reject: balances stay as they are. Decided by the same accounts that may approve it.
router.post('/:id/reject', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(255).optional() }).parse(req.body ?? {});
  const request = await loadRequest(db, id.parse(req.params.id));
  const target = await one(db, 'SELECT id, parent_id, role FROM users WHERE id = ?', [request.user_id]);
  if (target.id === req.user.id || !(await canAccess(db, req.user, target))) throw notFound('Request not found');
  await assertRecipient(db, req.user, request);
  assertDecidable(req.user, target);
  if (request.status !== 'pending') throw badRequest(`Request is already ${request.status}`);
  await db.execute({
    sql: `UPDATE wallet_requests SET status = 'rejected', reject_reason = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    args: [reason || null, req.user.id, request.id],
  });
  broadcast('wallet-requests');
  res.json(await loadRequest(db, request.id));
});

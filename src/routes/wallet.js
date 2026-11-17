import { Router } from 'express';
import { z } from 'zod';
import { all, db, one, withTransaction } from '../db.js';
import { UPLINE_ROLES, loadDownlineUser, readScope, requireRole } from '../auth.js';
import { badRequest, forbidden } from '../errors.js';
import { depositTo, withdrawFrom } from '../services/wallet.js';

export const router = Router();

const moveSchema = z.object({
  user_id: z.number().int().positive(),
  amount: z.number().int().positive(),
  note: z.string().max(255).optional(),
});

// The admin's own cash only ever moves in and out of a master's wallet: the master hands it down to
// its agents and users itself. (The admin still sees and can suspend every account below.)
function assertAdminMovesMastersOnly(actor, target) {
  if (actor.role === 'admin' && target.role !== 'master') {
    throw forbidden('Admin သည် master အကောင့်များကိုသာ ငွေထည့် / ငွေထုတ် လုပ်နိုင်ပါသည် — agent / user ကို သက်ဆိုင်ရာ အထက်အကောင့်က ထည့်ပေးရပါမည်');
  }
}

// ငွေဖြည့် / ငွေသွင်း into any account in the caller's downline, however deep. The admin credits a
// master. A master credits its agents and users without spending its own balance. An agent hands
// over its own balance (see services/wallet.js).
router.post('/deposit', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { user_id, amount, note } = moveSchema.parse(req.body);
  const balance = await withTransaction(async (tx) => {
    const target = await loadDownlineUser(tx, req.user, user_id);
    assertAdminMovesMastersOnly(req.user, target);
    return depositTo(tx, req.user, target, amount, note);
  });
  res.json({ user_id, balance });
});

// ငွေထုတ်: takes it back out of an account in the caller's downline. The admin takes it out of a
// master. A master takes it off an agent or user and does not keep it. An agent pulls it back into
// its own balance. Never below zero.
router.post('/withdraw', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { user_id, amount, note } = moveSchema.parse(req.body);
  const balance = await withTransaction(async (tx) => {
    const target = await loadDownlineUser(tx, req.user, user_id);
    assertAdminMovesMastersOnly(req.user, target);
    return withdrawFrom(tx, req.user, target, amount, note);
  });
  res.json({ user_id, balance });
});

router.get('/transactions', async (req, res) => {
  const q = z
    .object({
      user_id: z.coerce.number().int().optional(),
      type: z.string().max(20).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100) })
    .parse(req.query);
  const scope = readScope(req.user, 'w.user_id');
  const where = [scope.sql];
  const args = [...scope.args];
  if (q.user_id) { where.push('w.user_id = ?'); args.push(q.user_id); }
  if (q.type) { where.push('w.type = ?'); args.push(q.type); }
  res.json(
    await all(
      db,
      `SELECT w.*, u.username FROM wallet_transactions w JOIN users u ON u.id = w.user_id
       WHERE ${where.join(' AND ')} ORDER BY w.id DESC LIMIT ?`,
      [...args, q.limit]
    )
  );
});

// ---------------------------------------------------------------- ငွေ Transfer (float)
//
// Every account runs on a float: the money the account above it has handed it. The admin keeps its
// masters on one, a master its own agents and users, an agent its users ("ထည့်ပေးထားသော ငွေ").
// A balance then drifts with what its tree wins and loses. ငွေ Transfer squares it back onto the
// float — what sits over it is taken back, what is short is topped up — so it starts the next round
// with exactly the amount it was given.
//
// The float counts only what came from this very upline: the admin's cash in and out
// ('deposit' / 'withdraw'), and for a master / agent what it handed down itself
// ('transfer_in' / 'transfer_out' with the upline as the counterparty). A master's hand-out does
// not move the master's own balance. The squaring moves are
// written with float_reset = 1 and left out, so the float keeps the same figure however often it
// is squared.

const FLOAT_NOTE = 'ငွေ Transfer';
// ISO weekdays the upline squares up on, 1 = Monday … 7 = Sunday (e.g. "3,6"). The admin's are kept
// under the plain key, everyone else's under their own.
const floatDaysKey = (actor) => (actor.role === 'admin' ? 'float_transfer_days' : `float_transfer_days:${actor.id}`);
const parseDays = (value) => [...new Set(String(value ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 7))].sort();

// The accounts [actor] tops up, with their float and their balance. The admin's are its masters
// (its cash only moves in and out of those, see above); a master's and an agent's are the accounts
// straight under them, which are the ones they hand money to.
function floatRows(client, actor) {
  const admin = actor.role === 'admin';
  const sum = admin
    ? `SELECT SUM(w.amount) FROM wallet_transactions w
         WHERE w.user_id = u.id AND w.float_reset = 0 AND w.type IN ('deposit', 'withdraw')`
    : `SELECT SUM(w.amount) FROM wallet_transactions w
         WHERE w.user_id = u.id AND w.float_reset = 0 AND w.counterparty_id = ?
           AND w.type IN ('transfer_in', 'transfer_out')`;
  const where = admin ? `u.role = 'master'` : `u.parent_id = ? AND u.role <> 'admin'`;
  const args = admin ? [] : [actor.id, actor.id];
  return all(
    client,
    `SELECT u.id, u.username, u.name, u.name_mm, u.role, u.status, u.balance, u.unlimited,
            COALESCE((${sum}), 0) AS float_amount
     FROM users u WHERE ${where} AND u.status <> 'closed'
     ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'agent' THEN 1 ELSE 2 END, u.username`,
    args
  );
}

// delta: what the upline has to move to put the account back on its float (+ top up, − take back).
const withDelta = (rows) => rows.map((r) => ({ ...r, delta: r.float_amount - r.balance }));

// The accounts with their float, their balance and the move that would square them up, plus the
// weekdays this upline does it on (the weekly check boxes).
router.get('/float-targets', requireRole(...UPLINE_ROLES), async (req, res) => {
  const [rows, setting] = await Promise.all([
    floatRows(db, req.user),
    one(db, 'SELECT value FROM settings WHERE key = ?', [floatDaysKey(req.user)]),
  ]);
  const accounts = withDelta(rows);
  // masters: the name this list had when only the admin had this page (admin app 1.0.13).
  res.json({ accounts, masters: accounts, days: parseDays(setting?.value) });
});

router.put('/float-days', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { days } = z.object({ days: z.array(z.number().int().min(1).max(7)).max(7) }).parse(req.body);
  const value = parseDays(days.join(',')).join(',');
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [floatDaysKey(req.user), value],
  });
  res.json({ days: parseDays(value) });
});

// Squares the named accounts back onto their float. Each one is read again inside the transaction,
// so a balance that moved in the meantime is squared on its latest figure. Accounts already on
// their float are skipped, as is one whose float is negative (more has been taken out of it than
// was ever put in — there is no float to put it back on).
router.post('/float-reset', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { user_ids } = z.object({ user_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(req.body);
  const wanted = new Set(user_ids);

  const results = await withTransaction(async (tx) => {
    const rows = withDelta(await floatRows(tx, req.user)).filter((r) => wanted.has(r.id));
    if (!rows.length) throw badRequest('အကောင့် မတွေ့ပါ');
    const movable = rows.filter((r) => r.float_amount >= 0 && r.delta !== 0);

    // An agent tops up out of its own balance, so the whole round is checked first — one account
    // short would otherwise leave the rest half done. A master fills balances directly.
    if (req.user.role === 'agent' && !req.user.unlimited) {
      const owed = movable.filter((r) => r.delta > 0).reduce((a, r) => a + r.delta, 0);
      const back = movable.filter((r) => r.delta < 0).reduce((a, r) => a - r.delta, 0);
      if (owed - back > req.user.balance) {
        throw badRequest(`လက်ကျန်ငွေ မလုံလောက်ပါ — ${owed - back} ကျပ် လိုအပ်ပြီး ${req.user.balance} ကျပ်သာ ရှိသည်`);
      }
    }

    const done = [];
    for (const account of rows) {
      if (account.float_amount < 0) {
        done.push({ ...account, moved: 0, skipped: 'float_negative' });
        continue;
      }
      if (account.delta === 0) {
        done.push({ ...account, moved: 0, skipped: 'on_float' });
        continue;
      }
      const target = { id: account.id, role: account.role };
      const balance = account.delta > 0
        ? await depositTo(tx, req.user, target, account.delta, `${FLOAT_NOTE} · ပြန်ဖြည့်`, { floatReset: true })
        : await withdrawFrom(tx, req.user, target, -account.delta, `${FLOAT_NOTE} · ပိုသည် နုတ်`, { floatReset: true });
      done.push({ ...account, moved: account.delta, balance });
    }
    return done;
  });

  await db.execute({
    sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'wallet.float_reset', ?)`,
    args: [req.user.id, JSON.stringify(results.map((r) => ({ id: r.id, moved: r.moved, skipped: r.skipped ?? null })))],
  });
  res.json({
    accounts: results,
    masters: results, // legacy name, see /float-targets
    moved: results.filter((r) => r.moved).length,
    deposited: results.filter((r) => r.moved > 0).reduce((a, r) => a + r.moved, 0),
    withdrawn: results.filter((r) => r.moved < 0).reduce((a, r) => a - r.moved, 0),
  });
});

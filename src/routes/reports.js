import { Router } from 'express';
import { z } from 'zod';
import { all, db, one } from '../db.js';
import { UPLINE_ROLES, loadViewableUser, readScope, requireRole, userScope } from '../auth.js';
import { visibleOwnerSql } from '../books.js';

export const router = Router();

// Headline numbers for the dashboard, scoped to what the caller can see.
router.get('/overview', requireRole(...UPLINE_ROLES), async (req, res) => {
  const users = readScope(req.user, 'id');
  const tickets = readScope(req.user, 't.user_id');
  const folders = await visibleOwnerSql(db, req.user, 'f.master_id');
  const [accounts, terms, today] = await Promise.all([
    all(db, `SELECT role, COUNT(*) AS count, SUM(status = 'active') AS active, COALESCE(SUM(balance), 0) AS balance
             FROM users WHERE ${users.sql} GROUP BY role`, users.args),
    all(db, `SELECT t.status, COUNT(*) AS count FROM terms t LEFT JOIN term_folders f ON f.id = t.folder_id
             WHERE ${folders.sql} GROUP BY t.status`, folders.args),
    one(db, `SELECT COUNT(*) AS tickets, COALESCE(SUM(net_amount), 0) AS sales
             FROM tickets t WHERE t.status <> 'cancelled' AND date(t.created_at) = date('now') AND ${tickets.sql}`,
        tickets.args),
  ]);
  res.json({ accounts, terms, today });
});

// Sales vs. payout for a term, grouped by user or — for an admin or a master — by agent
// (tickets.agent_id, the account the bettor hangs under). user_id / agent_id narrow it to one
// person: with group_by=user, agent_id gives that agent's users one row each.
// folder_id in place of term_id: every term in that ဖိုင် at once, one row per person for the lot
// (the admin app's "အပါတ်စဥ် အားလုံး"). Exactly one of the two is required.
router.get('/summary', requireRole(...UPLINE_ROLES), async (req, res) => {
  const q = z
    .object({
      term_id: z.coerce.number().int().positive().optional(),
      folder_id: z.coerce.number().int().positive().optional(),
      group_by: z.enum(['user', 'agent']).default('user'),
      user_id: z.coerce.number().int().positive().optional(),
      agent_id: z.coerce.number().int().positive().optional(),
    })
    .refine((v) => (v.term_id === undefined) !== (v.folder_id === undefined), {
      message: 'term_id or folder_id is required (not both)',
    })
    .parse(req.query);
  const scope = readScope(req.user, 't.user_id');
  const key = q.group_by === 'agent' && req.user.role !== 'agent' ? 't.agent_id' : 't.user_id';
  const term = q.term_id === undefined ? 't.term_id IN (SELECT id FROM terms WHERE folder_id = ?)' : 't.term_id = ?';
  const where = [term, `t.status <> 'cancelled'`, scope.sql];
  const args = [q.term_id ?? q.folder_id, ...scope.args];
  for (const column of ['user_id', 'agent_id']) {
    if (q[column] !== undefined) { where.push(`t.${column} = ?`); args.push(q[column]); }
  }

  res.json(
    await all(
      db,
      `SELECT u.id, u.username, u.name,
              COUNT(t.id) AS tickets,
              SUM(t.gross_amount) AS gross,
              SUM(t.discount_amount) AS discount,
              SUM(t.net_amount) AS net,
              SUM(t.win_amount) AS payout,
              SUM(t.net_amount) - SUM(t.win_amount) AS profit
       FROM tickets t JOIN users u ON u.id = ${key}
       WHERE ${where.join(' AND ')}
       GROUP BY u.id ORDER BY net DESC`,
      args
    )
  );
});

// Betting per term (the user apps' စာရင်း page). By default the signed-in account's own; with
// user_id an upline gets one account's — a user's own slips, or for an
// agent / master every slip of the users under it — with that account's ငွေရှင်း (the admin app's
// 👁 on a စာရင်း row).
router.get('/mine', async (req, res) => {
  const q = z
    .object({
      user_id: z.coerce.number().int().positive().optional(),
      game: z.enum(['2D', '3D']).optional(),
      cleared: z.enum(['0', '1']).optional(), // 1 = only terms marked ငွေရှင်းပြီး for me from above, 0 = only not yet
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .parse(req.query);
  const other = q.user_id && q.user_id !== req.user.id;
  const account = other ? await loadViewableUser(db, req.user, q.user_id) : req.user;
  // Own report: the caller's own slips. Another account: a user's own slips, or for an agent /
  // master the slips of every user under it.
  const bettors = !other || account.role === 'user' ? { sql: 't.user_id = ?', args: [account.id] } : userScope(account, 't.user_id');
  const where = [];
  const args = [account.id, ...bettors.args];
  if (q.game) { where.push('tm.game = ?'); args.push(q.game); }
  if (q.cleared) where.push(`c.term_id IS ${q.cleared === '1' ? 'NOT ' : ''}NULL`);
  args.push(q.limit);
  // cleared_at: when the admin marked this term ငွေရှင်းပြီး (settled up) for me, or null.
  res.json(
    await all(
      db,
      `SELECT t.term_id, tm.description, tm.game, tm.status, tm.draw_at, tm.close_at, tm.folder_id, f.name AS folder_name,
              COUNT(t.id) AS tickets,
              SUM(t.gross_amount) AS gross,
              SUM(t.discount_amount) AS discount,
              SUM(t.net_amount) AS net,
              SUM(t.win_amount) AS win,
              SUM(t.win_amount) - SUM(t.net_amount) AS result,
              c.cleared_at
       FROM tickets t JOIN terms tm ON tm.id = t.term_id
       LEFT JOIN term_clearings c ON c.term_id = t.term_id AND c.account_id = ?
       LEFT JOIN term_folders f ON f.id = tm.folder_id
       WHERE ${bettors.sql} AND t.status <> 'cancelled' ${where.map((w) => `AND ${w}`).join(' ')}
       GROUP BY t.term_id
       ORDER BY COALESCE(tm.draw_at, tm.close_at, tm.created_at) DESC, t.term_id DESC
       LIMIT ?`,
      args
    )
  );
});

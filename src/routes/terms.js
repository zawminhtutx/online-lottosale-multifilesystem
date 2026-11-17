import { Router } from 'express';
import { z } from 'zod';
import { all, db, one, withTransaction } from '../db.js';
import { UPLINE_ROLES, canAccess, liveLedgerScope, readScope, requireRole, userScope } from '../auth.js';
import { assertManagesFolder, assertTermVisible, managesFolder, visibleOwnerSql } from '../books.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { betTypeFitsTerm, parseResults, winningNumbers } from '../rules.js';
import { saveResults, settleTerm } from '../services/settlement.js';
import { applyBalance } from '../services/wallet.js';
import { broadcast } from '../live.js';
import { consumeExport } from './sales-data.js';
import { openDueTerms } from '../services/auto-open.js';

export const router = Router();

// Each master runs every admin job on the files and terms it owns: settings, break, max unit,
// closed numbers, hot numbers, purchases, results, slips. None of those need hot_edit or
// ledger_access. The admin still runs folders that have no master — the original shared book.
// A master with hot_edit may still edit hot numbers on that shared book. Live Ledger of the
// master's own tree is always on; ledger_access only adds other masters' trees.
//
// Every successful change to a term (new term, edit, limits, results, settle) is pushed to live
// clients, so the online web app's term list updates without a refresh.
router.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) broadcast('terms'); });
  next();
});

const id = z.coerce.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

// Unit break / closed numbers may only name bet types the term accepts (2D term -> 2D, 3D term -> 3D).
async function assertTypesFitTerm(term, betTypeIds) {
  const ids = [...new Set(betTypeIds)];
  if (!ids.length) return;
  const types = await all(db, `SELECT * FROM bet_types WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (types.length !== ids.length || types.some((bt) => !betTypeFitsTerm(bt, term.game))) {
    throw badRequest(`This term is ${term.game} only`);
  }
}

async function loadTerm(termId) {
  const term = await one(db, 'SELECT * FROM terms WHERE id = ?', [termId]);
  if (!term) throw notFound('Term not found');
  return term;
}

async function termCanManage(actor, term) {
  if (!term.folder_id) return actor.role === 'admin';
  const folder = await one(db, 'SELECT master_id FROM term_folders WHERE id = ?', [term.folder_id]);
  return managesFolder(actor, folder ?? { master_id: null });
}

async function loadSeenTerm(actor, termId) {
  const term = await loadTerm(termId);
  await assertTermVisible(db, actor, term);
  term.can_manage = await termCanManage(actor, term);
  return term;
}

async function loadManagedTerm(actor, termId) {
  const term = await loadSeenTerm(actor, termId);
  if (!term.can_manage) throw forbidden('This term belongs to another account');
  return term;
}

router.get('/', async (req, res) => {
  await openDueTerms(); // drafts whose open time has come are Active before anyone looks
  const { status, folder_id } = z
    .object({
      status: z.enum(['draft', 'open', 'closed', 'drawn', 'settled', 'cancelled']).optional(),
      folder_id: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  const where = [];
  const args = [];
  if (status) { where.push('terms.status = ?'); args.push(status); } else if (req.user.role === 'user') where.push("terms.status <> 'draft'");
  if (folder_id) { where.push('terms.folder_id = ?'); args.push(folder_id); }
  const owner = await visibleOwnerSql(db, req.user, 'f.master_id');
  where.push(owner.sql);
  args.push(...owner.args);
  // slip_count: a term without slips can be deleted straight away (see DELETE /:id).
  // folder_name: the term's ဖိုင် (the user app's ဖိုင် → အပါတ်စဥ် boxes list every term of a folder).
  const rows = await all(
    db,
    `SELECT terms.*, (SELECT COUNT(*) FROM tickets k WHERE k.term_id = terms.id) AS slip_count,
            f.name AS folder_name, f.master_id
     FROM terms LEFT JOIN term_folders f ON f.id = terms.folder_id
     WHERE ${where.join(' AND ')} ORDER BY terms.id DESC LIMIT 100`,
    args
  );
  for (const row of rows) row.can_manage = managesFolder(req.user, row);
  res.json(rows);
});

// Recent terms that have results (drawn / settled), newest draw first, with their results —
// the online web app's "win numbers" page. Any signed-in account may read it.
router.get('/results', async (req, res) => {
  const q = z
    .object({ game: z.enum(['2D', '3D']).optional(), limit: z.coerce.number().int().min(1).max(200).default(60) })
    .parse(req.query);
  const owner = await visibleOwnerSql(db, req.user, 'f.master_id');
  const terms = await all(
    db,
    `SELECT t.id, t.description, t.game, t.unit_price, t.close_at, t.draw_at, t.status
     FROM terms t LEFT JOIN term_folders f ON f.id = t.folder_id
     WHERE t.status IN ('drawn', 'settled') ${q.game ? 'AND t.game = ?' : ''} AND ${owner.sql}
     ORDER BY COALESCE(t.draw_at, t.close_at, t.created_at) DESC, t.id DESC LIMIT ?`,
    q.game ? [q.game, ...owner.args, q.limit] : [...owner.args, q.limit]
  );
  if (terms.length) {
    const results = await all(
      db,
      `SELECT term_id, slot, value FROM term_results WHERE term_id IN (${terms.map(() => '?').join(',')}) ORDER BY slot`,
      terms.map((t) => t.id)
    );
    for (const term of terms) term.results = results.filter((r) => r.term_id === term.id).map(({ slot, value }) => ({ slot, value }));
  }
  res.json(terms);
});

router.get('/:id', async (req, res) => {
  await openDueTerms();
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  term.results = await all(db, 'SELECT slot, label, value FROM term_results WHERE term_id = ? ORDER BY slot', [term.id]);
  term.limits = await all(db, 'SELECT bet_type_id, max_units FROM term_unit_limits WHERE term_id = ?', [term.id]);
  term.blocked = await all(db, 'SELECT bet_type_id, number FROM term_blocked_numbers WHERE term_id = ?', [term.id]);
  term.hot = await all(db, 'SELECT bet_type_id, number FROM term_hot_numbers WHERE term_id = ?', [term.id]);
  term.slip_count = (await one(db, 'SELECT COUNT(*) AS n FROM tickets WHERE term_id = ?', [term.id])).n;
  // Per-user hot %: the admin sees everyone's, a master its downline's, anyone else only their own.
  const hotScope = ['admin', 'master'].includes(req.user.role)
    ? userScope(req.user, 'p.user_id')
    : { sql: 'p.user_id = ?', args: [req.user.id] };
  term.hot_users = await all(
    db,
    `SELECT p.user_id, u.username, u.name, p.percent FROM term_hot_user_percents p JOIN users u ON u.id = p.user_id
     WHERE p.term_id = ? AND ${hotScope.sql} ORDER BY u.username`,
    [term.id, ...hotScope.args]
  );
  res.json(term);
});

// Numbers that have reached the term's unit break (across everyone's slips) — the mobile Sale
// screen's "full numbers" list. Only the full numbers are returned, not anyone's totals below it.
router.get('/:id/full-numbers', async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  res.json(
    await all(
      db,
      `SELECT ti.bet_type_id, ti.number, SUM(ti.units) AS units, tl.max_units
       FROM ticket_items ti
       JOIN tickets t ON t.id = ti.ticket_id
       JOIN term_unit_limits tl ON tl.term_id = ti.term_id AND tl.bet_type_id = ti.bet_type_id AND tl.max_units > 0
       WHERE ti.term_id = ? AND t.status <> 'cancelled'
       GROUP BY ti.bet_type_id, ti.number
       HAVING SUM(ti.units) >= tl.max_units
       ORDER BY ti.number`,
      [term.id]
    )
  );
});

// No .default() here: zod v4 applies defaults even through .partial(), which would clobber PATCHes.
const termFields = z.object({
  description: z.string().trim().min(1).max(100),
  game: z.enum(['2D', '3D']),
  unit_price: z.number().int().positive(),
  open_at: isoDate.nullable(),
  close_at: isoDate.nullable(),
  draw_at: isoDate.nullable(),
  // New terms open straight away; there is no draft or cancel step any more. (Old draft terms can
  // still be opened; old draft / cancelled terms only show in lists.)
  status: z.enum(['open', 'closed']),
  folder_id: z.number().int().positive(), // ဖိုင် (term_folders): every term lives in a folder
});

// New terms start with this default hot % (changed per term on its hot numbers tab).
const DEFAULT_HOT_PERCENT = 10;

// unit_break (optional): the term's unit break (max units per number, 0 = none), saved with the
// term for every active bet type the term takes — the New term form's "Break" field.
router.post('/', requireRole('admin', 'master'), async (req, res) => {
  const t = termFields
    .partial()
    .required({ description: true, folder_id: true }) // create a folder first
    .extend({ unit_break: z.number().int().min(0).optional() })
    .parse(req.body);
  await assertManagesFolder(db, req.user, t.folder_id);
  const term = await withTransaction((tx) => insertTerm(tx, t, req.user.id));
  term.can_manage = true;
  res.status(201).json(term);
});

// Inserts one term (and its unit break for every active bet type it takes) inside [tx]. Also used
// by term-folders.js to create a new folder's automatic terms (the "auto terms" setting).
// Erases one term and everything under it (slips, results, limits …) inside [tx]. Wallet history
// stays (its slip link is cleared). Callers refund active slips / check backups first.
export async function eraseTerm(tx, termId) {
  const ticketIds = 'SELECT id FROM tickets WHERE term_id = ?';
  for (const sql of [
    `UPDATE wallet_transactions SET ticket_id = NULL WHERE ticket_id IN (${ticketIds})`,
    `DELETE FROM slip_cancel_requests WHERE ticket_id IN (${ticketIds})`,
    'DELETE FROM slip_edit_logs WHERE term_id = ?',
    'DELETE FROM ticket_items WHERE term_id = ?',
    `DELETE FROM ticket_groups WHERE ticket_id IN (${ticketIds})`,
    'DELETE FROM tickets WHERE term_id = ?',
    ...['term_results', 'term_unit_limits', 'term_user_limits', 'term_blocked_numbers', 'term_hot_numbers', 'term_hot_user_percents', 'ledger_cut_rules', 'term_purchases', 'win_numbers', 'term_clearings']
      .map((table) => `DELETE FROM ${table} WHERE term_id = ?`),
    'DELETE FROM terms WHERE id = ?',
  ]) await tx.execute({ sql, args: [termId] });
}

export async function insertTerm(tx, t, userId) {
  const game = t.game ?? '2D';
  const types = t.unit_break
    ? (await all(tx, 'SELECT * FROM bet_types WHERE is_active = 1')).filter((bt) => betTypeFitsTerm(bt, game))
    : [];
  const row = await one(
    tx,
    `INSERT INTO terms (description, game, unit_price, open_at, close_at, draw_at, status, folder_id, hot_percent, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [t.description, game, t.unit_price ?? 25, t.open_at ?? null, t.close_at ?? null, t.draw_at ?? null, t.status ?? 'open', t.folder_id, DEFAULT_HOT_PERCENT, userId]
  );
  for (const bt of types) {
    await tx.execute({
      sql: 'INSERT INTO term_unit_limits (term_id, bet_type_id, max_units) VALUES (?, ?, ?)',
      args: [row.id, bt.id, t.unit_break],
    });
  }
  return row;
}

router.patch('/:id', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  // 'draft' here = Unactive: the admin hides an Active term from users again (Active = 'open').
  const body = termFields.partial().extend({ status: z.enum(['open', 'closed', 'draft']).optional() }).parse(req.body);
  // A drawn / settled term can still be moved to another folder, but nothing else changes.
  const onlyFolder = Object.entries(body).every(([key, value]) => key === 'folder_id' || value === undefined);
  if (['drawn', 'settled'].includes(term.status) && !onlyFolder) throw badRequest(`Term is already ${term.status}`);
  if (body.folder_id !== undefined) await assertManagesFolder(db, req.user, body.folder_id);

  const hasTickets = await one(db, `SELECT 1 FROM tickets WHERE term_id = ? AND status <> 'cancelled' LIMIT 1`, [term.id]);
  if (hasTickets && body.unit_price !== undefined && body.unit_price !== term.unit_price) {
    throw badRequest('Cannot change unit price after tickets were sold');
  }
  // Making a term Active (draft → open) sets its open time (ဖွင့်ချိန်) to that moment.
  if (term.status === 'draft' && body.status === 'open' && body.open_at === undefined) body.open_at = new Date().toISOString();
  // Unactive (→ draft) clears the open time, so the term doesn't open again by itself (auto-open.js).
  if (body.status === 'draft' && term.status !== 'draft' && body.open_at === undefined) body.open_at = null;

  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) { sets.push(`${key} = ?`); args.push(value); }
  }
  if (!sets.length) throw badRequest('Nothing to update');
  res.json(await one(db, `UPDATE terms SET ${sets.join(', ')} WHERE id = ? RETURNING *`, [...args, term.id]));
});

// Delete a term (any status) with its slips, results and limits. Its active slips are refunded first. Wallet history stays (its slip link is cleared),
// so every balance still adds up to its transactions.
// A term with sales (slips) needs an Excel backup of it first: GET /api/sales-data/export.xlsx?term_id=…
// gives the export_token for the body (see sales-data.js). A term without slips goes at once.
router.delete('/:id', requireRole('admin', 'master'), async (req, res) => {
  const termId = id.parse(req.params.id);
  await loadManagedTerm(req.user, termId);
  const { export_token: exportToken } = z.object({ export_token: z.string().optional() }).parse(req.body ?? {});
  const deleted = await withTransaction(async (tx) => {
    const term = await one(tx, 'SELECT * FROM terms WHERE id = ?', [termId]);
    if (!term) throw notFound('Term not found');
    // Sales (slips) → the Excel backup must come first. No sales (e.g. an auto term not needed) →
    // nothing to back up, it goes at once.
    if (await one(tx, 'SELECT 1 FROM tickets WHERE term_id = ? LIMIT 1', [term.id])) await consumeExport(tx, exportToken, term.id);
    let refunded = 0;
    const active = await all(tx, `SELECT id, user_id, slip_no, net_amount FROM tickets WHERE term_id = ? AND status = 'active'`, [term.id]);
    for (const t of active) {
      await applyBalance(tx, t.user_id, t.net_amount, 'refund', { createdBy: req.user.id, note: `Delete term #${term.id} slip ${t.slip_no}` });
      refunded += t.net_amount;
    }
    const { n: slips } = await one(tx, 'SELECT COUNT(*) AS n FROM tickets WHERE term_id = ?', [term.id]);
    await eraseTerm(tx, term.id);
    const detail = { termId: term.id, description: term.description, status: term.status, slips, refunded };
    await tx.execute({
      sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'term.delete', ?)`,
      args: [req.user.id, JSON.stringify(detail)],
    });
    return detail;
  });
  res.json(deleted);
});

// UNITBREAK: max units per number, per bet type (0 = unlimited).
router.put('/:id/limits', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  const rows = z.array(z.object({ bet_type_id: z.number().int(), max_units: z.number().int().min(0) })).parse(req.body);
  await assertTypesFitTerm(term, rows.map((r) => r.bet_type_id));
  await db.batch(
    [
      { sql: 'DELETE FROM term_unit_limits WHERE term_id = ?', args: [term.id] },
      ...rows.map((r) => ({
        sql: 'INSERT INTO term_unit_limits (term_id, bet_type_id, max_units) VALUES (?, ?, ?)',
        args: [term.id, r.bet_type_id, r.max_units],
      })),
    ],
    'write'
  );
  res.json(rows);
});

// Unit per number, per user, for this term (admin, or a master for its own users). Each limit must
// fit the term's type and stay within the term's unit break, which only the admin sets. The list
// replaces the caller's current per-user limits for this term: the admin's covers everyone, a
// master's only its own downline — limits set by another account are left alone.
const userLimitRows = (termId, actor) => {
  const scope = userScope(actor, 'l.user_id');
  return all(
    db,
    `SELECT l.user_id, u.username, u.name, l.bet_type_id, l.max_units
     FROM term_user_limits l JOIN users u ON u.id = l.user_id
     WHERE l.term_id = ? AND ${scope.sql} ORDER BY u.username`,
    [termId, ...scope.args]
  );
};

router.get('/:id/user-limits', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  res.json(await userLimitRows(term.id, req.user));
});

router.put('/:id/user-limits', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  if (['drawn', 'settled', 'cancelled'].includes(term.status)) throw badRequest(`Term is already ${term.status}`);
  const rows = z
    .array(z.object({ user_id: z.number().int().positive(), bet_type_id: z.number().int().min(0), max_units: z.number().int().positive() }))
    .max(1000)
    .parse(req.body);
  await assertTypesFitTerm(term, rows.map((r) => r.bet_type_id));

  const seen = new Set();
  for (const r of rows) {
    const key = `${r.user_id}:${r.bet_type_id}`;
    if (seen.has(key)) throw badRequest('Each user may appear only once');
    seen.add(key);
  }
  const breaks = new Map((await all(db, 'SELECT bet_type_id, max_units FROM term_unit_limits WHERE term_id = ?', [term.id]))
    .map((l) => [l.bet_type_id, l.max_units]));
  for (const r of rows) {
    const cap = breaks.get(r.bet_type_id);
    if (cap > 0 && r.max_units > cap) throw badRequest(`Limit ${r.max_units} is above the unit break (${cap})`);
  }
  const scope = userScope(req.user, 'id');
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length) {
    const found = await all(
      db,
      `SELECT id FROM users WHERE role = 'user' AND id IN (${ids.map(() => '?').join(', ')}) AND ${scope.sql}`,
      [...ids, ...scope.args]
    );
    if (found.length !== ids.length) throw badRequest('Limits can only be set for your own user accounts');
  }

  const wipe = userScope(req.user, 'user_id');
  await db.batch(
    [
      { sql: `DELETE FROM term_user_limits WHERE term_id = ? AND ${wipe.sql}`, args: [term.id, ...wipe.args] },
      ...rows.map((r) => ({
        sql: 'INSERT INTO term_user_limits (term_id, user_id, bet_type_id, max_units) VALUES (?, ?, ?, ?)',
        args: [term.id, r.user_id, r.bet_type_id, r.max_units],
      })),
    ],
    'write'
  );
  res.json(await userLimitRows(term.id, req.user));
});

router.put('/:id/blocked', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  const rows = z.array(z.object({ bet_type_id: z.number().int(), number: z.string().regex(/^\d{1,3}$/) })).parse(req.body);
  await assertTypesFitTerm(term, rows.map((r) => r.bet_type_id));
  await db.batch(
    [
      { sql: 'DELETE FROM term_blocked_numbers WHERE term_id = ?', args: [term.id] },
      ...rows.map((r) => ({
        sql: 'INSERT OR IGNORE INTO term_blocked_numbers (term_id, bet_type_id, number) VALUES (?, ?, ?)',
        args: [term.id, r.bet_type_id, r.number],
      })),
    ],
    'write'
  );
  res.json(rows);
});

// Hot numbers: open for betting, but on each one a user may bet at most their hot % of their own
// total bets in this term (see placeTicket). `percent` is the default; `users` sets a % per user.
// The body replaces the term's default %, hot list and per-user %s.
router.put('/:id/hot', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const legacyHot = req.user.role === 'master' && Number(req.user.hot_edit) === 1 && !term.can_manage;
  if (!term.can_manage && !legacyHot) throw forbidden('Hot number edit is not enabled');
  if (['drawn', 'settled', 'cancelled'].includes(term.status)) throw badRequest(`Term is already ${term.status}`);
  const pct = z.number().int().min(0).max(100);
  const { percent, numbers, users } = z
    .object({
      percent: pct,
      numbers: z.array(z.object({ bet_type_id: z.number().int(), number: z.string().regex(/^\d{1,3}$/) })).max(1000),
      users: z.array(z.object({ user_id: z.number().int().positive(), percent: pct })).max(1000).default([]),
    })
    .parse(req.body);
  await assertTypesFitTerm(term, numbers.map((r) => r.bet_type_id));
  const ids = [...new Set(users.map((u) => u.user_id))];
  if (ids.length !== users.length) throw badRequest('Each user may appear only once');
  if (ids.length) {
    const found = await all(db, `SELECT id FROM users WHERE role = 'user' AND id IN (${ids.map(() => '?').join(', ')})`, ids);
    if (found.length !== ids.length) throw badRequest('Limits can only be set for user accounts');
  }
  // A master only replaces per-user % of its own downline so other trees' rows stay.
  const wipeUsers = term.can_manage || req.user.role === 'admin'
    ? { sql: 'DELETE FROM term_hot_user_percents WHERE term_id = ?', args: [term.id] }
    : (() => {
        const scope = userScope(req.user, 'user_id');
        return { sql: `DELETE FROM term_hot_user_percents WHERE term_id = ? AND ${scope.sql}`, args: [term.id, ...scope.args] };
      })();
  if (req.user.role === 'master') {
    for (const uid of ids) {
      if (!(await canAccess(db, req.user, { id: uid }))) throw badRequest('Limits can only be set for user accounts in your downline');
    }
  }
  await db.batch(
    [
      { sql: 'UPDATE terms SET hot_percent = ? WHERE id = ?', args: [percent, term.id] },
      { sql: 'DELETE FROM term_hot_numbers WHERE term_id = ?', args: [term.id] },
      ...numbers.map((r) => ({
        sql: 'INSERT OR IGNORE INTO term_hot_numbers (term_id, bet_type_id, number) VALUES (?, ?, ?)',
        args: [term.id, r.bet_type_id, r.number],
      })),
      wipeUsers,
      ...users.map((u) => ({
        sql: 'INSERT INTO term_hot_user_percents (term_id, user_id, percent) VALUES (?, ?, ?)',
        args: [term.id, u.user_id, u.percent],
      })),
    ],
    'write'
  );
  res.json({ percent, numbers, users });
});

// Enter results. By default this settles in the same step: winners are paid straight away. A
// settled term's result can be corrected the same way — the old winnings are taken back and the
// slips settled again. With ?settle=0 (ငွေရှင်း unticked) the result is only saved and the term
// closed ('drawn'); it is settled later via /settle.
router.put('/:id/results', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  const { settle } = z.object({ settle: z.enum(['0', '1']).default('1') }).parse(req.query);
  if (term.close_at && new Date() < new Date(term.close_at)) throw badRequest('Betting has not closed yet');

  const rows = z
    .array(z.object({ slot: z.number().int().min(1).max(12), value: z.string().trim().min(1), label: z.string().optional() }))
    .min(1)
    .parse(req.body);
  if (settle === '0') {
    await saveResults(term.id, req.user.id, rows);
    const saved = await all(db, 'SELECT slot, label, value FROM term_results WHERE term_id = ? ORDER BY slot', [term.id]);
    return res.json({ settled: false, status: 'drawn', results: saved });
  }
  const settlement = await settleTerm(term.id, req.user.id, { newResults: rows }); // 3D terms need slot 1, 2D terms slot 2
  // The term is settled and stays in its own folder (ဖိုင်) — nothing is moved or archived.
  const results = await all(db, 'SELECT slot, label, value FROM term_results WHERE term_id = ? ORDER BY slot', [term.id]);
  res.json({ ...settlement, settled: true, corrected: term.status === 'settled', results });
});

router.post('/:id/settle', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  res.json(await settleTerm(term.id, req.user.id));
});

// အဝယ် (purchases / lay-off), admin only. ကျွံ (excess) on a number = units bet on it (slips not
// cancelled) − the term's break (ဘရိတ်) − units already bought. The admin buys the excess (or more)
// from another dealer; a purchase only takes units off the excess and, once the result is in,
// shows what the dealer owes on winning numbers (units × unit price × multiplier). No wallet moves.
const purchaseView = async (term) => {
  const excess = await all(
    db,
    `SELECT ti.bet_type_id, ti.number, SUM(ti.units) AS units, tl.max_units AS break_units,
            COALESCE((SELECT SUM(p.units) FROM term_purchases p
                      WHERE p.term_id = ti.term_id AND p.bet_type_id = ti.bet_type_id AND p.number = ti.number), 0) AS purchased
     FROM ticket_items ti
     JOIN tickets t ON t.id = ti.ticket_id
     JOIN term_unit_limits tl ON tl.term_id = ti.term_id AND tl.bet_type_id = ti.bet_type_id AND tl.max_units > 0
     WHERE ti.term_id = ? AND t.status <> 'cancelled'
     GROUP BY ti.bet_type_id, ti.number
     HAVING SUM(ti.units) > tl.max_units
     ORDER BY ti.bet_type_id, ti.number`,
    [term.id]
  );
  for (const r of excess) r.excess = Math.max(0, r.units - r.break_units - r.purchased);

  const purchases = await all(
    db,
    `SELECT p.*, u.username AS created_by_username FROM term_purchases p LEFT JOIN users u ON u.id = p.created_by
     WHERE p.term_id = ? ORDER BY p.id DESC`,
    [term.id]
  );
  // Once the result is in: what the dealer owes on each winning purchase line.
  const resultRows = await all(db, 'SELECT slot, value FROM term_results WHERE term_id = ?', [term.id]);
  let winners = null;
  if (resultRows.length) {
    try {
      const results = parseResults(resultRows, term.game);
      const codes = new Map((await all(db, 'SELECT id, code FROM bet_types')).map((b) => [b.id, b.code]));
      winners = (p) => winningNumbers(codes.get(p.bet_type_id), results).includes(p.number);
    } catch { winners = null; }
  }
  for (const p of purchases) {
    p.amount = p.units * term.unit_price;
    p.win = winners && winners(p) ? p.units * term.unit_price * p.multiplier : 0;
  }
  const sum = (k) => purchases.reduce((a, p) => a + p[k], 0);
  const defaults = await all(
    db,
    `SELECT bet_type_id, side, multiplier FROM prize_rates WHERE prize_set_id = 0`
  );
  // Default odds for a new purchase: set 0's purchase-side rate, else its sale-side rate.
  const multipliers = {};
  for (const r of defaults) if (r.side === 'sale' && multipliers[r.bet_type_id] === undefined) multipliers[r.bet_type_id] = r.multiplier;
  for (const r of defaults) if (r.side === 'purchase' && r.multiplier > 0) multipliers[r.bet_type_id] = r.multiplier;
  return {
    term_id: term.id,
    status: term.status,
    unit_price: term.unit_price,
    has_results: !!resultRows.length,
    excess,
    purchases,
    multipliers,
    totals: { units: sum('units'), amount: sum('amount'), win: sum('win') },
  };
};

router.get('/:id/purchases', requireRole('admin', 'master'), async (req, res) => {
  res.json(await purchaseView(await loadManagedTerm(req.user, id.parse(req.params.id))));
});

// Body: { items: [{ bet_type_id, number, units }], multiplier?: { [bet_type_id]: n }, note? }.
// Allowed until the result is in (buying after the draw would make no sense).
router.post('/:id/purchases', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  if (!['open', 'closed'].includes(term.status)) throw badRequest('Purchases can only be entered before the result');
  const body = z.object({
    items: z.array(z.object({
      bet_type_id: z.number().int().min(0),
      number: z.string().regex(/^\d{1,3}$/),
      units: z.number().int().positive(),
    })).min(1).max(1000),
    multiplier: z.record(z.string(), z.number().int().min(0)).optional(),
    note: z.string().trim().max(255).optional(),
  }).parse(req.body);
  await assertTypesFitTerm(term, body.items.map((i) => i.bet_type_id));
  const digits = new Map((await all(db, 'SELECT id, digits FROM bet_types')).map((b) => [b.id, b.digits]));
  for (const i of body.items) {
    if (i.number.length !== digits.get(i.bet_type_id)) throw badRequest(`"${i.number}" must be ${digits.get(i.bet_type_id)} digit(s)`);
  }
  const { multipliers } = await purchaseView(term);
  const odds = (typeId) => body.multiplier?.[typeId] ?? multipliers[typeId] ?? 0;
  await db.batch(body.items.map((i) => ({
    sql: `INSERT INTO term_purchases (term_id, bet_type_id, number, units, multiplier, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [term.id, i.bet_type_id, i.number, i.units, odds(i.bet_type_id), body.note || null, req.user.id],
  })), 'write');
  res.status(201).json(await purchaseView(term));
});

// Remove one purchase line (entered by mistake), until the result is in.
router.delete('/:id/purchases/:purchaseId', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadManagedTerm(req.user, id.parse(req.params.id));
  if (!['open', 'closed'].includes(term.status)) throw badRequest('Purchases can only be changed before the result');
  const r = await db.execute({ sql: 'DELETE FROM term_purchases WHERE id = ? AND term_id = ?', args: [id.parse(req.params.purchaseId), term.id] });
  if (!r.rowsAffected) throw notFound('Purchase not found');
  res.json(await purchaseView(term));
});

// Users with bets in this term, for the Live Ledger's user filter.
router.get('/:id/ledger-users', requireRole(...UPLINE_ROLES), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const scope = liveLedgerScope(req.user, 't.user_id');
  res.json(
    await all(
      db,
      `SELECT u.id, u.username, u.name
       FROM tickets t JOIN users u ON u.id = t.user_id
       WHERE t.term_id = ? AND t.status <> 'cancelled' AND ${scope.sql}
       GROUP BY u.id ORDER BY u.username`,
      [term.id, ...scope.args]
    )
  );
});

// Live Ledger: who bet on one number — each user's units, amount and slips on it, most units first
// (slips not cancelled). Admins and enabled masters see all accounts; enabled agents see their users.
router.get('/:id/number-bets', requireRole(...UPLINE_ROLES), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const q = z
    .object({
      bet_type_id: z.coerce.number().int().min(0),
      number: z.string().regex(/^\d{1,3}$/),
      user_ids: z.string().regex(/^\d+(,\d+){0,199}$/).optional(),
    })
    .parse(req.query);
  const scope = liveLedgerScope(req.user, 't.user_id');
  const where = ['ti.term_id = ?', 'ti.bet_type_id = ?', 'ti.number = ?', "t.status <> 'cancelled'", scope.sql];
  const args = [term.id, q.bet_type_id, q.number, ...scope.args];
  if (q.user_ids) {
    const ids = [...new Set(q.user_ids.split(',').map(Number))];
    where.push(`t.user_id IN (${ids.map(() => '?').join(', ')})`);
    args.push(...ids);
  }
  res.json(
    await all(
      db,
      `SELECT t.user_id, u.username, u.name, a.username AS agent_username,
              SUM(ti.units) AS units, SUM(ti.amount) AS amount, COUNT(DISTINCT t.id) AS slips
       FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
       JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.agent_id AND a.role = 'agent'
       WHERE ${where.join(' AND ')}
       GROUP BY t.user_id
       ORDER BY units DESC, u.username`,
      args
    )
  );
});

// Units and potential payout per number. Only the Live Ledger opts into its role-specific scope;
// the separate Exposure page remains limited to the caller's own downline.
router.get('/:id/exposure', requireRole(...UPLINE_ROLES), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const { bet_type_id, user_ids, live_ledger: liveLedger } = z
    .object({
      bet_type_id: z.coerce.number().int().optional(),
      // Live Ledger "Select user": comma-separated user ids (only these users' bets).
      user_ids: z.string().regex(/^\d+(,\d+){0,199}$/).optional(),
      live_ledger: z.enum(['0', '1']).default('0'),
    })
    .parse(req.query);
  const scope = liveLedger === '1' ? liveLedgerScope(req.user, 't.user_id') : readScope(req.user, 't.user_id');
  const where = ['ti.term_id = ?', "t.status <> 'cancelled'", scope.sql];
  const args = [term.id, ...scope.args];
  if (bet_type_id !== undefined) { where.push('ti.bet_type_id = ?'); args.push(bet_type_id); }
  if (user_ids) {
    const ids = [...new Set(user_ids.split(',').map(Number))];
    where.push(`t.user_id IN (${ids.map(() => '?').join(', ')})`);
    args.push(...ids);
  }

  res.json(
    await all(
      db,
      `SELECT ti.bet_type_id, ti.number,
              SUM(ti.units) AS units,
              SUM(ti.amount) AS amount,
              SUM(ti.units * ? * ti.multiplier) AS potential_payout
       FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
       WHERE ${where.join(' AND ')}
       GROUP BY ti.bet_type_id, ti.number
       ORDER BY potential_payout DESC`,
      [term.unit_price, ...args]
    )
  );
});

// ငွေရှင်း (clearing) — per settled term, each account's figures (slips not cancelled): gross,
// commission (discount), net, winnings and balance = net − win (+ the account pays, − it is paid).
// A user's row is their own betting; an agent's is every user under them, a master's is every user
// under its whole downline — the figures are rolled up the parent chain (the `up` CTE below), so
// they add up at every level however deep the tree goes. The admin itself gets no row: it is the
// other side of every one of them.
//
// The admin picks accounts (or all) and marks them settled up, a master its own downline (agents
// do not clear); a snapshot is kept. Winnings were already paid into wallets when the result was
// saved — this only records the squaring up. changed: the figures moved after clearing (e.g. a
// corrected result), so it should be checked.
// scopeOf: userScope for what the caller may clear, readScope for what it may look at.
const clearingRows = (termId, actor, scopeOf = userScope) => {
  const scope = scopeOf(actor, 'a.account_id');
  return all(
    db,
    `WITH RECURSIVE s AS (
       SELECT user_id, COUNT(*) AS slips, SUM(gross_amount) AS gross, SUM(discount_amount) AS discount,
              SUM(net_amount) AS net, SUM(win_amount) AS win
       FROM tickets WHERE term_id = ? AND status <> 'cancelled' GROUP BY user_id
     ), up(account_id, bettor_id) AS (
       SELECT user_id, user_id FROM s
       UNION ALL
       SELECT u.parent_id, up.bettor_id FROM up JOIN users u ON u.id = up.account_id WHERE u.parent_id IS NOT NULL
     ), a AS (
       SELECT up.account_id, SUM(s.slips) AS slips, SUM(s.gross) AS gross, SUM(s.discount) AS discount,
              SUM(s.net) AS net, SUM(s.win) AS win
       FROM up JOIN s ON s.user_id = up.bettor_id GROUP BY up.account_id
     )
     SELECT a.account_id, u.username, u.name, u.role, p.username AS agent_username,
            a.slips, a.gross, a.discount, a.net, a.win, a.net - a.win AS balance,
            c.cleared_at, c.balance AS cleared_balance, cb.username AS cleared_by
     FROM a JOIN users u ON u.id = a.account_id
     LEFT JOIN users p ON p.id = u.parent_id
     LEFT JOIN term_clearings c ON c.term_id = ? AND c.account_id = a.account_id
     LEFT JOIN users cb ON cb.id = c.cleared_by
     WHERE u.role <> 'admin' AND ${scope.sql}
     ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'agent' THEN 1 ELSE 2 END, u.username`,
    [termId, termId, ...scope.args]
  );
};

router.get('/:id/clearing', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const rows = (await clearingRows(term.id, req.user, readScope)).map((r) => ({
    ...r,
    cleared: !!r.cleared_at,
    changed: !!r.cleared_at && r.cleared_balance !== r.balance,
  }));
  res.json({
    term_id: term.id,
    status: term.status,
    masters: rows.filter((r) => r.role === 'master'),
    agents: rows.filter((r) => r.role === 'agent'),
    users: rows.filter((r) => r.role === 'user'),
  });
});

// Body: { account_ids: [..] } — masters, agents and/or users in the caller's own scope;
// already-cleared ones are re-snapshotted.
router.post('/:id/clearing', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  if (term.status !== 'settled') throw badRequest('Clear accounts once the term is settled (results saved)');
  const { account_ids: ids } = z.object({ account_ids: z.array(z.number().int().positive()).min(1) }).parse(req.body);
  const rows = new Map((await clearingRows(term.id, req.user)).map((r) => [r.account_id, r]));
  const unknown = ids.filter((x) => !rows.has(x));
  if (unknown.length) throw badRequest(`No slips in this term for account(s) ${unknown.join(', ')}`);
  await db.batch(
    ids.map((accountId) => {
      const r = rows.get(accountId);
      return {
        sql: `INSERT INTO term_clearings (term_id, account_id, slips, gross, discount, net, win, balance, cleared_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(term_id, account_id) DO UPDATE SET slips = excluded.slips, gross = excluded.gross, discount = excluded.discount,
                net = excluded.net, win = excluded.win, balance = excluded.balance, cleared_by = excluded.cleared_by, cleared_at = datetime('now')`,
        args: [term.id, accountId, r.slips, r.gross, r.discount, r.net, r.win, r.balance, req.user.id],
      };
    }),
    'write'
  );
  res.json({ cleared: ids.length });
});

// Undo a clearing (marked by mistake) — only for an account in the caller's own scope.
router.delete('/:id/clearing/:accountId', requireRole('admin', 'master'), async (req, res) => {
  const term = await loadSeenTerm(req.user, id.parse(req.params.id));
  const accountId = id.parse(req.params.accountId);
  if (!(await canAccess(db, req.user, { id: accountId }))) throw notFound('Not cleared');
  const r = await db.execute({ sql: 'DELETE FROM term_clearings WHERE term_id = ? AND account_id = ?', args: [term.id, accountId] });
  if (!r.rowsAffected) throw notFound('Not cleared');
  res.json({ ok: true });
});

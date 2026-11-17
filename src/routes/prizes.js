import { Router } from 'express';
import { z } from 'zod';
import { all, db, one } from '../db.js';
import { UPLINE_ROLES, requireRole, userScope } from '../auth.js';
import { visibleOwnerSql } from '../books.js';
import { badRequest, forbidden, notFound } from '../errors.js';

export const router = Router();

// Shared prize sets (master_id NULL) stay with the admin. A master prices only the sets it made.
// Agents only hand sets out.
function managesSet(actor, set) {
  const owner = set?.master_id == null ? null : Number(set.master_id);
  if (actor.role === 'admin') return owner == null;
  if (owner == null) return false;
  return actor.role === 'master' && owner === Number(actor.id);
}

async function loadSet(setId) {
  const set = await one(db, 'SELECT * FROM prize_sets WHERE id = ?', [setId]);
  if (!set) throw notFound('Prize set not found');
  return set;
}

async function ratesBySet() {
  const map = new Map();
  for (const r of await all(db, `SELECT prize_set_id, bet_type_id, multiplier, discount FROM prize_rates WHERE side = 'sale'`)) {
    if (!map.has(r.prize_set_id)) map.set(r.prize_set_id, []);
    map.get(r.prize_set_id).push(r);
  }
  return map;
}

// Throws unless this prize set exists. Any upline may then give it to a user.
export async function assertPrizeSetUsable(actor, setId) {
  const set = await one(db, 'SELECT id, master_id FROM prize_sets WHERE id = ?', [setId]);
  if (!set) throw notFound('Prize set not found');
  const scope = await visibleOwnerSql(db, actor, 'master_id');
  const visible = await one(db, `SELECT 1 FROM prize_sets WHERE id = ? AND ${scope.sql}`, [setId, ...scope.args]);
  if (!visible) throw notFound('Prize set not found');
}

// Prize sets with their sale-side odds. user_count is bettors (role=user) in the caller's tree.
router.get('/', requireRole(...UPLINE_ROLES), async (req, res) => {
  const scope = userScope(req.user, 'u.id');
  const owner = await visibleOwnerSql(db, req.user, 'ps.master_id');
  const [sets, rates] = await Promise.all([
    all(db, `SELECT ps.*, (SELECT COUNT(*) FROM users u WHERE u.prize_set_id = ps.id AND u.role = 'user' AND ${scope.sql}) AS user_count
             FROM prize_sets ps WHERE ${owner.sql} ORDER BY ps.id`, [...scope.args, ...owner.args]),
    ratesBySet(),
  ]);
  for (const set of sets) {
    set.rates = rates.get(set.id) ?? [];
    set.can_manage = managesSet(req.user, set);
  }
  res.json(sets);
});

router.post('/', requireRole('admin', 'master'), async (req, res) => {
  const { name, copy_from, twod_multiplier } = z
    .object({
      name: z.string().trim().min(1).max(50),
      copy_from: z.number().int().min(0).optional(),
      twod_multiplier: z.number().int().min(0).optional(),
    })
    .parse(req.body);
  const masterId = req.user.role === 'master' ? req.user.id : null;
  if (await one(db, 'SELECT 1 FROM prize_sets WHERE name = ? AND IFNULL(master_id, 0) = IFNULL(?, 0)', [name, masterId])) {
    throw badRequest('Name already exists');
  }

  const source = copy_from !== undefined ? await loadSet(copy_from) : null;
  if (source && !managesSet(req.user, source) && source.master_id != null && Number(source.master_id) !== Number(req.user.id)) {
    throw notFound('Prize set not found');
  }
  const set = await one(db, 'INSERT INTO prize_sets (name, twod_multiplier, master_id) VALUES (?, ?, ?) RETURNING *',
    [name, twod_multiplier ?? source?.twod_multiplier ?? 10, masterId]);
  set.can_manage = true;
  if (copy_from !== undefined) {
    await db.execute({
      sql: `INSERT INTO prize_rates (prize_set_id, bet_type_id, side, multiplier, discount)
            SELECT ?, bet_type_id, side, multiplier, discount FROM prize_rates WHERE prize_set_id = ?`,
      args: [set.id, copy_from],
    });
  }
  res.status(201).json(set);
});

router.patch('/:id', requireRole('admin', 'master'), async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(50).optional(), twod_multiplier: z.number().int().min(0).optional() })
    .parse(req.body);
  const setId = Number(req.params.id);
  const existing = await loadSet(setId);
  if (!managesSet(req.user, existing)) throw forbidden('This prize set belongs to another account');
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (!fields.length) throw badRequest('Nothing to update');
  res.json(await one(
    db,
    `UPDATE prize_sets SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`,
    [...fields.map(([, v]) => v), setId]
  ));
});

// Sets the odds of the given bet types in a set (others, e.g. inactive types, are kept).
// discount -1 = use each user's own discount.
router.put('/:id/rates', requireRole('admin', 'master'), async (req, res) => {
  const setId = z.coerce.number().int().min(0).parse(req.params.id);
  const existing = await loadSet(setId);
  if (!managesSet(req.user, existing)) throw forbidden('This prize set belongs to another account');
  const rows = z
    .array(z.object({
      bet_type_id: z.number().int().min(0),
      multiplier: z.number().int().min(0),
      discount: z.number().min(-1).max(100),
    }))
    .parse(req.body);

  await db.batch(
    [
      ...rows.map((r) => ({
        sql: `INSERT OR REPLACE INTO prize_rates (prize_set_id, bet_type_id, side, multiplier, discount) VALUES (?, ?, 'sale', ?, ?)`,
        args: [setId, r.bet_type_id, r.multiplier, r.discount],
      })),
      {
        sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'prize_set.rates', ?)`,
        args: [req.user.id, JSON.stringify({ setId, rows })],
      },
    ],
    'write'
  );
  res.json(rows);
});

router.delete('/:id', requireRole('admin', 'master'), async (req, res) => {
  const setId = z.coerce.number().int().positive().parse(req.params.id); // set 0 (Default) cannot be deleted
  const existing = await loadSet(setId);
  if (!managesSet(req.user, existing)) throw forbidden('This prize set belongs to another account');
  if (await one(db, 'SELECT 1 FROM users WHERE prize_set_id = ? LIMIT 1', [setId])) {
    throw badRequest('Prize set is still assigned to accounts');
  }
  await db.batch(
    [
      { sql: 'DELETE FROM prize_rates WHERE prize_set_id = ?', args: [setId] },
      { sql: 'DELETE FROM prize_sets WHERE id = ?', args: [setId] },
    ],
    'write'
  );
  res.json({ ok: true });
});

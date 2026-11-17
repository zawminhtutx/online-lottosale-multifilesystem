import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { all, db, likeContains, one } from '../db.js';
import { PUBLIC_USER_COLUMNS, ROLES, UPLINE_ROLES, USER_LIST_COLUMNS, canAccess, isAbove, loadAccessibleUser, loadViewableUser, readScope, requireRole, userScope } from '../auth.js';
import { badRequest, forbidden } from '../errors.js';
import { assertPrizeSetUsable } from './prizes.js';

export const router = Router();

const id = z.coerce.number().int().positive();

router.get('/', requireRole(...UPLINE_ROLES), async (req, res) => {
  const q = z
    .object({ role: z.enum(ROLES).optional(), parent_id: id.optional(), search: z.string().trim().max(50).optional() })
    .parse(req.query);
  const scope = readScope(req.user, 'id');
  const where = [scope.sql];
  const args = [...scope.args];
  if (q.role) { where.push('role = ?'); args.push(q.role); }
  if (q.parent_id) { where.push('parent_id = ?'); args.push(q.parent_id); }
  if (q.search) {
    const needle = likeContains(q.search);
    where.push('(username LIKE ? ESCAPE \'!\' OR name LIKE ? ESCAPE \'!\' OR phone LIKE ? ESCAPE \'!\')');
    args.push(needle, needle, needle);
  }
  res.json(
    await all(
      db,
      `SELECT ${USER_LIST_COLUMNS},
              (SELECT p.username FROM users p WHERE p.id = users.parent_id) AS parent_username,
              (SELECT COUNT(*) FROM users c WHERE c.parent_id = users.id) AS child_count
       FROM users WHERE ${where.join(' AND ')} ORDER BY role, username`,
      args
    )
  );
});

// ကော်မရှင် (commission %, discount 1) is handed down one step at a time: the admin sets it for its
// masters, a master for its own agents and users, an agent for its users. Each level passes on what
// it was given, so no level reaches past the one below it.
const COMMISSION_ROLES = { admin: ['master'], master: ['agent', 'user'], agent: ['user'] };

// The accounts whose commission the caller sets: itself excluded, its own downline only.
const commissionScope = (actor) => {
  const roles = COMMISSION_ROLES[actor.role] ?? [];
  const scope = userScope(actor, 'u.id');
  return {
    roles,
    sql: `u.id <> ? AND u.role IN (${roles.map(() => '?').join(', ') || "''"}) AND ${scope.sql}`,
    args: [actor.id, ...roles, ...scope.args],
  };
};

// Commission page (ကော်မရှင်): every account the caller may set, with its commission % per bet type.
router.get('/commissions', requireRole(...UPLINE_ROLES), async (req, res) => {
  const scope = commissionScope(req.user);
  const users = await all(
    db,
    `SELECT u.id, u.username, u.name, u.name_mm, u.role, u.status, u.parent_id,
            (SELECT p.username FROM users p WHERE p.id = u.parent_id) AS parent_username
     FROM users u WHERE ${scope.sql}
     ORDER BY CASE u.role WHEN 'master' THEN 0 WHEN 'agent' THEN 1 ELSE 2 END, parent_username, u.username`,
    scope.args
  );
  const rows = await all(
    db,
    `SELECT d.user_id, d.bet_type_id, d.discount FROM user_discounts d JOIN users u ON u.id = d.user_id
     WHERE ${scope.sql}`,
    scope.args
  );
  const byUser = new Map(users.map((u) => [u.id, (u.discounts = {})]));
  for (const r of rows) if (byUser.has(r.user_id)) byUser.get(r.user_id)[r.bet_type_id] = r.discount;
  res.json(users);
});

// Sets commission % (discount 1) for many accounts at once; discount 2 / 3 are kept as they are.
router.put('/commissions', requireRole(...UPLINE_ROLES), async (req, res) => {
  const rows = z
    .array(z.object({ user_id: id, bet_type_id: z.number().int(), discount: z.number().min(0).max(100) }))
    .max(20000)
    .parse(req.body);
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length) {
    const scope = commissionScope(req.user);
    const ok = await all(
      db,
      `SELECT u.id FROM users u WHERE u.id IN (SELECT value FROM json_each(?)) AND ${scope.sql}`,
      [JSON.stringify(ids), ...scope.args]
    );
    if (ok.length !== ids.length) {
      throw badRequest(`Commission can only be set for ${scope.roles.join(' / ')} accounts in your own downline`);
    }
    await db.batch(
      rows.map((r) => ({
        sql: `INSERT INTO user_discounts (user_id, bet_type_id, discount) VALUES (?, ?, ?)
              ON CONFLICT(user_id, bet_type_id) DO UPDATE SET discount = excluded.discount`,
        args: [r.user_id, r.bet_type_id, r.discount],
      })),
      'write'
    );
  }
  res.json({ updated: rows.length });
});

const emailField = z.string().trim().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is not valid');
const createSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(6),
  role: z.enum(ROLES),
  parent_id: id.optional(),
  name: z.string().trim().min(1).max(50),
  name_mm: z.string().max(50).optional(),
  phone: z.string().max(30).optional(),
  phone2: z.string().max(50).optional(),
  address: z.string().max(255).optional(),
  email: z.union([emailField, z.literal('')]).optional(),
  master_name: z.string().trim().max(80).optional(),
  logo: z.string().max(500_000).optional(),
  ledger_mail: z.boolean().optional(),
  prize_set_id: z.number().int().min(0).optional(),
  unlimited: z.boolean().optional(), // any account below the admin: bet / hand out money on credit
});

// Which role an account's upline may have at all: a master belongs to the admin, an agent to a
// master or (from before the rule below) straight to the admin, a user to an agent, a master or the
// admin. Role change (PUT /:id/role, the admin's repair tool) goes by this, so accounts opened
// before CREATE_PARENT_ROLES came in keep working.
const PARENT_ROLES = { master: ['admin'], agent: ['admin', 'master'], user: ['admin', 'master', 'agent'] };

// Opening a NEW account, whoever opens it: a master belongs to the admin, an agent always goes into
// a master's tree, a user into a master's or an agent's — never straight under the admin.
const CREATE_PARENT_ROLES = { master: ['admin'], agent: ['master'], user: ['master', 'agent'] };

// The new account hangs under its creator when none is named, which only works where the creator
// may be that role's upline (an agent's own user, a master's own agent). The admin is no upline for
// an agent or a user, so it names the master / agent to put it in.
const uplineHint = (role) => `${role === 'agent' ? 'Agent' : 'User'} ကို ဖွင့်ရာတွင် ဘယ် ${CREATE_PARENT_ROLES[role].map((r) => (r === 'master' ? 'Master' : 'Agent')).join(' / ')} အောက်ထားမည်ကို ရွေးပါ — Admin အောက် တိုက်ရိုက် မထားနိုင်ပါ`;

// An account creates roles below its own: the admin every role under it (and further admins), a
// master agents and users, an agent users. parent_id names the account in the creator's own
// downline the new one hangs under; left out, it hangs under its creator, which the admin cannot do
// for an agent or a user (see PARENT_ROLES).
router.post('/', requireRole(...UPLINE_ROLES), async (req, res) => {
  const body = createSchema.parse(req.body);
  if (req.user.role !== 'admin' && !isAbove(req.user.role, body.role)) {
    throw forbidden(`${req.user.role} accounts cannot create ${body.role} accounts`);
  }
  if (!body.parent_id && CREATE_PARENT_ROLES[body.role] && !CREATE_PARENT_ROLES[body.role].includes(req.user.role)) {
    throw badRequest(uplineHint(body.role));
  }
  let parentId = req.user.id;
  // Prize sets belong to bettors (users) only. Masters / agents do not carry one.
  let prizeSetId = 0;

  if (body.parent_id && body.parent_id !== req.user.id) {
    const parent = await loadAccessibleUser(db, req.user, body.parent_id);
    if (!CREATE_PARENT_ROLES[body.role]?.includes(parent.role)) {
      throw badRequest(`A ${body.role} must belong to ${CREATE_PARENT_ROLES[body.role]?.join(' or ') ?? 'nobody'}`);
    }
    parentId = parent.id;
  }
  if (body.role === 'admin') parentId = null;
  if (body.role === 'user') {
    prizeSetId = body.prize_set_id ?? 0;
    await assertPrizeSetUsable(req.user, prizeSetId);
  }

  if (await one(db, 'SELECT 1 FROM users WHERE username = ?', [body.username])) {
    throw badRequest('Username already exists');
  }
  if (body.logo && !/^data:image\/|https?:\/\//.test(body.logo)) throw badRequest('Logo must be an image');
  const masterName = body.role === 'master' ? body.master_name || null : null;
  const logo = body.role === 'master' ? body.logo || null : null;
  const ledgerMail = ['agent', 'user'].includes(body.role) && body.ledger_mail ? 1 : 0;

  const user = await one(
    db,
    `INSERT INTO users (username, password_hash, role, parent_id, name, name_mm, phone, phone2, address, email, master_name, logo, ledger_mail, prize_set_id, unlimited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${PUBLIC_USER_COLUMNS}`,
    [
      body.username, await bcrypt.hash(body.password, 10), body.role, parentId, body.name,
      body.name_mm ?? null, body.phone ?? null, body.phone2 ?? null, body.address ?? null,
      body.email || null, masterName, logo, ledgerMail, prizeSetId,
      body.unlimited && body.role !== 'admin' ? 1 : 0,
    ]
  );
  res.status(201).json(user);
});

// One account. The caller must be in its own tree, unless the caller is the admin.
router.get('/:id', async (req, res) => {
  const user = await loadViewableUser(db, req.user, id.parse(req.params.id));
  user.discounts = await all(db, 'SELECT bet_type_id, discount, discount2, discount3 FROM user_discounts WHERE user_id = ?', [user.id]);
  user.can_manage = await canAccess(db, req.user, user);
  res.json(user);
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  name_mm: z.string().max(50).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  phone2: z.string().max(50).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  email: z.union([emailField, z.literal('')]).nullable().optional(),
  master_name: z.string().trim().max(80).nullable().optional(),
  logo: z.string().max(500_000).nullable().optional(),
  ledger_mail: z.boolean().optional(),
  status: z.enum(['active', 'suspended', 'closed']).optional(),
  prize_set_id: z.number().int().min(0).optional(),
  unlimited: z.boolean().optional(),
  ledger_access: z.boolean().optional(), // admin only, masters: Live Ledger of every tree, not just their own
  sale_over: z.boolean().optional(), // admin only: master / agent may save over the unit break on Sale
  hot_edit: z.boolean().optional(), // admin only: a master may add / edit term hot numbers
  // Admins / agents: KPay / WavePay accounts their users send money to.
  kpay_no: z.string().trim().max(30).nullable().optional(),
  kpay_name: z.string().trim().max(50).nullable().optional(),
  wave_no: z.string().trim().max(30).nullable().optional(),
  wave_name: z.string().trim().max(50).nullable().optional(),
  password: z.string().min(6).optional(),
});

router.patch('/:id', requireRole(...UPLINE_ROLES), async (req, res) => {
  const target = await loadAccessibleUser(db, req.user, id.parse(req.params.id));
  const body = updateSchema.parse(req.body);
  if (target.id === req.user.id && (body.status || body.prize_set_id !== undefined)) {
    throw forbidden('You cannot change your own status or prize set');
  }
  // Prize sets are for users (bettors) only. Admin / master / agent pick one of the admin's sets.
  if (body.prize_set_id !== undefined) {
    if (target.role !== 'user') throw badRequest('Prize sets are for user accounts');
    if (!isAbove(req.user.role, target.role)) throw forbidden('You can only change the prize set of accounts below you');
    await assertPrizeSetUsable(req.user, body.prize_set_id);
  }
  if (body.unlimited !== undefined) {
    if (target.id === req.user.id) throw forbidden('You cannot change your own unlimited setting');
    if (target.role === 'admin') throw badRequest('Admins do not use unlimited wallets');
    if (!body.unlimited && target.balance < 0) throw badRequest('Settle the negative balance before turning unlimited off');
    body.unlimited = body.unlimited ? 1 : 0;
  }

  if (body.ledger_access !== undefined) {
    if (req.user.role !== 'admin') throw forbidden('Only the admin can allow viewing every ledger');
    if (target.role !== 'master') throw badRequest('Whole-ledger access is for master accounts');
    body.ledger_access = body.ledger_access ? 1 : 0;
  }

  if (body.sale_over !== undefined) {
    if (req.user.role !== 'admin') throw forbidden('Only the admin can allow saving over the unit break');
    if (!['master', 'agent'].includes(target.role)) throw badRequest('Over-break save is for master and agent accounts');
    body.sale_over = body.sale_over ? 1 : 0;
  }

  if (body.hot_edit !== undefined) {
    if (req.user.role !== 'admin') throw forbidden('Only the admin can allow editing hot numbers');
    if (target.role !== 'master') throw badRequest('Hot number edit is for master accounts');
    body.hot_edit = body.hot_edit ? 1 : 0;
  }

  if (body.email !== undefined) body.email = body.email || null;
  if (body.master_name !== undefined || body.logo !== undefined) {
    if (target.role !== 'master') throw badRequest('Logo and master name are for master accounts');
    if (body.master_name === '') body.master_name = null;
    if (body.logo === '') body.logo = null;
    if (body.logo && !/^data:image\/|https?:\/\//.test(body.logo)) throw badRequest('Logo must be an image');
  }
  if (body.ledger_mail !== undefined) {
    if (!['agent', 'user'].includes(target.role)) throw badRequest('Ledger email is for agent and user accounts');
    if (target.id === req.user.id) throw forbidden('You cannot change your own ledger email');
    if (!isAbove(req.user.role, target.role)) throw forbidden('You can only choose ledger email for accounts below you');
    body.ledger_mail = body.ledger_mail ? 1 : 0;
  }

  const payKeys = ['kpay_no', 'kpay_name', 'wave_no', 'wave_name'];
  if (payKeys.some((k) => body[k] !== undefined)) {
    if (target.role === 'user') throw badRequest('KPay / WavePay numbers are for admin, master and agent accounts');
    for (const k of payKeys) if (body[k] === '') body[k] = null;
  }

  const sets = [];
  const args = [];
  for (const key of ['name', 'name_mm', 'phone', 'phone2', 'address', 'email', 'master_name', 'logo', 'ledger_mail', 'status', 'prize_set_id', 'unlimited', 'ledger_access', 'sale_over', 'hot_edit', ...payKeys]) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); args.push(body[key]); }
  }
  if (body.password) { sets.push('password_hash = ?'); args.push(await bcrypt.hash(body.password, 10)); }
  if (!sets.length) throw badRequest('Nothing to update');

  const user = await one(
    db,
    `UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? RETURNING ${PUBLIC_USER_COLUMNS}`,
    [...args, target.id]
  );
  res.json(user);
});

// Change an account's role (admin only) — e.g. an old view-only admin turned into a user. The
// account keeps its id, username, password and history. Body: { role, parent_id? }: parent_id is the
// account to hang it under (by default its current upline when that still fits the new role, else
// the admin). Refused when the change would leave the tree or the ledger wrong:
// - a user with slips stays a user (slips belong to user accounts);
// - accounts under it must still fit under the new role (move them first otherwise);
// - an admin has no wallet, so an account becomes an admin only with a zero balance.
router.put('/:id/role', requireRole('admin'), async (req, res) => {
  const target = await loadAccessibleUser(db, req.user, id.parse(req.params.id));
  if (target.id === req.user.id) throw forbidden('You cannot change your own role');
  const body = z.object({ role: z.enum(ROLES), parent_id: id.nullable().optional() }).parse(req.body);
  if (body.role === target.role && body.parent_id === undefined) throw badRequest('Nothing to update');

  if (target.role === 'user' && body.role !== 'user'
      && await one(db, 'SELECT 1 FROM tickets WHERE user_id = ? LIMIT 1', [target.id])) {
    throw badRequest('This user has slips, so it must stay a user');
  }
  const children = await all(db, 'SELECT DISTINCT role FROM users WHERE parent_id = ?', [target.id]);
  const misfit = children.find((c) => !PARENT_ROLES[c.role]?.includes(body.role));
  if (misfit) throw badRequest(`Move the ${misfit.role} accounts under it first: a ${misfit.role} cannot belong to a ${body.role}`);

  let parentId = null;
  if (body.role === 'admin') {
    if (target.balance !== 0) throw badRequest('Bring the balance to 0 first: admin accounts have no wallet');
  } else {
    const wanted = body.parent_id ?? (target.parent_id && target.parent_id !== target.id ? target.parent_id : null);
    const parent = wanted ? await one(db, 'SELECT id, role FROM users WHERE id = ?', [wanted]) : null;
    if (body.parent_id && !parent) throw badRequest('Upline account not found');
    if (parent && PARENT_ROLES[body.role].includes(parent.role)) parentId = parent.id;
    else if (body.parent_id) throw badRequest(`A ${body.role} must belong to ${PARENT_ROLES[body.role].join(' or ')}`);
    else parentId = req.user.id; // no fitting upline: straight under the admin
    if (parentId === target.id) throw badRequest('An account cannot belong to itself');
    // The upline must not sit inside this account's own downline (that would make a loop).
    if (await one(db, `WITH RECURSIVE sub(id) AS (SELECT id FROM users WHERE parent_id = ?
                        UNION ALL SELECT u.id FROM users u JOIN sub s ON u.parent_id = s.id)
                       SELECT 1 FROM sub WHERE id = ?`, [target.id, parentId])) {
      throw badRequest('That upline is inside this account\'s own downline');
    }
  }

  const user = await one(
    db,
    `UPDATE users SET role = ?, parent_id = ?,
            unlimited = CASE WHEN ? = 'admin' THEN 0 ELSE unlimited END,
            ledger_access = CASE WHEN ? = 'master' THEN ledger_access ELSE 0 END,
            sale_over = CASE WHEN ? IN ('master', 'agent') THEN sale_over ELSE 0 END,
            hot_edit = CASE WHEN ? = 'master' THEN hot_edit ELSE 0 END,
            updated_at = datetime('now')
     WHERE id = ? RETURNING ${PUBLIC_USER_COLUMNS}`,
    [body.role, parentId, body.role, body.role, body.role, body.role, target.id]
  );
  await db.execute({
    sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'user.role', ?)`,
    args: [req.user.id, JSON.stringify({ id: target.id, from: target.role, to: body.role, parent_id: parentId })],
  });
  res.json(user);
});

// DISCOUNTS: commission % per bet type for one account. Same one-step rule as the ကော်မရှင် page:
// the admin sets a master's, a master its agents' and users', an agent its users'.
router.put('/:id/discounts', requireRole(...UPLINE_ROLES), async (req, res) => {
  const target = await loadAccessibleUser(db, req.user, id.parse(req.params.id));
  if (target.id === req.user.id) throw forbidden('You cannot set your own discounts');
  const allowed = COMMISSION_ROLES[req.user.role] ?? [];
  if (!allowed.includes(target.role)) {
    throw forbidden(`${req.user.role} accounts set the commission of ${allowed.join(' / ')} accounts only`);
  }
  const pct = z.number().min(0).max(100);
  const rows = z
    .array(z.object({ bet_type_id: z.number().int(), discount: pct, discount2: pct.default(0), discount3: pct.default(0) }))
    .parse(req.body);

  await db.batch(
    [
      { sql: 'DELETE FROM user_discounts WHERE user_id = ?', args: [target.id] },
      ...rows.map((r) => ({
        sql: 'INSERT INTO user_discounts (user_id, bet_type_id, discount, discount2, discount3) VALUES (?, ?, ?, ?, ?)',
        args: [target.id, r.bet_type_id, r.discount, r.discount2, r.discount3],
      })),
    ],
    'write'
  );
  res.json(await all(db, 'SELECT bet_type_id, discount, discount2, discount3 FROM user_discounts WHERE user_id = ?', [target.id]));
});


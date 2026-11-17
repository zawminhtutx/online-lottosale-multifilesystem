import { Router } from 'express';
import { z } from 'zod';
import { all, db, one } from '../db.js';
import { UPLINE_ROLES, canAccess, canView, loadAccessibleUser, readScope, requireRole, userScope } from '../auth.js';
import { notFound } from '../errors.js';
import { cancelTicket, editTicketItems, getTicket, nextSlipNo, placeTicket } from '../services/tickets.js';
import { broadcast } from '../live.js';

export const router = Router();

const id = z.coerce.number().int().positive();

const ticketSchema = z.object({
  term_id: z.number().int().positive(),
  user_id: z.number().int().positive().optional(), // an upline entering a slip for one of its users
  dry_run: z.boolean().optional(),
  // Skip the unit-break cap (ကျွံ). Admin always; master/agent only when users.sale_over is on.
  save_over: z.boolean().optional(),
  entries: z
    .array(z.object({
      bet_type_id: z.number().int().min(0),
      // As typed, e.g. "12", "45R", or a POS pattern such as "1P", "SS", "12*" (kept as the group label).
      input: z.string().trim().min(1).max(12).regex(/^[0-9A-Za-z*]+$/),
      // Optional explicit expansion of a pattern the server does not parse itself (POS client
      // patterns). Every number is still validated against the bet type.
      numbers: z.array(z.string().regex(/^\d{1,3}$/)).min(1).max(1000).optional(),
      units: z.number().int().positive(),
    }))
    .min(1),
});

router.post('/', async (req, res) => {
  const body = ticketSchema.parse(req.body);
  const ticket = await placeTicket(req.user, body, req.ip);
  res.status(body.dry_run ? 200 : 201).json(ticket);
  if (!body.dry_run) broadcast('tickets', { term_id: body.term_id }); // Live Ledger

});

router.get('/', async (req, res) => {
  const q = z
    .object({
      term_id: id.optional(),
      user_id: id.optional(),
      agent_id: id.optional(), // every slip of the users under one agent (tickets.agent_id snapshot)
      status: z.enum(['active', 'cancelled', 'won', 'lost']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .parse(req.query);
  const scope = readScope(req.user, 't.user_id');
  // can_manage: 1 when the slip is in the caller's own tree (it may cancel / edit it).
  const own = userScope(req.user, 't.user_id');
  const where = [scope.sql];
  const args = [...scope.args];
  for (const key of ['term_id', 'user_id', 'agent_id', 'status']) {
    if (q[key] !== undefined) { where.push(`t.${key} = ?`); args.push(q[key]); }
  }
  res.json(
    await all(
      db,
      // folder_id / folder_name: the term's ဖိုင် (the user app filters slips by folder, then term).
      `SELECT t.*, u.username, u.name AS user_name, tm.description AS term_description, tm.game, tm.unit_price,
              tm.folder_id, f.name AS folder_name,
              (SELECT COALESCE(SUM(units), 0) FROM ticket_items WHERE ticket_id = t.id) AS total_units,
              (SELECT status FROM slip_cancel_requests WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS cancel_request,
              CASE WHEN ${own.sql} THEN 1 ELSE 0 END AS can_manage
       FROM tickets t JOIN users u ON u.id = t.user_id JOIN terms tm ON tm.id = t.term_id
       LEFT JOIN term_folders f ON f.id = tm.folder_id
       WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ?`,
      [...own.args, ...args, q.limit]
    )
  );
});

// The number the user's next slip in this term will get (their own sequence, see nextSlipNo).
// Agents/admins may ask for a user they can access; the prefix follows who is signed in.
router.get('/next-slip', async (req, res) => {
  const q = z.object({ term_id: id, user_id: id.optional() }).parse(req.query);
  const user = await loadAccessibleUser(db, req.user, q.user_id ?? req.user.id);
  res.json({ slip_no: await nextSlipNo(db, q.term_id, user, req.user) });
});

// Slip edit / delete log, newest first: a user sees changes to their own slips, an agent their
// users', a master its whole downline's, the admin everyone's (optionally one term or user).
router.get('/edit-logs', async (req, res) => {
  const q = z
    .object({ term_id: id.optional(), user_id: id.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) })
    .parse(req.query);
  const scope = readScope(req.user, 'l.user_id');
  const where = [scope.sql];
  const args = [...scope.args];
  for (const key of ['term_id', 'user_id']) {
    if (q[key] !== undefined) { where.push(`l.${key} = ?`); args.push(q[key]); }
  }
  const rows = await all(
    db,
    `SELECT l.*, tm.description AS term_description, u.username, u.name AS user_name, c.username AS created_by_username
     FROM slip_edit_logs l JOIN terms tm ON tm.id = l.term_id JOIN users u ON u.id = l.user_id
     JOIN users c ON c.id = l.created_by
     WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ?`,
    [...args, q.limit]
  );
  res.json(rows.map((r) => ({ ...r, lines: r.lines ? JSON.parse(r.lines) : [] })));
});

router.get('/:id', async (req, res) => {
  const ticket = await getTicket(db, id.parse(req.params.id));
  if (!ticket || !(await canView(db, req.user, { id: ticket.user_id }))) throw notFound('Ticket not found');
  ticket.can_manage = await canAccess(db, req.user, { id: ticket.user_id });
  res.json(ticket);
});

router.post('/:id/cancel', async (req, res) => {
  const ticket = await cancelTicket(req.user, id.parse(req.params.id));
  res.json(ticket);
  broadcast('tickets', { term_id: ticket.term_id });
});

// Admin, or the master above the slip's owner: lower lines' units (0 removes the line) on an
// active slip before results; the difference is refunded. Body: { items: [{ id, units }] } with
// ticket_items ids.
router.patch('/:id/items', requireRole('admin', 'master'), async (req, res) => {
  const { items } = z
    .object({ items: z.array(z.object({ id: id, units: z.number().int().min(0) })).min(1) })
    .parse(req.body);
  const ticket = await editTicketItems(req.user, id.parse(req.params.id), items);
  res.json(ticket);
  broadcast('tickets', { term_id: ticket.term_id });
});

// Counts a printout of the slip (shown as "Copy (n)" on paper, like the POS app's SLIPCOPY).
router.post('/:id/print', async (req, res) => {
  const ticketId = id.parse(req.params.id);
  const ticket = await one(db, 'SELECT id, user_id FROM tickets WHERE id = ?', [ticketId]);
  if (!ticket || !(await canAccess(db, req.user, { id: ticket.user_id }))) throw notFound('Ticket not found');
  res.json(await one(db, 'UPDATE tickets SET print_count = print_count + 1 WHERE id = ? RETURNING id, print_count', [ticketId]));
});

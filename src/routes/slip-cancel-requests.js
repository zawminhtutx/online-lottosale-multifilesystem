// Slip delete requests (စလစ်ဖျက်ရန် request). A user cannot delete their own slip: they ask here, and
// the slip is only cancelled — and refunded — when an upline (admin, the master, or the agent
// above that user) approves. Until then, or if it is rejected, the slip stays valid and is settled
// and paid like any other.
import { Router } from 'express';
import { z } from 'zod';
import { all, db, one } from '../db.js';
import { UPLINE_ROLES, canAccess, requireRole, userScope } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { cancelTicket } from '../services/tickets.js';
import { broadcast } from '../live.js';

export const router = Router();

const id = z.coerce.number().int().positive();

const listSql = `SELECT r.*, t.slip_no, t.net_amount, t.gross_amount, t.status AS ticket_status, t.created_at AS ticket_created_at,
    tm.id AS term_id, tm.description AS term_description, tm.status AS term_status,
    u.username, u.name AS user_name, d.username AS decided_by_username
  FROM slip_cancel_requests r
  JOIN tickets t ON t.id = r.ticket_id
  JOIN terms tm ON tm.id = t.term_id
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users d ON d.id = r.decided_by`;

async function loadRequest(requestId) {
  const row = await one(db, `${listSql} WHERE r.id = ?`, [requestId]);
  if (!row) throw notFound('Request not found');
  return row;
}

const changed = () => { broadcast('slip-cancel-requests'); broadcast('tickets'); };

// Admin: every request. Master / agent: their own downline's. A user: their own.
router.get('/', requireRole('admin', 'master', 'agent', 'user'), async (req, res) => {
  const q = z
    .object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    })
    .parse(req.query);
  const scope = userScope(req.user, 'r.user_id');
  const where = [scope.sql];
  const args = [...scope.args];
  if (q.status) { where.push('r.status = ?'); args.push(q.status); }
  res.json(await all(db, `${listSql} WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ?`, [...args, q.limit]));
});

router.get('/pending-count', requireRole(...UPLINE_ROLES), async (req, res) => {
  const scope = userScope(req.user, 'user_id');
  res.json(await one(db, `SELECT COUNT(*) AS count FROM slip_cancel_requests WHERE status = 'pending' AND ${scope.sql}`, scope.args));
});

// A user asks to delete one of their own active slips (once at a time; again after a rejection).
router.post('/', requireRole('user'), async (req, res) => {
  const { ticket_id: ticketId } = z.object({ ticket_id: z.number().int().positive() }).parse(req.body);
  const ticket = await one(
    db,
    `SELECT t.id, t.user_id, t.status, tm.status AS term_status
     FROM tickets t JOIN terms tm ON tm.id = t.term_id WHERE t.id = ?`,
    [ticketId]
  );
  if (!ticket || ticket.user_id !== req.user.id) throw notFound('Ticket not found');
  if (ticket.status !== 'active') throw badRequest(`Ticket is already ${ticket.status}`);
  if (!['open', 'closed'].includes(ticket.term_status)) throw badRequest('Term already has results');
  if (await one(db, `SELECT 1 FROM slip_cancel_requests WHERE ticket_id = ? AND status = 'pending'`, [ticket.id])) {
    throw badRequest('A delete request for this slip is already waiting');
  }
  const row = await one(
    db,
    'INSERT INTO slip_cancel_requests (ticket_id, user_id) VALUES (?, ?) RETURNING id',
    [ticket.id, req.user.id]
  );
  changed();
  res.status(201).json(await loadRequest(row.id));
});

// Approve: the slip is cancelled and its net amount refunded (same as cancelling it directly).
router.post('/:id/approve', requireRole(...UPLINE_ROLES), async (req, res) => {
  const request = await loadRequest(id.parse(req.params.id));
  if (!(await canAccess(db, req.user, { id: request.user_id }))) throw notFound('Request not found');
  if (request.status !== 'pending') throw badRequest(`Request is already ${request.status}`);
  await cancelTicket(req.user, request.ticket_id, { fromDeleteRequest: true }); // refuses once the term has results
  await db.execute({
    sql: `UPDATE slip_cancel_requests SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
    args: [req.user.id, request.id],
  });
  changed();
  res.json(await loadRequest(request.id));
});

// Reject: the slip stays valid.
router.post('/:id/reject', requireRole(...UPLINE_ROLES), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(255).optional() }).parse(req.body ?? {});
  const request = await loadRequest(id.parse(req.params.id));
  if (!(await canAccess(db, req.user, { id: request.user_id }))) throw notFound('Request not found');
  if (request.status !== 'pending') throw badRequest(`Request is already ${request.status}`);
  await db.execute({
    sql: `UPDATE slip_cancel_requests SET status = 'rejected', reject_reason = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    args: [reason || null, req.user.id, request.id],
  });
  changed();
  res.json(await loadRequest(request.id));
});

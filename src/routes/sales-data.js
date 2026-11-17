// Backups before deleting sales records (admin):
//   "All delete" — wipe every term, folder and slip; and deleting one term (DELETE /api/terms/:id).
// Both need an Excel backup made first (the apps also print a PDF summary before allowing it).
// Folder delete can use the same Excel/PDF of that ဖိုင်, or skip backup.
//
//   GET    /summary[?term_id=|&folder_id=]      per-term totals (shown, and printed as the PDF)
//   GET    /export.xlsx[?term_id=|&folder_id=]  Excel backup — Folders, Terms, Slips, Slip details
//                                               of everything, one term, or one folder. Issues the
//                                               export token a term / All delete needs (X-Export-Token).
//   DELETE /                                    { export_token, confirm: "DELETE" } — All delete
//
// A token is good for one delete, for an hour, and only while no slip was placed since the export
// (in that term, for a one-term export). A folder-scoped export does not unlock All delete.
// Accounts, balances and wallet history stay; slips not yet settled are refunded first.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { all, db, one, withTransaction } from '../db.js';
import { requireRole } from '../auth.js';
import { assertManagesFolder, assertManagesTerm } from '../books.js';
import { badRequest, forbidden } from '../errors.js';
import { applyBalance } from '../services/wallet.js';
import { broadcast } from '../live.js';

export const router = Router();
router.use((req, res, next) => (req.method === 'DELETE' ? requireRole('admin') : requireRole('admin', 'master'))(req, res, next));

async function assertExportScope(actor, termId, folderId) {
  if (actor.role === 'admin') return;
  if (!termId && !folderId) throw forbidden('The full backup is for the admin');
  if (folderId) await assertManagesFolder(db, actor, folderId);
  if (termId) {
    const term = await one(db, 'SELECT * FROM terms WHERE id = ?', [termId]);
    if (!term) throw badRequest('Term not found');
    await assertManagesTerm(db, actor, term);
  }
}

const EXPORT_KEY = 'sales_export';
const EXPORT_TTL_MS = 60 * 60 * 1000;
const scopeQuery = z.object({
  term_id: z.coerce.number().int().positive().optional(),
  folder_id: z.coerce.number().int().positive().optional(),
}).refine((v) => v.term_id === undefined || v.folder_id === undefined, { message: 'term_id or folder_id, not both' });

function parseScope(query) {
  const q = scopeQuery.parse(query);
  return { termId: q.term_id, folderId: q.folder_id };
}

function tmWhere(termId, folderId) {
  if (termId) return { sql: 'WHERE tm.id = ?', args: [termId] };
  if (folderId) return { sql: 'WHERE tm.folder_id = ?', args: [folderId] };
  return { sql: '', args: [] };
}

function ticketWhere(termId, folderId) {
  if (termId) return { sql: 'WHERE term_id = ?', args: [termId] };
  if (folderId) return { sql: 'WHERE term_id IN (SELECT id FROM terms WHERE folder_id = ?)', args: [folderId] };
  return { sql: '', args: [] };
}

const summaryRows = (client, termId, folderId) => {
  const w = tmWhere(termId, folderId);
  return all(
    client,
    `SELECT tm.id, tm.description, tm.game, tm.status, tm.unit_price, tm.close_at, tm.draw_at,
            f.name AS folder,
            (SELECT GROUP_CONCAT(value, ' / ') FROM term_results r WHERE r.term_id = tm.id) AS result,
            COUNT(t.id) AS slips,
            COALESCE(SUM(t.gross_amount), 0) AS gross,
            COALESCE(SUM(t.discount_amount), 0) AS discount,
            COALESCE(SUM(t.net_amount), 0) AS net,
            COALESCE(SUM(t.win_amount), 0) AS payout
     FROM terms tm
     LEFT JOIN term_folders f ON f.id = tm.folder_id
     LEFT JOIN tickets t ON t.term_id = tm.id AND t.status <> 'cancelled'
     ${w.sql}
     GROUP BY tm.id ORDER BY tm.id`,
    w.args
  );
};

// Highest slip id in scope: a slip placed after the export makes the backup stale.
const maxTicketId = async (client, termId, folderId) => {
  const w = ticketWhere(termId, folderId);
  return (await one(client, `SELECT COALESCE(MAX(id), 0) AS id FROM tickets ${w.sql}`, w.args)).id;
};

// Checks and uses up an export token for a delete of everything (termId null) or of one term.
// A folder-scoped Excel export does not unlock All delete or a one-term delete.
export async function consumeExport(tx, token, termId = null) {
  const saved = await one(tx, 'SELECT value FROM settings WHERE key = ?', [EXPORT_KEY]);
  const exp = saved?.value ? JSON.parse(saved.value) : null;
  if (!exp || !token || exp.token !== token || (exp.term_id ?? null) !== termId || (exp.folder_id ?? null) != null) {
    throw badRequest('Download the Excel backup first');
  }
  if (Date.now() - exp.at > EXPORT_TTL_MS) throw badRequest('The Excel backup is more than an hour old — download it again');
  if ((await maxTicketId(tx, termId)) !== exp.maxTicketId) throw badRequest('New slips came in after the backup — download it again');
  await tx.execute({ sql: 'UPDATE settings SET value = NULL WHERE key = ?', args: [EXPORT_KEY] });
}

router.get('/summary', async (req, res) => {
  const { termId, folderId } = parseScope(req.query);
  await assertExportScope(req.user, termId, folderId);
  const w = ticketWhere(termId, folderId);
  const andActive = w.sql ? `${w.sql} AND` : 'WHERE';
  const countArgs = folderId
    ? [folderId, folderId, ...w.args, ...w.args, ...w.args, ...w.args]
    : termId
      ? [termId, ...w.args, ...w.args, ...w.args, ...w.args]
      : [...w.args, ...w.args, ...w.args, ...w.args];
  const [terms, counts] = await Promise.all([
    summaryRows(db, termId, folderId),
    one(db, `SELECT (SELECT COUNT(*) FROM terms ${folderId ? 'WHERE folder_id = ?' : termId ? 'WHERE id = ?' : ''}) AS terms,
                    (SELECT COUNT(*) FROM term_folders ${folderId ? 'WHERE id = ?' : ''}) AS folders,
                    (SELECT COUNT(*) FROM tickets ${w.sql}) AS slips, (SELECT COUNT(*) FROM ticket_items ${w.sql}) AS items,
                    (SELECT COUNT(*) FROM tickets ${andActive} status = 'active') AS active_slips,
                    (SELECT COALESCE(SUM(net_amount), 0) FROM tickets ${andActive} status = 'active') AS active_amount`,
    countArgs),
  ]);
  res.json({ ...counts, terms });
});

function sheet(book, name, columns, rows) {
  const ws = book.addWorksheet(name);
  ws.columns = columns.map(([header, key, width = 16]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.addRows(rows);
}

router.get('/export.xlsx', async (req, res) => {
  const { termId, folderId } = parseScope(req.query);
  await assertExportScope(req.user, termId, folderId);
  const w = ticketWhere(termId, folderId);
  const joinWhere = w.sql ? w.sql.replace('term_id', 't.term_id') : '';
  const [folders, terms, slips, items, maxId] = await Promise.all([
    termId
      ? all(db, 'SELECT f.* FROM term_folders f JOIN terms tm ON tm.folder_id = f.id WHERE tm.id = ?', [termId])
      : folderId
        ? all(db, 'SELECT * FROM term_folders WHERE id = ?', [folderId])
        : all(db, 'SELECT * FROM term_folders ORDER BY id'),
    summaryRows(db, termId, folderId),
    all(db, `SELECT t.id, tm.description AS term, t.slip_no, u.username AS user, a.username AS agent, t.status,
                    t.gross_amount, t.discount_amount, t.net_amount, t.win_amount, t.created_at
             FROM tickets t JOIN terms tm ON tm.id = t.term_id JOIN users u ON u.id = t.user_id
             LEFT JOIN users a ON a.id = t.agent_id ${joinWhere} ORDER BY t.id`, w.args),
    all(db, `SELECT t.slip_no, tm.description AS term, u.username AS user, bt.description AS bet_type, ti.number,
                    ti.units, ti.amount, ti.discount, ti.is_winner, ti.win_amount
             FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id JOIN terms tm ON tm.id = t.term_id
             JOIN users u ON u.id = t.user_id JOIN bet_types bt ON bt.id = ti.bet_type_id ${joinWhere} ORDER BY ti.id`, w.args),
    maxTicketId(db, termId, folderId),
  ]);
  if (termId && !terms.length) throw badRequest('Term not found');
  if (folderId && !folders.length) throw badRequest('Folder not found');

  const book = new ExcelJS.Workbook();
  book.created = new Date();
  sheet(book, 'Folders', [['ID', 'id', 8], ['ဖိုင်', 'name', 28], ['Created', 'created_at', 20]], folders);
  sheet(book, 'Terms', [['ID', 'id', 8], ['ဖိုင်', 'folder', 24], ['အပါတ်စဥ်', 'description', 24], ['Type', 'game', 8], ['Status', 'status', 10],
    ['Unit price', 'unit_price', 10], ['Close', 'close_at', 22], ['Draw', 'draw_at', 22], ['ပေါက်ဂဏန်း', 'result', 12],
    ['Slips', 'slips', 8], ['Gross', 'gross', 12], ['Discount', 'discount', 12], ['Net', 'net', 12], ['Payout', 'payout', 12]], terms);
  sheet(book, 'Slips', [['ID', 'id', 8], ['အပါတ်စဥ်', 'term', 24], ['Slip', 'slip_no', 16], ['User', 'user', 14], ['Agent', 'agent', 14],
    ['Status', 'status', 10], ['Gross', 'gross_amount', 12], ['Discount', 'discount_amount', 12], ['Net', 'net_amount', 12],
    ['Win', 'win_amount', 12], ['Time', 'created_at', 20]], slips);
  sheet(book, 'Slip details', [['Slip', 'slip_no', 16], ['အပါတ်စဥ်', 'term', 24], ['User', 'user', 14], ['Type', 'bet_type', 10],
    ['ဂဏန်း', 'number', 8], ['Units', 'units', 8], ['Amount', 'amount', 12], ['Discount %', 'discount', 10],
    ['Winner', 'is_winner', 8], ['Win', 'win_amount', 12]], items);

  // The delete needs a token from this export, tied to its scope and the slips it contains.
  const token = randomUUID();
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [EXPORT_KEY, JSON.stringify({ token, at: Date.now(), term_id: termId ?? null, folder_id: folderId ?? null, maxTicketId: maxId, by: req.user.id })],
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = termId ? `term-${termId}-backup-${stamp}.xlsx` : folderId ? `folder-${folderId}-backup-${stamp}.xlsx` : `sales-backup-${stamp}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Export-Token', token);
  await book.xlsx.write(res);
  res.end();
});

router.delete('/', async (req, res) => {
  const body = z.object({ export_token: z.string().optional(), confirm: z.literal('DELETE') }).parse(req.body ?? {});
  const result = await withTransaction(async (tx) => {
    // Open terms stay until they are closed / unactivated — All delete must not wipe a live draw.
    if (await one(tx, `SELECT 1 FROM terms WHERE status = 'open' LIMIT 1`)) {
      throw badRequest('Cannot delete all terms while a term is open');
    }
    // Sales (slips) → the Excel backup must come first; with none there is nothing to back up.
    if (await one(tx, 'SELECT 1 FROM tickets LIMIT 1')) await consumeExport(tx, body.export_token, null);

    // Refund slips that are still active (not settled), like deleting a closed term does.
    const active = await all(tx, `SELECT id, user_id, slip_no, net_amount FROM tickets WHERE status = 'active'`);
    let refunded = 0;
    for (const t of active) {
      await applyBalance(tx, t.user_id, t.net_amount, 'refund', { createdBy: req.user.id, note: `All delete: slip ${t.slip_no}` });
      refunded += t.net_amount;
    }
    const counts = await one(tx, `SELECT (SELECT COUNT(*) FROM terms) AS terms, (SELECT COUNT(*) FROM term_folders) AS folders,
                                         (SELECT COUNT(*) FROM tickets) AS slips, (SELECT COUNT(*) FROM ticket_items) AS items`);
    for (const sql of [
      'UPDATE wallet_transactions SET ticket_id = NULL WHERE ticket_id IS NOT NULL',
      'DELETE FROM slip_cancel_requests',
      'DELETE FROM slip_edit_logs',
      'DELETE FROM win_numbers',
      'DELETE FROM ticket_items',
      'DELETE FROM ticket_groups',
      'DELETE FROM tickets',
      'DELETE FROM term_results',
      'DELETE FROM term_unit_limits',
      'DELETE FROM term_user_limits',
      'DELETE FROM term_blocked_numbers',
      'DELETE FROM term_hot_numbers',
      'DELETE FROM term_hot_user_percents',
      'DELETE FROM term_clearings',
      'DELETE FROM ledger_cut_rules',
      'DELETE FROM term_purchases',
      'DELETE FROM terms',
      'DELETE FROM term_folders',
      `UPDATE settings SET value = NULL WHERE key = 'current_term_id'`,
    ]) await tx.execute(sql);
    const detail = { ...counts, refunded, refunded_slips: active.length };
    await tx.execute({
      sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'sales.delete_all', ?)`,
      args: [req.user.id, JSON.stringify(detail)],
    });
    return detail;
  });
  broadcast('terms');
  broadcast('tickets');
  res.json(result);
});

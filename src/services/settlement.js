import { all, db, one, withTransaction } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { parseResults, twodNumbers, winningNumbers } from '../rules.js';

// Marks winning lines, pays winners and closes the term in one transaction.
// With newResults (rows of { slot, value, label? }) the results are saved in the same transaction —
// the admin's "save result" step. On an already settled term that is a correction: the earlier
// winnings are taken back first (an 'adjust' row per winner; the balance may go negative if the
// money was already spent) and the slips are settled again on the new result.
export async function settleTerm(termId, actorId, { newResults } = {}) {
  const term = await one(db, 'SELECT * FROM terms WHERE id = ?', [termId]);
  if (!term) throw notFound('Term not found');
  if (newResults ? !['open', 'closed', 'drawn', 'settled'].includes(term.status) : term.status !== 'drawn') {
    throw badRequest(newResults ? `Cannot enter results for a ${term.status} term` : 'Enter results before settling (term must be "drawn")');
  }

  const results = parseResults(newResults ?? await all(db, 'SELECT slot, value FROM term_results WHERE term_id = ?', [termId]), term.game);
  const betTypes = await all(db, 'SELECT id, code FROM bet_types');
  const stmts = [];

  if (term.status === 'settled') {
    const won = `SELECT user_id, SUM(win_amount) AS amount FROM tickets WHERE term_id = ? AND status = 'won' GROUP BY user_id`;
    stmts.push(
      {
        sql: `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, note, created_by)
              SELECT w.user_id, 'adjust', -w.amount, u.balance - w.amount, ?, ?
              FROM (${won}) w JOIN users u ON u.id = w.user_id`,
        args: [`Result corrected, winnings taken back: ${term.description}`, actorId, termId],
      },
      {
        sql: `UPDATE users SET balance = balance - (SELECT w.amount FROM (${won}) w WHERE w.user_id = users.id),
                                updated_at = datetime('now')
              WHERE id IN (SELECT user_id FROM tickets WHERE term_id = ? AND status = 'won')`,
        args: [termId, termId],
      },
      { sql: 'DELETE FROM win_numbers WHERE term_id = ?', args: [termId] },
      { sql: `UPDATE tickets SET status = 'active', win_amount = 0 WHERE term_id = ? AND status IN ('won', 'lost')`, args: [termId] }
    );
  }

  if (newResults) {
    stmts.push(
      { sql: 'DELETE FROM term_results WHERE term_id = ?', args: [termId] },
      ...newResults.map((r) => ({
        sql: 'INSERT INTO term_results (term_id, slot, label, value, entered_by) VALUES (?, ?, ?, ?, ?)',
        args: [termId, r.slot, r.label ?? null, r.value, actorId],
      })),
      {
        sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'term.results', ?)`,
        args: [actorId, JSON.stringify({ termId, rows: newResults, corrected: term.status === 'settled' })],
      }
    );
  }

  const activeItems = `ticket_id IN (SELECT id FROM tickets WHERE term_id = ? AND status = 'active')`;
  stmts.push(
    { sql: `UPDATE ticket_items SET is_winner = 0, win_amount = 0 WHERE term_id = ? AND ${activeItems}`, args: [termId, termId] },
  );

  for (const bt of betTypes) {
    const numbers = winningNumbers(bt.code, results);
    if (!numbers.length) continue;
    stmts.push({
      sql: `UPDATE ticket_items SET is_winner = 1, win_amount = units * ? * multiplier
            WHERE term_id = ? AND bet_type_id = ? AND number IN (${numbers.map(() => '?').join(',')})
              AND ${activeItems}`,
      args: [term.unit_price, termId, bt.id, ...numbers, termId],
    });
  }

  // Twod: 3D bets on the result's neighbours / other orderings win at their Twod odds.
  const twod = twodNumbers(results.r3);
  const threeD = betTypes.find((bt) => bt.code === '3D');
  const twodIn = twod.map(() => '?').join(',');
  if (twod.length && threeD) {
    stmts.push({
      sql: `UPDATE ticket_items SET is_winner = 1, win_amount = units * ? * twod_multiplier
            WHERE term_id = ? AND bet_type_id = ? AND number IN (${twodIn}) AND is_winner = 0
              AND COALESCE(twod_multiplier, 0) > 0 AND ${activeItems}`,
      args: [term.unit_price, termId, threeD.id, ...twod, termId],
    });
  }
  const paidMultiplier = twod.length && threeD
    ? { sql: `CASE WHEN bet_type_id = ? AND number IN (${twodIn}) THEN twod_multiplier ELSE multiplier END`, args: [threeD.id, ...twod] }
    : { sql: 'multiplier', args: [] };

  stmts.push(
    {
      sql: `INSERT OR REPLACE INTO win_numbers (term_id, ticket_item_id, multiplier, created_by)
            SELECT term_id, id, ${paidMultiplier.sql}, ? FROM ticket_items
            WHERE term_id = ? AND is_winner = 1 AND ${activeItems}`,
      args: [...paidMultiplier.args, actorId, termId, termId],
    },
    {
      sql: `UPDATE tickets
            SET win_amount = (SELECT COALESCE(SUM(win_amount), 0) FROM ticket_items WHERE ticket_id = tickets.id),
                status = CASE WHEN EXISTS (SELECT 1 FROM ticket_items WHERE ticket_id = tickets.id AND is_winner = 1)
                              THEN 'won' ELSE 'lost' END
            WHERE term_id = ? AND status = 'active'`,
      args: [termId],
    },
    {
      sql: `UPDATE users
            SET balance = balance + (SELECT SUM(win_amount) FROM tickets
                                     WHERE term_id = ? AND status = 'won' AND user_id = users.id),
                updated_at = datetime('now')
            WHERE id IN (SELECT user_id FROM tickets WHERE term_id = ? AND status = 'won')`,
      args: [termId, termId],
    },
    {
      sql: `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, note, created_by)
            SELECT t.user_id, 'win', SUM(t.win_amount), u.balance, ?, ?
            FROM tickets t JOIN users u ON u.id = t.user_id
            WHERE t.term_id = ? AND t.status = 'won'
            GROUP BY t.user_id`,
      args: [`Winnings: ${term.description}`, actorId, termId],
    },
    {
      sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'term.settle', ?)`,
      args: [actorId, JSON.stringify({ termId, ...results, twod })],
    }
  );

  await withTransaction(async (tx) => {
    // Claiming the term in the status read above makes a concurrent first settle fail instead of
    // paying twice. (A correction reverses whatever is paid at that moment, so two in a row are fine.)
    const claimed = await one(tx, `UPDATE terms SET status = 'settled' WHERE id = ? AND status = ? RETURNING id`, [termId, term.status]);
    if (!claimed) throw badRequest('Term was changed meanwhile; reload and try again');
    await tx.batch(stmts);
  });

  return one(
    db,
    `SELECT COUNT(*) AS tickets,
            SUM(status = 'won') AS winning_tickets,
            COALESCE(SUM(net_amount), 0) AS sales,
            COALESCE(SUM(win_amount), 0) AS payout
     FROM tickets WHERE term_id = ? AND status IN ('won','lost')`,
    [termId]
  );
}

// Saves the result and closes the term without paying anyone: the term becomes 'drawn' (no more
// bets, results in) and is settled later with settleTerm (POST /terms/:id/settle). The admin's
// "save result" with ငွေရှင်း left unticked. A settled term is corrected with settleTerm instead.
export async function saveResults(termId, actorId, rows) {
  const term = await one(db, 'SELECT * FROM terms WHERE id = ?', [termId]);
  if (!term) throw notFound('Term not found');
  if (!['open', 'closed', 'drawn'].includes(term.status)) {
    throw badRequest(term.status === 'settled'
      ? 'This term is already settled; correct its result with settle on'
      : `Cannot enter results for a ${term.status} term`);
  }
  parseResults(rows, term.game); // same checks as settling (3D terms need slot 1, 2D terms slot 2)
  await withTransaction(async (tx) => {
    const claimed = await one(tx, `UPDATE terms SET status = 'drawn' WHERE id = ? AND status = ? RETURNING id`, [termId, term.status]);
    if (!claimed) throw badRequest('Term was changed meanwhile; reload and try again');
    await tx.batch([
      { sql: 'DELETE FROM term_results WHERE term_id = ?', args: [termId] },
      ...rows.map((r) => ({
        sql: 'INSERT INTO term_results (term_id, slot, label, value, entered_by) VALUES (?, ?, ?, ?, ?)',
        args: [termId, r.slot, r.label ?? null, r.value, actorId],
      })),
      {
        sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'term.results', ?)`,
        args: [actorId, JSON.stringify({ termId, rows, settled: false })],
      },
    ]);
  });
}

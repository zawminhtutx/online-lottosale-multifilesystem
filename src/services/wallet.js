import { one } from '../db.js';
import { badRequest } from '../errors.js';

// Changes a balance inside an open transaction and records it in the ledger.
// A debit that would make the balance negative is rejected, unless extra.allowCredit is set
// and the account is unlimited (it then goes negative = credit owed). Only bets and a
// master's / agent's hand-outs to their downline use credit; withdrawals never do.
export async function applyBalance(tx, userId, delta, type, extra = {}) {
  const row = await one(
    tx,
    `UPDATE users SET balance = balance + ?, updated_at = datetime('now')
     WHERE id = ? AND (? >= 0 OR balance + ? >= 0 OR (? = 1 AND unlimited = 1))
     RETURNING balance`,
    // Money paid in (refunds, wins, deposits) always goes through, even onto a negative balance
    // (an unlimited wallet that bet on credit); only money taken out is checked.
    [delta, userId, delta, delta, extra.allowCredit ? 1 : 0]
  );
  if (!row) throw badRequest('Insufficient balance');

  await tx.execute({
    sql: `INSERT INTO wallet_transactions
            (user_id, type, amount, balance_after, ticket_id, counterparty_id, note, created_by, float_reset)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId, type, delta, row.balance,
      extra.ticketId ?? null, extra.counterpartyId ?? null, extra.note ?? null, extra.createdBy ?? null,
      // floatReset: a ငွေ Transfer move, left out of the master's float (see routes/wallet.js).
      extra.floatReset ? 1 : 0,
    ],
  });
  return row.balance;
}

// Money moves down the account chain one hop at a time: admin → master → agent → user. The admin
// (superadmin) is the only place money enters or leaves the system — it credits and debits outright
// ('deposit' / 'withdraw', cash in and out). A master or an agent hands over its own money instead:
// the amount leaves the actor's balance and lands in the target's ('transfer_out' / 'transfer_in'),
// so nothing is created on the way down and every balance still adds up to its transactions.

// Deposit into [target] by [actor] inside a transaction. Returns the target's new balance.
export async function depositTo(tx, actor, target, amount, note, { floatReset = false } = {}) {
  if (actor.role !== 'admin') {
    // allowCredit: an unlimited master / agent may hand out money it does not hold yet (credit owed).
    await applyBalance(tx, actor.id, -amount, 'transfer_out', { allowCredit: true, counterpartyId: target.id, createdBy: actor.id, note, floatReset });
    return applyBalance(tx, target.id, amount, 'transfer_in', { counterpartyId: actor.id, createdBy: actor.id, note, floatReset });
  }
  return applyBalance(tx, target.id, amount, 'deposit', { counterpartyId: actor.id, createdBy: actor.id, note, floatReset });
}

// Withdraw from [target] by [actor]. A master / agent pulls it back into its own balance; the admin
// takes it out of the system. Never below zero. Returns the target's new balance.
export async function withdrawFrom(tx, actor, target, amount, note, { floatReset = false } = {}) {
  if (actor.role !== 'admin') {
    const after = await applyBalance(tx, target.id, -amount, 'transfer_out', { counterpartyId: actor.id, createdBy: actor.id, note, floatReset });
    await applyBalance(tx, actor.id, amount, 'transfer_in', { counterpartyId: target.id, createdBy: actor.id, note, floatReset });
    return after;
  }
  return applyBalance(tx, target.id, -amount, 'withdraw', { counterpartyId: actor.id, createdBy: actor.id, note, floatReset });
}

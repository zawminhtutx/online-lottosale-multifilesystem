import { config } from '../config.js';
import { all, db, one, withTransaction } from '../db.js';
import { canAccess, loadAccessibleUser } from '../auth.js';
import { assertTermVisible, managesFolder } from '../books.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { betTypeFitsTerm, expandInput } from '../rules.js';
import { applyBalance } from './wallet.js';

export function isTermOpenForBetting(term, now = new Date()) {
  if (term.status !== 'open') return false;
  if (term.open_at && now < new Date(term.open_at)) return false;
  if (term.close_at && now >= new Date(term.close_at)) return false;
  return true;
}

export async function getTicket(client, id) {
  const ticket = await one(
    client,
    `SELECT t.*, u.username, u.name AS user_name, tm.description AS term_description, tm.game, tm.unit_price
     FROM tickets t JOIN users u ON u.id = t.user_id JOIN terms tm ON tm.id = t.term_id
     WHERE t.id = ?`,
    [id]
  );
  if (!ticket) return null;
  ticket.groups = await all(client, 'SELECT * FROM ticket_groups WHERE ticket_id = ? ORDER BY id', [id]);
  ticket.items = await all(
    client,
    `SELECT ti.*, bt.description AS bet_type
     FROM ticket_items ti JOIN bet_types bt ON bt.id = ti.bet_type_id
     WHERE ti.ticket_id = ? ORDER BY ti.serial`,
    [id]
  );
  return ticket;
}

// With dryRun, runs every check and returns the priced ticket without saving or charging it.
// Numbers a ticket entry bets on: the client's explicit expansion when given (POS patterns
// like "1P" or "SS"), otherwise the server's own digits / R expansion of the input.
function entryNumbers(bt, entry) {
  if (!entry.numbers) return expandInput(bt, entry.input);
  for (const n of entry.numbers) {
    if (n.length !== bt.digits) throw badRequest(`${bt.description}: "${n}" must be ${bt.digits} digit(s)`);
  }
  return entry.numbers;
}

// Slip numbers run per user within each term. Who typed the slip sets the prefix: admin A,
// master M, agent G, user S — e.g. "S-user1-0001", "A-user1-0002". Every term starts again at
// 0001. Counting the user's slips (cancelled ones too) keeps the numbers unique in the write tx.
const slipPrefix = (role) => ({ admin: 'A', master: 'M', agent: 'G', user: 'S' }[role] || 'S');

export async function nextSlipNo(client, termId, user, actor = user) {
  const { n } = await one(client, 'SELECT COUNT(*) + 1 AS n FROM tickets WHERE term_id = ? AND user_id = ?', [termId, user.id]);
  return `${slipPrefix(actor.role)}-${user.username}-${String(n).padStart(4, '0')}`;
}

function canSaveOver(actor, bettor) {
  if (actor.role === 'admin') return true;
  if (['master', 'agent', 'user'].includes(actor.role) && Number(actor.sale_over) === 1) return true;
  // A master or an agent granted this user the right to have over-break bets accepted.
  return bettor?.role === 'user' && Number(bettor.sale_over) === 1;
}

export async function placeTicket(actor, { term_id, user_id, entries, dry_run: dryRun = false, save_over: saveOver = false }, clientIp) {
  const bettor = await loadAccessibleUser(db, actor, user_id ?? actor.id);
  if (bettor.role !== 'user') throw badRequest('Only accounts with role "user" can hold tickets');
  if (bettor.status !== 'active') throw forbidden('Account is not active');

  // Pricing data that does not change while betting; read outside the write lock.
  const [betTypes, rates, discounts, prizeSet] = await Promise.all([
    all(db, 'SELECT * FROM bet_types'),
    all(db, `SELECT * FROM prize_rates WHERE prize_set_id = ? AND side = 'sale'`, [bettor.prize_set_id]),
    all(db, 'SELECT * FROM user_discounts WHERE user_id = ?', [bettor.id]),
    one(db, 'SELECT twod_multiplier FROM prize_sets WHERE id = ?', [bettor.prize_set_id]),
  ]);
  const typeById = new Map(betTypes.map((t) => [t.id, t]));
  const rateByType = new Map(rates.map((r) => [r.bet_type_id, r]));
  const discountByType = new Map(discounts.map((d) => [d.bet_type_id, d.discount]));

  const groups = entries.map((e) => {
    const bt = typeById.get(e.bet_type_id);
    if (!bt || !bt.is_active) throw badRequest(`Unknown bet type ${e.bet_type_id}`);
    const rate = rateByType.get(bt.id);
    if (!rate || rate.multiplier <= 0) throw badRequest(`${bt.description} is not offered`);
    // prize_rates.discount of -1 (Access convention) means "use the customer's own discount".
    const discountPct = rate.discount >= 0 ? rate.discount : discountByType.get(bt.id) ?? 0;
    // 3D lines also record the Twod odds they would be paid at (see settlement).
    const twodMultiplier = bt.code === '3D' ? prizeSet?.twod_multiplier ?? 0 : null;
    return { bt, input: e.input, units: e.units, numbers: entryNumbers(bt, e), multiplier: rate.multiplier, twodMultiplier, discountPct };
  });

  const itemCount = groups.reduce((n, g) => n + g.numbers.length, 0);
  if (itemCount > config.maxItemsPerTicket) {
    throw badRequest(`A ticket may contain at most ${config.maxItemsPerTicket} numbers`);
  }

  const result = await withTransaction(async (tx) => {
    const term = await one(tx, 'SELECT * FROM terms WHERE id = ?', [term_id]);
    if (!term) throw notFound('Term not found');
    await assertTermVisible(tx, bettor, term);
    if (saveOver && !canSaveOver(actor, bettor)) {
      const folder = term.folder_id
        ? await one(tx, 'SELECT master_id FROM term_folders WHERE id = ?', [term.folder_id])
        : null;
      // A master runs its own file: the break, and saving past it, need no extra grant.
      if (!managesFolder(actor, folder ?? { master_id: null })) throw forbidden('Saving over the unit break is not allowed');
    }
    if (!isTermOpenForBetting(term)) throw badRequest('Betting is closed for this term');
    for (const g of groups) {
      if (!betTypeFitsTerm(g.bt, term.game)) throw badRequest(`This term is ${term.game} only (${g.bt.description} not allowed)`);
    }

    // Every number of the slip is checked on its own and, where needed, cut down or left out —
    // the slip is not refused as a whole. In order:
    //   closed number          -> not saved
    //   hot number             -> topped up to the user's hot % (their own, else the term's default) of
    //                             their whole stake in the term (earlier slips + this slip), less what
    //                             they already hold on that number
    //   own Max Unit           -> whatever is left of it (not saved when nothing is)
    //   unit break             -> whatever is left of it (not saved when the break is full)
    // A group with any number changed or left out is saved as one plain line per number.
    // `adjustments` lists every change so the apps can show it after saving.
    const [blockedRows, limits, userLimits, hotRows, hotUser, totals, own] = await Promise.all([
      all(tx, 'SELECT bet_type_id, number FROM term_blocked_numbers WHERE term_id = ?', [term.id]),
      all(tx, 'SELECT bet_type_id, max_units FROM term_unit_limits WHERE term_id = ? AND max_units > 0', [term.id]),
      all(tx, 'SELECT bet_type_id, max_units FROM term_user_limits WHERE term_id = ? AND user_id = ?', [term.id, bettor.id]),
      all(tx, 'SELECT bet_type_id, number FROM term_hot_numbers WHERE term_id = ?', [term.id]),
      one(tx, 'SELECT percent FROM term_hot_user_percents WHERE term_id = ? AND user_id = ?', [term.id, bettor.id]),
      all(tx, 'SELECT bet_type_id, number, units FROM v_number_totals WHERE term_id = ?', [term.id]),
      all(
        tx,
        `SELECT ti.bet_type_id, ti.number, SUM(ti.units) AS units
         FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
         WHERE t.term_id = ? AND t.user_id = ? AND t.status <> 'cancelled'
         GROUP BY ti.bet_type_id, ti.number`,
        [term.id, bettor.id]
      ),
    ]);
    const keyOf = (typeId, number) => `${typeId}:${number}`;
    const blocked = new Set(blockedRows.map((b) => keyOf(b.bet_type_id, b.number)));
    const hot = new Set(hotRows.map((r) => keyOf(r.bet_type_id, r.number)));
    const hotPercent = hotUser?.percent ?? term.hot_percent;
    const breakByType = new Map(limits.map((l) => [l.bet_type_id, l.max_units]));
    const userMaxByType = new Map(userLimits.map((l) => [l.bet_type_id, l.max_units]));
    const taken = new Map(totals.map((e) => [keyOf(e.bet_type_id, e.number), e.units])); // everyone's units so far
    const mine = new Map(own.map((e) => [keyOf(e.bet_type_id, e.number), e.units])); // this user's units so far

    // Hot quota base: this user's whole stake in the term = units already on their slips (all numbers)
    // + units typed on this slip (closed numbers left out). On each hot number they may hold at most
    // hotPercent of that base in total; what they already hold on it counts against the quota, so a
    // later slip only tops it up to the quota and nothing more once it is full.
    const previousUnits = own.reduce((s, e) => s + Number(e.units || 0), 0);
    const slipUnits = groups.reduce(
      (s, g) => s + g.units * g.numbers.filter((n) => !blocked.has(keyOf(g.bt.id, n))).length,
      0
    );
    const hotQuota = Math.floor(((previousUnits + slipUnits) * hotPercent) / 100);

    const adjustments = [];
    const savedGroups = [];
    for (const g of groups) {
      const kept = [];
      let changed = false;
      for (const n of g.numbers) {
        const key = keyOf(g.bt.id, n);
        let units = g.units;
        let reason = null;
        if (blocked.has(key)) {
          units = 0;
          reason = 'closed';
        }
        if (units > 0 && hot.has(key)) {
          const left = Math.max(0, hotQuota - (mine.get(key) ?? 0));
          if (units > left) { units = left; reason = 'hot'; }
        }
        const userMax = userMaxByType.get(g.bt.id);
        if (units > 0 && userMax !== undefined) {
          const left = Math.max(0, userMax - (mine.get(key) ?? 0));
          if (units > left) { units = left; reason = 'max_unit'; }
        }
        const cap = breakByType.get(g.bt.id);
        if (!saveOver && units > 0 && cap !== undefined) {
          const left = Math.max(0, cap - (taken.get(key) ?? 0));
          if (units > left) { units = left; reason = left > 0 ? 'break' : 'break_full'; }
        }
        if (reason) {
          changed = true;
          adjustments.push({ bet_type_id: g.bt.id, number: n, requested: g.units, saved: units, reason, percent: reason === 'hot' ? hotPercent : undefined });
        }
        if (units > 0) {
          kept.push({ number: n, units });
          taken.set(key, (taken.get(key) ?? 0) + units); // later lines of this slip see these units too
          mine.set(key, (mine.get(key) ?? 0) + units);
        }
      }
      if (!changed) savedGroups.push(g);
      else for (const k of kept) savedGroups.push({ ...g, input: k.number, numbers: [k.number], units: k.units });
    }
    if (!savedGroups.length) throw badRequest('Nothing to save: every number is closed, full or at its limit');
    groups.splice(0, groups.length, ...savedGroups);

    let gross = 0;
    let discountTotal = 0;
    for (const g of groups) {
      g.amount = g.units * term.unit_price;
      g.lineDiscount = Math.round((g.amount * g.discountPct) / 100);
      gross += g.amount * g.numbers.length;
      discountTotal += g.lineDiscount * g.numbers.length;
    }
    const net = gross - discountTotal;

    if (dryRun) {
      const { balance } = await one(tx, 'SELECT balance FROM users WHERE id = ?', [bettor.id]);
      return {
        preview: {
          term_id: term.id,
          user_id: bettor.id,
          unit_price: term.unit_price,
          gross_amount: gross,
          discount_amount: discountTotal,
          net_amount: net,
          balance,
          balance_after: balance - net,
          unlimited: !!bettor.unlimited,
          sufficient: !!bettor.unlimited || balance >= net,
          adjustments,
          items: groups.flatMap((g) => g.numbers.map((number) => ({
            bet_type_id: g.bt.id, input: String(g.input).toUpperCase(), number, units: g.units,
            amount: g.amount, discount: g.discountPct, multiplier: g.multiplier, twod_multiplier: g.twodMultiplier,
          }))),
        },
      };
    }

    const slipNo = await nextSlipNo(tx, term.id, bettor, actor);
    const ticket = await one(
      tx,
      `INSERT INTO tickets
         (term_id, slip_no, user_id, agent_id, gross_amount, discount_amount, net_amount, created_by, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [term.id, slipNo, bettor.id, bettor.parent_id, gross, discountTotal, net, actor.id, clientIp]
    );

    const itemRows = [];
    let serial = 0;
    for (const g of groups) {
      let groupId = null;
      if (g.numbers.length > 1) {
        ({ id: groupId } = await one(
          tx,
          'INSERT INTO ticket_groups (ticket_id, input, bet_type_id, units) VALUES (?, ?, ?, ?) RETURNING id',
          [ticket.id, String(g.input).toUpperCase(), g.bt.id, g.units]
        ));
      }
      for (const n of g.numbers) {
        itemRows.push([ticket.id, term.id, g.bt.id, n, g.units, g.amount, g.discountPct, groupId, ++serial, g.multiplier, g.twodMultiplier]);
      }
    }
    await tx.execute({
      sql: `INSERT INTO ticket_items
              (ticket_id, term_id, bet_type_id, number, units, amount, discount, group_id, serial, multiplier, twod_multiplier)
            VALUES ${itemRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      args: itemRows.flat(),
    });

    await applyBalance(tx, bettor.id, -net, 'bet', {
      allowCredit: true,
      ticketId: ticket.id, createdBy: actor.id, note: `Slip ${slipNo}`,
    });
    return { id: ticket.id, adjustments };
  });

  if (result.preview) return result.preview;
  return { ...(await getTicket(db, result.id)), adjustments: result.adjustments };
}

// One row of the slip edit / delete log the slip's owner sees in their app (see slip_edit_logs).
function slipLog(ticket, actor, { action, lines = null, netAfter, refund }) {
  return {
    sql: `INSERT INTO slip_edit_logs (ticket_id, term_id, user_id, slip_no, action, lines, net_before, net_after, refund, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [ticket.id, ticket.term_id, ticket.user_id, ticket.slip_no, action, lines && JSON.stringify(lines),
      ticket.net_amount, netAfter, refund, actor.id],
  };
}

// Edit of an active slip before the term has results, by the admin or by the master above the
// slip's owner: each line's units can be lowered, or set to 0 to drop the line. Raising units is
// not offered — that skips the limit checks, so more is bet with a new slip. The difference is
// refunded to the user; dropping every line cancels the slip. Editing any line of a group (e.g.
// "12R") turns all its lines into plain lines.
export async function editTicketItems(actor, ticketId, changes) {
  if (!['admin', 'master'].includes(actor.role)) throw forbidden('Only admin and master accounts can edit slips');
  await withTransaction(async (tx) => {
    const ticket = await one(
      tx,
      `SELECT t.*, tm.status AS term_status, tm.unit_price FROM tickets t JOIN terms tm ON tm.id = t.term_id WHERE t.id = ?`,
      [ticketId]
    );
    if (!ticket) throw notFound('Ticket not found');
    if (!(await canAccess(tx, actor, { id: ticket.user_id }))) throw notFound('Ticket not found');
    if (ticket.status !== 'active') throw badRequest(`Ticket is already ${ticket.status}`);
    if (!['open', 'closed'].includes(ticket.term_status)) throw badRequest('Term already has results');

    const items = await all(
      tx,
      `SELECT ti.id, ti.number, ti.units, ti.discount, ti.group_id, bt.description AS bet_type
       FROM ticket_items ti JOIN bet_types bt ON bt.id = ti.bet_type_id WHERE ti.ticket_id = ? ORDER BY ti.serial`,
      [ticket.id]
    );
    const units = new Map(items.map((i) => [i.id, i.units])); // new units per line
    for (const c of changes) {
      const item = items.find((i) => i.id === c.id);
      if (!item) throw badRequest(`Line ${c.id} is not on this slip`);
      if (c.units > item.units) throw badRequest(`${item.number}: units can only be lowered (now ${item.units})`);
      units.set(item.id, c.units);
    }
    const edited = items.filter((i) => units.get(i.id) !== i.units);
    if (!edited.length) return;
    const kept = items.filter((i) => units.get(i.id) > 0);
    const lines = edited.map((i) => ({ bet_type: i.bet_type, number: i.number, before: i.units, after: units.get(i.id) }));

    // Every line dropped: cancel the slip as a whole (its lines stay so it can still be opened).
    if (!kept.length) {
      await tx.batch([
        { sql: `UPDATE tickets SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`, args: [ticket.id] },
        slipLog(ticket, actor, { action: 'cancel', lines, netAfter: 0, refund: ticket.net_amount }),
      ]);
      await applyBalance(tx, ticket.user_id, ticket.net_amount, 'refund', {
        ticketId: ticket.id, createdBy: actor.id, note: `Cancel slip ${ticket.slip_no}`,
      });
      return;
    }

    // Totals of the lines left, priced like placeTicket does.
    let gross = 0;
    let discount = 0;
    for (const i of kept) {
      const amount = units.get(i.id) * ticket.unit_price;
      gross += amount;
      discount += Math.round((amount * i.discount) / 100);
    }
    const net = gross - discount;
    await tx.batch([
      ...edited.map((i) => (units.get(i.id) === 0
        ? { sql: 'DELETE FROM ticket_items WHERE id = ?', args: [i.id] }
        : { sql: 'UPDATE ticket_items SET units = ?, amount = ? WHERE id = ?', args: [units.get(i.id), units.get(i.id) * ticket.unit_price, i.id] })),
      // A group with any line changed no longer has one units figure: its lines become plain lines.
      ...[...new Set(edited.map((i) => i.group_id).filter(Boolean))].map((g) => ({
        sql: 'UPDATE ticket_items SET group_id = NULL WHERE group_id = ?', args: [g],
      })),
      {
        sql: `DELETE FROM ticket_groups WHERE ticket_id = ?
                AND id NOT IN (SELECT group_id FROM ticket_items WHERE ticket_id = ? AND group_id IS NOT NULL)`,
        args: [ticket.id, ticket.id],
      },
      { sql: 'UPDATE tickets SET gross_amount = ?, discount_amount = ?, net_amount = ? WHERE id = ?', args: [gross, discount, net, ticket.id] },
      slipLog(ticket, actor, { action: 'edit', lines, netAfter: net, refund: Math.max(0, ticket.net_amount - net) }),
    ]);
    if (ticket.net_amount > net) {
      await applyBalance(tx, ticket.user_id, ticket.net_amount - net, 'refund', {
        ticketId: ticket.id, createdBy: actor.id, note: `Edit slip ${ticket.slip_no}`,
      });
    }
  });
  return getTicket(db, ticketId);
}

export async function cancelTicket(actor, ticketId, { fromDeleteRequest = false } = {}) {
  await withTransaction(async (tx) => {
    const ticket = await one(
      tx,
      `SELECT t.*, tm.status AS term_status, tm.open_at, tm.close_at
       FROM tickets t JOIN terms tm ON tm.id = t.term_id
       WHERE t.id = ?`,
      [ticketId]
    );
    if (!ticket || !(await canAccess(tx, actor, { id: ticket.user_id }))) throw notFound('Ticket not found');
    if (ticket.status !== 'active') throw badRequest(`Ticket is already ${ticket.status}`);

    // The admin and a master may still cancel after betting closed, up to the term's results.
    // An agent only while betting is open — except a slip-delete request from its own user,
    // which it may approve until results (same window as master).
    if (['admin', 'master'].includes(actor.role) || (actor.role === 'agent' && fromDeleteRequest)) {
      if (!['open', 'closed'].includes(ticket.term_status)) throw badRequest('Term already has results');
    } else if (actor.role === 'agent') {
      if (!isTermOpenForBetting({ status: ticket.term_status, open_at: ticket.open_at, close_at: ticket.close_at })) {
        throw badRequest('Agents can only cancel while betting is open');
      }
    } else {
      throw forbidden('Users cannot cancel tickets');
    }

    await tx.batch([
      { sql: `UPDATE tickets SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`, args: [ticket.id] },
      slipLog(ticket, actor, { action: 'cancel', netAfter: 0, refund: ticket.net_amount }),
    ]);
    await applyBalance(tx, ticket.user_id, ticket.net_amount, 'refund', {
      ticketId: ticket.id, createdBy: actor.id, note: `Cancel slip ${ticket.slip_no}`,
    });
  });
  return getTicket(db, ticketId);
}

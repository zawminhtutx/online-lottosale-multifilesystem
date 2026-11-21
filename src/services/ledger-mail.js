import nodemailer from 'nodemailer';
import { all, db } from '../db.js';
import { config } from '../config.js';

// After a master's term reaches its close time, email the 00-99 and 000-999 ledger once to the
// recipient addresses entered by that master.  Account email addresses are never recipients.

let warned = false;

function transport() {
  if (!config.smtp.host || !config.smtp.from) {
    if (!warned) {
      console.warn('ledger mail: set SMTP_HOST and SMTP_FROM to send close-time ledgers');
      warned = true;
    }
    return null;
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

async function numberLines(client, termId, betTypeId, digits) {
  const rows = await all(
    client,
    `SELECT ti.number, SUM(ti.units) AS units
     FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
     WHERE ti.term_id = ? AND ti.bet_type_id = ? AND t.status <> 'cancelled'
     GROUP BY ti.number`,
    [termId, betTypeId]
  );
  const units = new Map(rows.map((r) => [String(r.number).padStart(digits, '0'), Number(r.units) || 0]));
  const lines = [];
  const max = 10 ** digits;
  for (let i = 0; i < max; i += 1) {
    const num = String(i).padStart(digits, '0');
    lines.push(`${num}  ${units.get(num) ?? 0}`);
  }
  return lines.join('\n');
}

async function recipients(client, masterId) {
  const master = await all(client,
    `SELECT ledger_recipients FROM users WHERE id = ? AND role = 'master' AND status = 'active'`, [masterId]);
  const value = String(master[0]?.ledger_recipients ?? '');
  return [...new Set(value.split(/[;,\r\n]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]
    .map((email) => ({ email }));
}

export async function mailClosedLedgers(client = db) {
  const tx = transport();
  if (!tx) return 0;
  const due = await all(
    client,
    `SELECT t.id, t.description, t.close_at, f.name AS folder_name, f.master_id
     FROM terms t JOIN term_folders f ON f.id = t.folder_id
     WHERE t.ledger_mailed_at IS NULL
       AND t.close_at IS NOT NULL
       AND t.status NOT IN ('draft', 'cancelled')
       AND f.master_id IS NOT NULL`
  );
  const now = Date.now();
  let sent = 0;
  for (const term of due) {
    if (Number.isNaN(Date.parse(term.close_at)) || Date.parse(term.close_at) > now) continue;
    const people = await recipients(client, term.master_id);
    const body = [
      `ဖိုင်: ${term.folder_name}`,
      `အပါတ်စဉ်: ${term.description}`,
      '',
      '00-99',
      await numberLines(client, term.id, 0, 2),
      '',
      '000-999',
      await numberLines(client, term.id, 1, 3),
    ].join('\n');
    try {
      for (const person of people) {
        await tx.sendMail({
          from: config.smtp.from,
          to: person.email,
          subject: `Ledger ${term.description} (00-99, 000-999)`,
          text: body,
        });
      }
      await client.execute({
        sql: `UPDATE terms SET ledger_mailed_at = datetime('now') WHERE id = ? AND ledger_mailed_at IS NULL`,
        args: [term.id],
      });
      sent += 1;
    } catch (err) {
      console.error(`ledger mail term ${term.id}:`, err.message);
    }
  }
  return sent;
}

export function startLedgerMail(ms = 30_000) {
  const run = () => mailClosedLedgers().catch((e) => console.error('ledger mail:', e.message));
  run();
  setInterval(run, ms).unref();
}

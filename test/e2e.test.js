// End-to-end flow against a throwaway local libSQL file:
// admin -> agent -> user, deposit, bet, limits, cancel, results, settle, payouts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';

const dir = mkdtempSync(join(tmpdir(), 'lotto-'));
process.env.TURSO_DATABASE_URL = pathToFileURL(join(dir, 'test.db')).href;
delete process.env.TURSO_AUTH_TOKEN;
process.env.JWT_SECRET = 'test-secret';
process.env.LOGIN_RATE_LIMIT = '1000';

const { db } = await import('../src/db.js');
const { app } = await import('../src/app.js');
const { attachLive, closeLive } = await import('../src/live.js');

let server;
let base;

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (username, password) => (await call('POST', '/api/auth/login', null, { username, password })).body.token;

// The admin opens master (and admin) accounts only, and its own cash only moves in and out of a
// master, so the accounts these tests hang straight under the admin are written to the database
// instead: seedAccount() is the row POST /users would insert, fund() the row + ledger entry a
// deposit would write.
async function seedAccount({ username, password, role, name, parent_id = 1, unlimited = false }) {
  const rs = await db.execute({
    sql: `INSERT INTO users (username, password_hash, role, parent_id, name, unlimited)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, role, parent_id, unlimited`,
    args: [username, await bcrypt.hash(password, 4), role, parent_id, name, unlimited ? 1 : 0],
  });
  const row = rs.rows[0];
  return {
    id: Number(row.id), username: row.username, role: row.role,
    parent_id: row.parent_id === null ? null : Number(row.parent_id), unlimited: Number(row.unlimited),
  };
}

async function fund(userId, amount) {
  await db.execute({ sql: 'UPDATE users SET balance = balance + ? WHERE id = ?', args: [amount, userId] });
  const rs = await db.execute({ sql: 'SELECT balance FROM users WHERE id = ?', args: [userId] });
  const balance = Number(rs.rows[0].balance);
  await db.execute({
    sql: `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, counterparty_id, created_by, note)
          VALUES (?, 'deposit', ?, ?, 1, 1, 'test funding')`,
    args: [userId, amount, balance],
  });
  return balance;
}

before(async () => {
  for (const f of ['schema.sql', 'seed.sql']) {
    await db.executeMultiple(readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8'));
  }
  await db.execute({
    sql: `INSERT INTO users (username, password_hash, role, name) VALUES ('admin', ?, 'admin', 'Admin')`,
    args: [await bcrypt.hash('admin123', 4)],
  });
  await db.execute("INSERT INTO term_folders (id, name) VALUES (1, 'Tests')"); // every term needs a folder
  server = app.listen(0);
  attachLive(server);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  closeLive();
  server.close();
  db.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may still hold the file */ }
});

test('user search and term status reject wildcards and junk', async () => {
  const admin = await login('admin', 'admin123');
  await seedAccount({ username: 'findme', password: 'xxxxxx', role: 'master', name: 'Find Me' });

  const hit = (await call('GET', '/api/users?search=findme', admin)).body;
  assert.ok(hit.some((u) => u.username === 'findme'));

  const wild = await call('GET', `/api/users?search=${encodeURIComponent('%')}`, admin);
  assert.equal(wild.status, 200);
  assert.equal(wild.body.length, 0); // `%` is a character, not "match all"

  const tooLong = await call('GET', `/api/users?search=${'a'.repeat(51)}`, admin);
  assert.equal(tooLong.status, 400);

  assert.equal((await call('GET', '/api/terms?status=open', admin)).status, 200);
  assert.equal((await call('GET', '/api/terms?status=drop-table', admin)).status, 400);
});

test('full betting cycle', async () => {
  const admin = await login('admin', 'admin123');
  assert.ok(admin);

  // The admin opens master accounts only. agent1 hangs straight under the admin here
  // (an account from before that rule), so it is seeded; see seedAccount.
  assert.equal((await call('POST', '/api/users', admin, { username: 'agentx', password: 'xxxxxx', role: 'agent', name: 'X' })).status, 403);
  assert.equal((await call('POST', '/api/users', admin, { username: 'userx', password: 'xxxxxx', role: 'user', name: 'X' })).status, 403);
  const agentRes = { body: await seedAccount({ username: 'agent1', password: 'agent123', role: 'agent', name: 'Agent One' }) };
  const agent = await login('agent1', 'agent123');

  // Agents may not create agents.
  assert.equal((await call('POST', '/api/users', agent, { username: 'agent2', password: 'xxxxxx', role: 'agent', name: 'X' })).status, 403);

  const userRes = await call('POST', '/api/users', agent, { username: 'user1', password: 'user123', role: 'user', name: 'User One' });
  assert.equal(userRes.status, 201);
  assert.equal(userRes.body.parent_id, agentRes.body.id);
  const userId = userRes.body.id;
  const user = await login('user1', 'user123');

  // 10% discount on 2D for this user.
  assert.equal((await call('PUT', `/api/users/${userId}/discounts`, agent, [{ bet_type_id: 0, discount: 10, discount2: 3 }])).status, 200);

  // Commission page: lists the accounts the caller sets, with their %, and bulk-sets discount 1,
  // keeping discount 2 / 3. It is handed down one step at a time: the admin sets its masters'
  // (none yet here), an agent its users'. Reaching past that step is refused.
  const comm = (await call('GET', '/api/users/commissions', agent)).body;
  assert.deepEqual(comm.map((u) => u.username), ['user1']);
  assert.equal(comm[0].discounts[0], 10);
  const adminComm = (await call('GET', '/api/users/commissions', admin)).body;
  assert.ok(adminComm.every((u) => u.role === 'master')); // masters only, not this user
  assert.ok(!adminComm.some((u) => u.id === userId));
  assert.equal((await call('PUT', '/api/users/commissions', admin, [{ user_id: userId, bet_type_id: 0, discount: 12 }])).status, 400);
  assert.equal((await call('PUT', `/api/users/${userId}/discounts`, admin, [{ bet_type_id: 0, discount: 12 }])).status, 403);
  assert.equal((await call('PUT', '/api/users/commissions', agent, [{ user_id: userId, bet_type_id: 0, discount: 10 }])).status, 200);
  assert.equal((await call('PUT', '/api/users/commissions', agent, [{ user_id: agentRes.body.id, bet_type_id: 0, discount: 5 }])).status, 400);
  assert.equal((await call('GET', '/api/users/commissions', user)).status, 403);
  const disc = (await call('GET', `/api/users/${userId}`, admin)).body.discounts;
  assert.deepEqual(disc.map((d) => [d.discount, d.discount2]), [[10, 3]]);

  // KPay / WavePay: a user sees the numbers of the account they are under (here their agent).
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', user)).body, null);
  await call('PATCH', '/api/users/1', admin, { kpay_no: '09111', kpay_name: 'Admin' });
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', user)).body, null); // not the admin's
  assert.equal((await call('PATCH', `/api/users/${agentRes.body.id}`, agent, { kpay_no: '09222', kpay_name: 'Agent', wave_no: '' })).status, 200);
  assert.deepEqual((({ kpay_no, kpay_name, wave_no }) => ({ kpay_no, kpay_name, wave_no }))((await call('GET', '/api/wallet-requests/pay-to', user)).body),
    { kpay_no: '09222', kpay_name: 'Agent', wave_no: null });
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', agent)).body.kpay_no, '09111');
  assert.equal((await call('PATCH', `/api/users/${userId}`, agent, { kpay_no: '09333' })).status, 400);

  // Money: the admin's cash only goes into a master, so agent1 is funded directly; agent -> user 50,000.
  assert.equal((await call('POST', '/api/wallet/deposit', admin, { user_id: agentRes.body.id, amount: 100000 })).status, 403);
  assert.equal((await call('POST', '/api/wallet/withdraw', admin, { user_id: agentRes.body.id, amount: 1 })).status, 403);
  assert.equal(await fund(agentRes.body.id, 100000), 100000);
  assert.equal((await call('POST', '/api/wallet/deposit', agent, { user_id: userId, amount: 50000 })).body.balance, 50000);
  assert.equal((await call('POST', '/api/wallet/deposit', agent, { user_id: userId, amount: 999999 })).status, 400);

  // A term is either 2D or 3D.
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Test draw 2D', game: '2D', unit_price: 100, status: 'open' })).body;
  const term3 = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Test draw 3D', game: '3D', unit_price: 100, status: 'open' })).body;
  assert.equal((await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Mixed', game: '2D3D' })).status, 400);
  assert.equal((await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 1, max_units: 5 }])).status, 400);
  await call('PUT', `/api/terms/${term3.id}/limits`, admin, [{ bet_type_id: 1, max_units: 5 }]);
  await call('PUT', `/api/terms/${term.id}/blocked`, admin, [{ bet_type_id: 0, number: '99' }]);

  // 2D "12R" x 10 units -> 12 and 21, 1000 each, 10% off -> net 1800.
  const t1 = await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '12R', units: 10 }] });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  assert.equal(t1.body.items.length, 2);
  assert.equal(t1.body.gross_amount, 2000);
  assert.equal(t1.body.net_amount, 1800);
  assert.equal(t1.body.groups.length, 1);
  // 3D "385" x 2 units -> 200, on the 3D term only.
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 1, input: '385', units: 2 }] })).status, 400);
  const t3 = await call('POST', '/api/tickets', user, { term_id: term3.id, entries: [{ bet_type_id: 1, input: '385', units: 2 }] });
  assert.equal(t3.status, 201, JSON.stringify(t3.body));
  assert.equal(t3.body.net_amount, 200);

  // Only 2D and 3D exist; any other bet type id is refused.
  assert.deepEqual((await call('GET', '/api/meta', user)).body.bet_types.map((b) => b.code), ['2D', '3D']);
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 10, input: '6', units: 1 }] })).status, 400);

  // Blocked number, unit limit, bad input.
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '99', units: 1 }] })).status, 400);
  // Over the break: only what is left (3 of 5) would be saved, and the change is reported.
  const overLimit = await call('POST', '/api/tickets', user, { term_id: term3.id, dry_run: true, entries: [{ bet_type_id: 1, input: '385', units: 4 }] });
  assert.equal(overLimit.status, 200, JSON.stringify(overLimit.body));
  assert.deepEqual(overLimit.body.adjustments.map((a) => [a.number, a.requested, a.saved, a.reason]), [['385', 4, 3, 'break']]);
  assert.equal(overLimit.body.items[0].units, 3);
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term3.id, entries: [{ bet_type_id: 1, input: '12', units: 1 }] })).status, 400);

  // Second ticket, placed by the agent for the user, then cancelled (refund).
  const t2 = await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: userId, entries: [{ bet_type_id: 0, input: '44', units: 5 }] });
  assert.equal(t2.status, 201);
  assert.equal((await call('POST', `/api/tickets/${t2.body.id}/cancel`, user)).status, 403);
  assert.equal((await call('POST', `/api/tickets/${t2.body.id}/cancel`, agent)).body.status, 'cancelled');

  let me = (await call('GET', '/api/auth/me', user)).body;
  assert.equal(me.balance, 50000 - 1800 - 200);

  // Users only see their own tickets; agent sees exposure.
  assert.equal((await call('GET', '/api/tickets', user)).body.length, 3);
  const exposure = (await call('GET', `/api/terms/${term.id}/exposure?bet_type_id=0`, agent)).body;
  assert.deepEqual(exposure.map((e) => e.number).sort(), ['12', '21']);

  // Close, enter results (2D term: 2D result only; 3D term: 3D result) — saving them settles.
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  await call('PATCH', `/api/terms/${term3.id}`, admin, { status: 'closed' });
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '10', units: 1 }] })).status, 400);
  assert.equal((await call('POST', `/api/terms/${term.id}/settle`, admin)).status, 400);
  assert.equal((await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 1, value: '385' }])).status, 400);
  // Wins: 2D 21 -> 10*100*80 = 80,000; 3D 385 -> 2*100*550 = 110,000.
  const settled = await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '21' }]);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.payout, 80000);
  assert.equal((await call('GET', `/api/terms/${term.id}`, admin)).body.status, 'settled');
  assert.equal((await call('POST', `/api/terms/${term.id}/settle`, admin)).status, 400);
  assert.equal((await call('PUT', `/api/terms/${term3.id}/results`, admin, [{ slot: 2, value: '21' }])).status, 400);
  const settled3 = await call('PUT', `/api/terms/${term3.id}/results`, admin, [{ slot: 1, value: '385' }]);
  assert.equal(settled3.body.payout, 110000, JSON.stringify(settled3.body));

  me = (await call('GET', '/api/auth/me', user)).body;
  assert.equal(me.balance, 50000 - 2000 + 190000);

  const ticket = (await call('GET', `/api/tickets/${t1.body.id}`, user)).body;
  assert.equal(ticket.status, 'won');
  assert.deepEqual(ticket.items.filter((i) => i.is_winner).map((i) => i.number), ['21']);
  assert.equal((await call('GET', `/api/tickets/${t3.body.id}`, user)).body.status, 'won');

  const summary = (await call('GET', `/api/reports/summary?term_id=${term.id}&group_by=agent`, admin)).body;
  assert.equal(summary[0].username, 'agent1');
  assert.equal(summary[0].profit, 1800 - 80000);

  // folder_id instead of term_id: every term in the ဖိုင် at once (the admin app's "အပါတ်စဥ် အားလုံး").
  const summary3 = (await call('GET', `/api/reports/summary?term_id=${term3.id}&group_by=agent`, admin)).body;
  const folderSummary = (await call('GET', '/api/reports/summary?folder_id=1&group_by=agent', admin)).body;
  assert.equal(folderSummary.length, 1);
  assert.equal(folderSummary[0].username, 'agent1');
  assert.equal(folderSummary[0].tickets, summary[0].tickets + summary3[0].tickets);
  assert.equal(folderSummary[0].profit, summary[0].profit + summary3[0].profit);
  // Exactly one of the two: neither or both is a bad request.
  assert.equal((await call('GET', `/api/reports/summary?term_id=${term.id}&folder_id=1`, admin)).status, 400);
  assert.equal((await call('GET', '/api/reports/summary?group_by=agent', admin)).status, 400);

  const ledger = (await call('GET', '/api/wallet/transactions', user)).body.map((w) => w.type);
  assert.deepEqual(ledger, ['win', 'win', 'refund', 'bet', 'bet', 'bet', 'transfer_in']);
});

test('admin dashboard endpoints', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');

  const overview = (await call('GET', '/api/reports/overview', admin)).body;
  assert.equal(overview.accounts.find((a) => a.role === 'user').count, 1);
  assert.ok(overview.terms.some((t) => t.status === 'settled'));

  const agents = (await call('GET', '/api/users?role=agent', admin)).body;
  assert.equal(agents[0].child_count, 1);

  // Prize sets are admin-only; copy, edit rates, delete.
  // Agents may read the sets they can give out (here only their own Default set).
  const agentSets = (await call('GET', '/api/prize-sets', agent)).body;
  assert.deepEqual(agentSets.map((s) => s.id), [0]);
  assert.equal((await call('POST', '/api/prize-sets', agent, { name: 'Nope' })).status, 403);
  const vip = await call('POST', '/api/prize-sets', admin, { name: 'VIP', copy_from: 0 });
  assert.equal(vip.status, 201);
  let sets = (await call('GET', '/api/prize-sets', admin)).body;
  assert.equal(sets.find((s) => s.id === vip.body.id).rates.length, 2);

  assert.equal((await call('PUT', `/api/prize-sets/${vip.body.id}/rates`, admin, [{ bet_type_id: 0, multiplier: 85, discount: -1 }])).status, 200);
  sets = (await call('GET', '/api/prize-sets', admin)).body;
  const vipRates = sets.find((s) => s.id === vip.body.id).rates;
  assert.equal(vipRates.length, 2); // only the sent type changes; the rest are kept
  assert.equal(vipRates.find((r) => r.bet_type_id === 0).multiplier, 85);

  const users = (await call('GET', '/api/users?role=user', admin)).body;
  await call('PATCH', `/api/users/${users[0].id}`, agent, { prize_set_id: vip.body.id });
  assert.equal((await call('DELETE', `/api/prize-sets/${vip.body.id}`, admin)).status, 400);
  await call('PATCH', `/api/users/${users[0].id}`, agent, { prize_set_id: 0 });
  assert.equal((await call('DELETE', `/api/prize-sets/${vip.body.id}`, admin)).status, 200);

  const deposits = (await call('GET', '/api/wallet/transactions?type=deposit', admin)).body;
  assert.ok(deposits.length > 0 && deposits.every((t) => t.type === 'deposit'));

  // Online web app is served at the root (SPA fallback for its own routes, not for /api).
  const page = await fetch(`${base}/admin/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Lotto Admin/);
  for (const path of ['/', '/login', '/sale/3']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /Online 2D\/3D/, path);
  }
  assert.equal((await fetch(`${base}/api/nope`)).status, 401); // API paths never fall back to the app
});

test('agent slip preview (dry_run) does not save or charge', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const users = (await call('GET', '/api/users?role=user', agent)).body;
  const userId = users[0].id;
  const before = (await call('GET', `/api/users/${userId}`, agent)).body.balance;

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Preview draw', unit_price: 100, status: 'open' })).body;
  const entries = [{ bet_type_id: 0, input: '12R', units: 10 }];

  const preview = await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: userId, entries, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.gross_amount, 2000);
  assert.equal(preview.body.net_amount, 1800); // 10% 2D discount from the first test
  assert.equal(preview.body.balance_after, before - 1800);
  assert.equal(preview.body.items.length, 2);

  assert.equal((await call('GET', `/api/tickets?term_id=${term.id}`, agent)).body.length, 0);
  assert.equal((await call('GET', `/api/users/${userId}`, agent)).body.balance, before);

  // Preview applies the same rules: closed 21 is left out, 12 is kept as a plain line.
  await call('PUT', `/api/terms/${term.id}/blocked`, admin, [{ bet_type_id: 0, number: '21' }]);
  const partial = await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: userId, entries, dry_run: true });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.adjustments.map((a) => [a.number, a.reason]), [['21', 'closed']]);
  assert.deepEqual(partial.body.items.map((i) => [i.input, i.number]), [['12', '12']]);

  const listed = (await call('GET', '/api/tickets?limit=1', agent)).body[0];
  assert.ok(listed.term_description);

  for (const path of ['/agent/', '/common/js/shell.js', '/admin/']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('unlimited wallets can go negative for bets and agent hand-outs only', async () => {
  // (agents may also create users with unlimited: true)
  const admin = await login('admin', 'admin123');

  // Unlimited agent with 0 balance can still fund a user (seeded: the admin opens masters only).
  const agentRes = { body: await seedAccount({ username: 'agentinf', password: 'agent123', role: 'agent', name: 'Unlimited Agent', unlimited: true }) };
  assert.equal(agentRes.body.unlimited, 1);
  const agent = await login('agentinf', 'agent123');

  // Agents cannot change their own setting, or other agents' users.
  assert.equal((await call('PATCH', `/api/users/${agentRes.body.id}`, agent, { unlimited: false })).status, 403);
  const otherUser = (await call('GET', '/api/users?role=user', admin)).body.find((u) => u.parent_id !== agentRes.body.id);
  assert.equal((await call('PATCH', `/api/users/${otherUser.id}`, agent, { unlimited: true })).status, 404);

  const user = (await call('POST', '/api/users', agent, { username: 'credituser', password: 'user123', role: 'user', name: 'Credit User' })).body;
  assert.equal((await call('POST', '/api/wallet/deposit', agent, { user_id: user.id, amount: 5000 })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', agent)).body.balance, -5000);

  // A limited user cannot overspend; after admin makes them unlimited they can.
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Credit draw', game: '3D', unit_price: 1000, status: 'open' })).body;
  const bigBet = { term_id: term.id, user_id: user.id, entries: [{ bet_type_id: 1, input: '777', units: 10 }] }; // 10,000
  const preview = (await call('POST', '/api/tickets', agent, { ...bigBet, dry_run: true })).body;
  assert.equal(preview.sufficient, false);
  assert.equal((await call('POST', '/api/tickets', agent, bigBet)).status, 400);

  // The agent turns unlimited on for their own user.
  assert.equal((await call('PATCH', `/api/users/${user.id}`, agent, { unlimited: true })).body.unlimited, 1);
  assert.equal((await call('POST', '/api/tickets', agent, { ...bigBet, dry_run: true })).body.sufficient, true);
  assert.equal((await call('POST', '/api/tickets', agent, bigBet)).status, 201);
  assert.equal((await call('GET', `/api/users/${user.id}`, agent)).body.balance, -5000);

  // Cancelling a slip refunds it even when the balance stays negative afterwards (-15,000 -> -5,000).
  const second = (await call('POST', '/api/tickets', agent, bigBet)).body;
  const cancelled = await call('POST', `/api/tickets/${second.id}/cancel`, admin);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal((await call('GET', `/api/users/${user.id}`, agent)).body.balance, -5000);

  // Withdrawals never use credit, and unlimited cannot be removed while negative.
  assert.equal((await call('POST', '/api/wallet/withdraw', agent, { user_id: user.id, amount: 1 })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${user.id}`, admin, { unlimited: false })).status, 400);
});

test('agents can create users with unlimited wallets', async () => {
  const agent = await login('agentinf', 'agent123');
  const res = await call('POST', '/api/users', agent, { username: 'infuser2', password: 'user123', role: 'user', name: 'Credit 2', unlimited: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.unlimited, 1);
});

test('entries may carry an explicit pattern expansion (POS patterns)', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agentinf', 'agent123');
  const user = (await call('GET', '/api/users?role=user', agent)).body[0];
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Pattern draw', game: '2D', unit_price: 100, status: 'open' })).body;
  const term3 = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Pattern draw 3D', game: '3D', unit_price: 100, status: 'open' })).body;

  // "1P" = 19 numbers, sent expanded by the client; label kept on the group.
  const onePower = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '01', '21', '31', '41', '51', '61', '71', '81', '91'];
  const t = await call('POST', '/api/tickets', agent, {
    term_id: term.id, user_id: user.id,
    entries: [{ bet_type_id: 0, input: '1P', numbers: onePower, units: 2 }],
  });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.items.length, 19);
  assert.equal(t.body.gross_amount, 19 * 2 * 100);
  assert.deepEqual(t.body.groups.map((g) => g.input), ['1P']);
  const t3 = await call('POST', '/api/tickets', agent, {
    term_id: term3.id, user_id: user.id, entries: [{ bet_type_id: 1, input: '12*', numbers: ['120', '121'], units: 1 }],
  });
  assert.equal(t3.status, 201, JSON.stringify(t3.body));
  assert.deepEqual(t3.body.groups.map((g) => g.input), ['12*']);

  // Numbers are still validated against the bet type, and closed numbers still apply.
  const bad = await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: user.id, dry_run: true, entries: [{ bet_type_id: 0, input: 'SS', numbers: ['00', '123'], units: 1 }] });
  assert.equal(bad.status, 400);
  await call('PUT', `/api/terms/${term.id}/blocked`, admin, [{ bet_type_id: 0, number: '22' }]);
  const blocked = await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: user.id, dry_run: true, entries: [{ bet_type_id: 0, input: 'SS', numbers: ['00', '22'], units: 1 }] });
  assert.equal(blocked.status, 200);
  assert.deepEqual(blocked.body.adjustments.map((a) => [a.number, a.reason]), [['22', 'closed']]);
  assert.deepEqual(blocked.body.items.map((i) => [i.input, i.number]), [['00', '00']]); // no longer the SS group
});

test('unit per number: per user, per term (never above the unit break)', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const userId = (await call('GET', '/api/auth/me', user)).body.id;
  const agentId = (await call('GET', '/api/auth/me', agent)).body.id;

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Limit draw', game: '2D', unit_price: 100, status: 'open' })).body;
  const other = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Other draw', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 50 }]);
  const setLimits = (rows, who = admin, t = term) => call('PUT', `/api/terms/${t.id}/user-limits`, who, rows);

  // Above the term's unit break -> rejected; within it -> saved. Admin only; user accounts only;
  // the bet type must fit the term (a 2D term takes no 3D limit).
  const tooHigh = await setLimits([{ user_id: userId, bet_type_id: 0, max_units: 60 }]);
  assert.equal(tooHigh.status, 400);
  assert.match(tooHigh.body.error, /unit break \(50\)/);
  assert.equal((await setLimits([{ user_id: userId, bet_type_id: 0, max_units: 20 }], agent)).status, 403);
  assert.equal((await setLimits([{ user_id: agentId, bet_type_id: 0, max_units: 20 }])).status, 400);
  assert.equal((await setLimits([{ user_id: userId, bet_type_id: 1, max_units: 20 }])).status, 400);
  const saved = await setLimits([{ user_id: userId, bet_type_id: 0, max_units: 20 }]);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.map((r) => [r.username, r.max_units]), [['user1', 20]]);
  assert.equal((await call('GET', `/api/terms/${term.id}/user-limits`, admin)).body.length, 1);
  // The customer page no longer carries limits.
  assert.equal((await call('PUT', `/api/users/${userId}/number-limits`, admin, [])).status, 404);
  assert.equal((await call('GET', `/api/users/${userId}`, admin)).body.number_limits, undefined);

  const bet = (input, units, t = term) => call('POST', '/api/tickets', user, { term_id: t.id, entries: [{ bet_type_id: 0, input, units }] });
  assert.equal((await bet('12', 15)).status, 201);
  const over = await bet('12', 6); // 15 + 6 > 20: only the 5 left are saved
  assert.equal(over.status, 201);
  assert.deepEqual(over.body.adjustments.map((a) => [a.number, a.requested, a.saved, a.reason]), [['12', 6, 5, 'max_unit']]);
  assert.equal((await bet('12', 1)).status, 400); // nothing left at all -> nothing to save
  assert.equal((await bet('21', 20)).status, 201); // limit is per number

  // Several lines of ONE slip that hit the same number add up too: 56 x15 + 56R x6 -> 56 gets
  // only 5 more; 56R is then saved as plain lines (56 x5, 65 x6).
  const overInOne = await call('POST', '/api/tickets', user, {
    term_id: term.id, entries: [{ bet_type_id: 0, input: '56', units: 15 }, { bet_type_id: 0, input: '56R', units: 6 }],
  });
  assert.equal(overInOne.status, 201);
  assert.deepEqual(overInOne.body.adjustments.map((a) => [a.number, a.saved, a.reason]), [['56', 5, 'max_unit']]);
  assert.deepEqual(overInOne.body.groups, []);
  assert.equal((await bet('56', 1)).status, 400); // ...and they count against later slips

  // A cancelled slip frees its units again.
  const t = await bet('34', 20);
  await call('POST', `/api/tickets/${t.body.id}/cancel`, agent);
  assert.equal((await bet('34', 20)).status, 201);

  // The limit belongs to this term only: another term has no own limit for this user.
  assert.equal((await bet('12', 30, other)).status, 201);

  // Without an own limit, only the unit break applies (12 has 20 of 50 used).
  assert.deepEqual((await setLimits([])).body, []);
  assert.equal((await bet('12', 30)).status, 201);
  assert.equal((await bet('12', 1)).status, 400);
});

test('hot numbers: topped up to the user hot % of their whole stake in the term', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const userId = (await call('GET', '/api/auth/me', user)).body.id;
  const adminId = (await call('GET', '/api/auth/me', admin)).body.id;

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Hot draw', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 100 }]);
  const setHot = (body, who = admin) => call('PUT', `/api/terms/${term.id}/hot`, who, body);
  const hot45 = [{ bet_type_id: 0, number: '45' }];

  // Admin only; percent 0-100; the bet type must fit the term; per-user %s for user accounts, once each.
  assert.equal((await setHot({ percent: 10, numbers: [] }, agent)).status, 403);
  assert.equal((await setHot({ percent: 150, numbers: [] })).status, 400);
  assert.equal((await setHot({ percent: 10, numbers: [{ bet_type_id: 1, number: '123' }] })).status, 400);
  assert.equal((await setHot({ percent: 10, numbers: [], users: [{ user_id: adminId, percent: 5 }] })).status, 400);
  assert.equal((await setHot({ percent: 10, numbers: [], users: [{ user_id: userId, percent: 5 }, { user_id: userId, percent: 6 }] })).status, 400);
  assert.equal((await setHot({ percent: 10, numbers: hot45 })).status, 200);
  const saved = (await call('GET', `/api/terms/${term.id}`, admin)).body;
  assert.equal(saved.hot_percent, 10);
  assert.deepEqual(saved.hot, hot45);
  assert.deepEqual(saved.hot_users, []);

  const slip = (...entries) => call('POST', '/api/tickets', user, {
    term_id: term.id, entries: entries.map(([input, units]) => ({ bet_type_id: 0, input, units })),
  });
  const adj = (r) => r.body.adjustments.map((x) => [x.number, x.requested, x.saved, x.reason]);
  // Default 10% of the whole stake (earlier slips + this slip): 290 units -> 45 may hold 29; 46 keeps its 90.
  const first = await slip(['46', 90], ['45', 200]);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.deepEqual(adj(first), [['45', 200, 29, 'hot']]);
  assert.deepEqual(first.body.items.map((i) => [i.number, i.units]).sort(), [['45', 29], ['46', 90]]);

  // This user gets 20%: stake 119 + 200 = 319 -> quota 63; already holds 29 on 45, so 34 more.
  assert.equal((await setHot({ percent: 10, numbers: hot45, users: [{ user_id: userId, percent: 20 }] })).status, 200);
  assert.deepEqual((await call('GET', `/api/terms/${term.id}`, admin)).body.hot_users.map((u) => [u.user_id, u.percent]), [[userId, 20]]);
  assert.deepEqual((await call('GET', `/api/terms/${term.id}`, user)).body.hot_users.map((u) => u.percent), [20]); // own row only
  assert.deepEqual((await call('GET', `/api/terms/${term.id}`, agent)).body.hot_users, []);
  assert.deepEqual(adj(await slip(['45', 200])), [['45', 200, 34, 'hot']]);

  // Quota full: 45R x80 -> stake 153 + 160 = 313 -> quota 62, 45 already holds 63, so 45 is left out
  // and 54 x80 is saved as a plain line.
  const group = await slip(['45R', 80]);
  assert.deepEqual(group.body.groups, []);
  assert.deepEqual(adj(group), [['45', 80, 0, 'hot']]);
  assert.deepEqual(group.body.items.map((i) => [i.number, i.units]).sort(), [['54', 80]]);
  // The break (100) still caps: 54 has 80, so 54 x50 saves 20.
  assert.deepEqual(adj(await slip(['54', 50])), [['54', 50, 20, 'break']]);
  // More stake opens room again: 253 + 150 = 403 -> quota 80, 45 holds 63 -> 17 more.
  assert.deepEqual(adj(await slip(['47', 100], ['45', 50])), [['45', 50, 17, 'hot']]);

  // 0% leaves a hot number out; a slip with nothing left is refused.
  await setHot({ percent: 0, numbers: [{ bet_type_id: 0, number: '77' }] });
  assert.match((await slip(['77', 1])).body.error, /Nothing to save/);
  assert.deepEqual(adj(await slip(['77', 5], ['78', 5])), [['77', 5, 0, 'hot']]);
  // Clearing the list lifts the cap.
  await setHot({ percent: 0, numbers: [] });
  assert.deepEqual(adj(await slip(['77', 1])), []);
});

test('delete term: with slips a backup comes first (any status); active slips refunded; wallet history kept', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const balance = async () => (await call('GET', '/api/auth/me', user)).body.balance;
  const history = async () => (await call('GET', '/api/wallet/transactions', user)).body.length;

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Delete me', game: '2D', unit_price: 100, status: 'open' })).body;
  const before = await balance();
  const slip = await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '12', units: 3 }] });
  assert.equal(slip.status, 201);
  assert.equal(await balance(), before - slip.body.net_amount);

  // Agents cannot delete at all.
  assert.equal((await call('DELETE', `/api/terms/${term.id}`, agent)).status, 403);

  // An Excel backup of this term comes first; a backup of another term (or of everything) won't do.
  const exportTerm = async (termId) => (await fetch(`${base}/api/sales-data/export.xlsx${termId ? `?term_id=${termId}` : ''}`,
    { headers: { authorization: `Bearer ${admin}` } })).headers.get('x-export-token');
  assert.match((await call('DELETE', `/api/terms/${term.id}`, admin)).body.error, /Excel backup/);
  const everything = await exportTerm(null);
  assert.equal((await call('DELETE', `/api/terms/${term.id}`, admin, { export_token: everything })).status, 400);
  const token = await exportTerm(term.id);

  const txBefore = await history();
  const del = await call('DELETE', `/api/terms/${term.id}`, admin, { export_token: token });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.slips, 1);
  assert.equal(del.body.refunded, slip.body.net_amount);
  assert.equal(await balance(), before); // refunded
  assert.equal(await history(), txBefore + 1); // bet row kept, refund row added
  assert.equal((await call('GET', `/api/terms/${term.id}`, admin)).status, 404);
  assert.equal((await call('GET', `/api/tickets/${slip.body.id}`, admin)).status, 404);

  // New terms open straight away; draft / cancel are no longer accepted.
  const fresh = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'No draft', game: '2D' })).body;
  assert.equal(fresh.status, 'open');
  assert.equal((await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Draft', status: 'draft' })).status, 400);
  assert.equal((await call('PATCH', `/api/terms/${fresh.id}`, admin, { status: 'cancelled' })).status, 400);
});

test('admin accounts: add, edit, own profile and password', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');

  // The admin no longer opens further admins. boss2 is seeded so the profile checks still run.
  assert.equal((await call('POST', '/api/users', agent, { username: 'boss2', password: 'boss123', role: 'admin', name: 'X' })).status, 403);
  assert.equal((await call('POST', '/api/users', admin, { username: 'boss2', password: 'boss123', role: 'admin', name: 'Second Admin' })).status, 403);
  const created = { body: await seedAccount({ username: 'boss2', password: 'boss123', role: 'admin', name: 'Second Admin', parent_id: null }) };
  assert.equal(created.body.parent_id, null);
  assert.ok((await call('GET', '/api/users?role=admin', admin)).body.some((u) => u.username === 'boss2'));

  // Another admin can edit, reset the password of and suspend it.
  assert.equal((await call('PATCH', `/api/users/${created.body.id}`, admin, { name: 'Admin Two', password: 'reset123' })).body.name, 'Admin Two');
  const boss = await login('boss2', 'reset123');
  assert.ok(boss);

  // Own profile: may change name/phone and own password (needs the current one), not own status.
  const me = (await call('GET', '/api/auth/me', boss)).body;
  assert.equal((await call('PATCH', `/api/users/${me.id}`, boss, { phone: '09123' })).body.phone, '09123');
  assert.equal((await call('PATCH', `/api/users/${me.id}`, boss, { status: 'suspended' })).status, 403);
  assert.equal((await call('POST', '/api/auth/change-password', boss, { current_password: 'wrong1', new_password: 'newpass1' })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', boss, { current_password: 'reset123', new_password: 'newpass1' })).status, 200);
  assert.ok(await login('boss2', 'newpass1'));

  assert.equal((await call('PATCH', `/api/users/${created.body.id}`, admin, { status: 'suspended' })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', null, { username: 'boss2', password: 'newpass1' })).status, 403);
});

test('uplines give users any admin-made prize set; masters and agents are not assigned one', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const userId = (await call('GET', '/api/auth/me', user)).body.id;
  const agentId = (await call('GET', '/api/auth/me', agent)).body.id;
  const rates = (m2, m3) => [{ bet_type_id: 0, multiplier: m2, discount: -1 }, { bet_type_id: 1, multiplier: m3, discount: -1 }];

  const low = (await call('POST', '/api/prize-sets', admin, { name: 'Low odds', copy_from: 0 })).body;
  await call('PUT', `/api/prize-sets/${low.id}/rates`, admin, rates(70, 500));
  const high = (await call('POST', '/api/prize-sets', admin, { name: 'High odds', copy_from: 0 })).body;
  await call('PUT', `/api/prize-sets/${high.id}/rates`, admin, rates(90, 550));

  // Agents cannot make or change prize sets...
  assert.equal((await call('POST', '/api/prize-sets', agent, { name: 'Mine' })).status, 403);
  assert.equal((await call('PUT', `/api/prize-sets/${low.id}/rates`, agent, rates(60, 500))).status, 403);
  assert.equal((await call('DELETE', `/api/prize-sets/${low.id}`, agent)).status, 403);
  // ...but they see every admin-made set and may give any of them to a user.
  const visible = (await call('GET', '/api/prize-sets', agent)).body.map((s) => s.id);
  assert.ok(visible.includes(0) && visible.includes(low.id) && visible.includes(high.id));
  assert.equal((await call('PATCH', `/api/users/${agentId}`, admin, { prize_set_id: high.id })).status, 400);

  assert.equal((await call('PATCH', `/api/users/${userId}`, agent, { prize_set_id: high.id })).body.prize_set_id, high.id);
  assert.equal((await call('PATCH', `/api/users/${userId}`, agent, { prize_set_id: low.id })).body.prize_set_id, low.id);
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Agent odds draw', game: '2D', unit_price: 100, status: 'open' })).body;
  const preview = (await call('POST', '/api/tickets', user, { term_id: term.id, dry_run: true, entries: [{ bet_type_id: 0, input: '88', units: 1 }] })).body;
  assert.equal(preview.items[0].multiplier, 70);
  assert.equal((await call('GET', '/api/prize-sets', agent)).body.find((s) => s.id === low.id).user_count, 1);

  const created = await call('POST', '/api/users', agent, { username: 'oddsuser', password: 'user123', role: 'user', name: 'Odds', prize_set_id: high.id });
  assert.equal(created.body.prize_set_id, high.id);
  assert.equal((await call('PATCH', `/api/users/${userId}`, agent, { prize_set_id: high.id })).body.prize_set_id, high.id);
  assert.equal((await call('PATCH', `/api/users/${userId}`, admin, { prize_set_id: high.id })).status, 403);

  await call('PATCH', `/api/users/${userId}`, agent, { prize_set_id: 0 });
});

test('Twod: 3D neighbours and other orderings win at the twod multiplier', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');

  // Default set: 3D x550, Twod x10 (default).
  assert.equal((await call('GET', '/api/prize-sets', admin)).body.find((s) => s.id === 0).twod_multiplier, 10);
  assert.equal((await call('PATCH', '/api/prize-sets/0', admin, { twod_multiplier: 12 })).body.twod_multiplier, 12);

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Twod draw', game: '3D', unit_price: 100, status: 'open' })).body;
  const bet = (input, units) => call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 1, input, units }] });
  const exact = (await bet('640', 1)).body;   // exact  -> 1 * 100 * 550 = 55,000
  const perm = (await bet('604', 2)).body;    // twod   -> 2 * 100 * 12  =  2,400
  const next = (await bet('641', 1)).body;    // twod   -> 1 * 100 * 12  =  1,200
  const miss = (await bet('642', 1)).body;    // no win
  assert.equal(exact.items[0].twod_multiplier, 12);

  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  const settled = (await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 1, value: '640' }])).body;
  assert.equal(settled.payout, 55000 + 2400 + 1200);

  const status = async (t) => (await call('GET', `/api/tickets/${t.id}`, user)).body;
  assert.equal((await status(exact)).win_amount, 55000);
  assert.equal((await status(perm)).win_amount, 2400);
  assert.equal((await status(next)).win_amount, 1200);
  assert.equal((await status(miss)).status, 'lost');

  const richTwod = (await call('POST', '/api/prize-sets', admin, { name: 'Rich twod', copy_from: 0, twod_multiplier: 20 })).body;
  const agent = await login('agent1', 'agent123');
  assert.ok((await call('GET', '/api/prize-sets', agent)).body.some((s) => s.id === richTwod.id));
  await call('DELETE', `/api/prize-sets/${richTwod.id}`, admin);
  await call('PATCH', '/api/prize-sets/0', admin, { twod_multiplier: 10 });
});

test('win numbers list: drawn/settled terms with their results, for any signed-in account', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Results list 2D', game: '2D', unit_price: 100, status: 'closed' })).body;
  await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '47' }]);
  await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Not drawn yet', game: '2D', status: 'open' });

  const all2d = await call('GET', '/api/terms/results?game=2D', user);
  assert.equal(all2d.status, 200);
  assert.ok(all2d.body.every((t) => t.game === '2D' && ['drawn', 'settled'].includes(t.status)));
  const mine = all2d.body.find((t) => t.id === term.id);
  assert.deepEqual(mine.results, [{ slot: 2, value: '47' }]);
  assert.ok(!all2d.body.some((t) => t.description === 'Not drawn yet'));
  assert.ok((await call('GET', '/api/terms/results?game=3D', user)).body.every((t) => t.game === '3D'));
  assert.equal((await fetch(`${base}/api/terms/results`)).status, 401);
});

test('my reports: a user sees only their own totals per term', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'My report 2D', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '11', units: 2 }] });
  await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '22', units: 3 }] });
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '22' }]);

  const rows = (await call('GET', '/api/reports/mine?game=2D', user)).body;
  const row = rows.find((r) => r.term_id === term.id);
  // 2 + 3 units x 100 = 500 gross, 10% 2D discount -> 450 net; 22 x3 wins 3 * 100 * 80 = 24,000.
  assert.deepEqual([row.tickets, row.gross, row.discount, row.net, row.win, row.result], [2, 500, 50, 450, 24000, 23550]);
  assert.ok(rows.every((r) => r.game === '2D'));
  // Other users' bets never show up.
  const other = await login('agentinf', 'agent123');
  assert.equal((await call('GET', '/api/reports/mine', other)).body.length, 0);
});

test('slip print counter (Copy n) for the slip owner only', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Print copy draw', game: '2D', unit_price: 100, status: 'open' })).body;
  const t = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '33', units: 1 }] })).body;
  assert.equal(t.print_count, 0);
  assert.equal((await call('POST', `/api/tickets/${t.id}/print`, user)).body.print_count, 1);
  assert.equal((await call('POST', `/api/tickets/${t.id}/print`, user)).body.print_count, 2);
  assert.equal((await call('GET', `/api/tickets/${t.id}`, user)).body.print_count, 2);
  const stranger = await login('credituser', 'user123');
  assert.equal((await call('POST', `/api/tickets/${t.id}/print`, stranger)).status, 404);
});

test('live updates: signed-in clients hear about term changes over WebSocket', async () => {
  const admin = await login('admin', 'admin123');
  const wsBase = base.replace('http', 'ws');
  const open = (url) => new Promise((resolve) => {
    const ws = new WebSocket(url);
    const messages = [];
    ws.onmessage = (e) => messages.push(JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, messages });
    ws.onclose = (e) => resolve({ ws, messages, closed: e.code });
  });

  // No or bad token: the server closes the socket.
  const bad = await open(`${wsBase}/ws?token=nope`);
  const closed = bad.closed ?? await new Promise((r) => { bad.ws.onclose = (e) => r(e.code); });
  assert.equal(closed, 4401);

  const client = await open(`${wsBase}/ws?token=${admin}`);
  await new Promise((r) => setTimeout(r, 100)); // token check finishes
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Live term', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Bad', game: '2D3D' }); // rejected: no notice
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(client.messages.map((m) => m.type), ['terms', 'terms']);
  client.ws.close();
});

test('full numbers: only numbers at the unit break, for any signed-in account', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Full draw', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 5 }]);
  const bet = (input, units) => call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input, units }] });
  assert.equal((await bet('12', 5)).status, 201); // full
  assert.equal((await bet('34', 4)).status, 201); // not full
  const full = await call('GET', `/api/terms/${term.id}/full-numbers`, user);
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.map((r) => [r.number, r.units, r.max_units]), [['12', 5, 5]]);
});

test('wallet requests: users ask to deposit/withdraw, their agent approves or rejects (not the admin)', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const other = await login('agentinf', 'agent123');
  const user = await login('user1', 'user123');
  const me = async (token) => (await call('GET', '/api/auth/me', token)).body.balance;
  const ask = (body) => call('POST', '/api/wallet-requests', user, body);

  const userBefore = await me(user);
  const agentBefore = await me(agent);

  // Deposit request -> pending; only the user's own agent (or a master above it) can decide it.
  const dep = await ask({ type: 'deposit', amount: 1000, method: 'KPay', account_name: 'U One', account_no: '0911', txn_ref: 'TX1' });
  assert.equal(dep.status, 201);
  assert.equal(dep.body.status, 'pending');
  assert.equal((await ask({ type: 'deposit', amount: 5, method: 'Bitcoin' })).status, 400);
  assert.equal((await call('POST', `/api/wallet-requests/${dep.body.id}/approve`, user)).status, 403);
  assert.equal((await call('POST', `/api/wallet-requests/${dep.body.id}/approve`, other)).status, 404);
  assert.equal((await call('GET', '/api/wallet-requests/pending-count', agent)).body.count, 1);
  const ok = await call('POST', `/api/wallet-requests/${dep.body.id}/approve`, agent);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
  assert.equal(await me(user), userBefore + 1000);
  assert.equal(await me(agent), agentBefore - 1000); // agent hands out from own balance
  assert.equal((await call('POST', `/api/wallet-requests/${dep.body.id}/approve`, agent)).status, 400); // once only

  // Withdraw: needs an account, can't exceed the balance (pending withdrawals included).
  const balance = await me(user);
  assert.equal((await ask({ type: 'withdraw', amount: 100, method: 'WavePay' })).status, 400);
  assert.equal((await ask({ type: 'withdraw', amount: balance + 1, method: 'WavePay', account_no: '0922' })).status, 400);
  const wd = await ask({ type: 'withdraw', amount: balance - 10, method: 'WavePay', account_no: '0922' });
  assert.equal(wd.status, 201);
  assert.equal((await ask({ type: 'withdraw', amount: 20, method: 'WavePay', account_no: '0922' })).status, 400);
  const rej = await call('POST', `/api/wallet-requests/${wd.body.id}/reject`, agent, { reason: 'wrong account' });
  assert.equal(rej.body.status, 'rejected');
  assert.equal(rej.body.reject_reason, 'wrong account');
  assert.equal(await me(user), balance); // nothing moved

  // The admin reads this list but decides nothing: the master / agent above the account does.
  const wd2 = await ask({ type: 'withdraw', amount: 300, method: 'Cash', account_no: 'shop' });
  assert.equal((await call('POST', `/api/wallet-requests/${wd2.body.id}/approve`, admin)).status, 403);
  assert.equal((await call('POST', `/api/wallet-requests/${wd2.body.id}/reject`, admin, { reason: 'no' })).status, 403);
  assert.ok((await call('GET', '/api/wallet-requests', admin)).body.some((r) => r.id === wd2.body.id)); // history only
  assert.equal((await call('POST', `/api/wallet-requests/${wd2.body.id}/approve`, agent)).status, 200);
  assert.equal(await me(user), balance - 300);

  // The user can cancel their own pending request.
  const c = await ask({ type: 'deposit', amount: 50, method: 'Cash' });
  assert.equal((await call('POST', `/api/wallet-requests/${c.body.id}/cancel`, user)).body.status, 'cancelled');
  assert.equal((await call('POST', `/api/wallet-requests/${c.body.id}/approve`, agent)).status, 400);

  const mine = (await call('GET', '/api/wallet-requests', user)).body;
  assert.deepEqual(mine.map((r) => r.status), ['cancelled', 'approved', 'rejected', 'approved']);
  assert.equal((await call('GET', '/api/wallet-requests', other)).body.length, 0);
});

test('term folders: create, file terms, rename, delete unfiles', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');

  const folder = await call('POST', '/api/term-folders', admin, { name: 'October 2026' });
  assert.equal(folder.status, 201);
  assert.equal(folder.body.term_count, 0);
  assert.equal((await call('POST', '/api/term-folders', admin, { name: 'October 2026' })).status, 400);
  // A master or an agent reads the folder list (its term list shows each term's ဖိုင်); changing
  // folders, like every other အပါတ်စဥ် setting, is the admin's alone.
  assert.equal((await call('GET', '/api/term-folders', agent)).status, 200);
  assert.equal((await call('GET', '/api/term-folders', await login('user1', 'user123'))).status, 403);
  assert.equal((await call('GET', '/api/term-folders/templates', agent)).status, 403);
  assert.equal((await call('POST', '/api/term-folders', agent, { name: 'Nope' })).status, 403);

  const a = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Folder A', folder_id: folder.body.id })).body;
  const b = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Folder B' })).body;
  assert.equal(a.folder_id, folder.body.id);
  assert.equal((await call('POST', '/api/terms', admin, { description: 'X', folder_id: 99999 })).status, 400);
  // The break can be set with the new term (2D term -> the 2D bet type only).
  const withBreak = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'With break', game: '2D', unit_break: 50 })).body;
  assert.deepEqual((await call('GET', `/api/terms/${withBreak.id}`, admin)).body.limits, [{ bet_type_id: 0, max_units: 50 }]);
  const noBreak = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'No break', unit_break: 0 })).body;
  assert.equal(noBreak.hot_percent, 10); // default hot %
  assert.deepEqual((await call('GET', `/api/terms/${noBreak.id}`, admin)).body.limits, []);
  // No folder, no term.
  assert.equal((await call('POST', '/api/terms', admin, { description: 'No folder' })).status, 400);
  assert.equal((await call('PATCH', `/api/terms/${a.id}`, admin, { folder_id: null })).status, 400);

  // Move B in, list by folder.
  assert.equal((await call('PATCH', `/api/terms/${b.id}`, admin, { folder_id: folder.body.id })).body.folder_id, folder.body.id);
  const inFolder = (await call('GET', `/api/terms?folder_id=${folder.body.id}`, admin)).body;
  assert.deepEqual(inFolder.map((t) => t.id), [b.id, a.id]);
  const listed = (await call('GET', '/api/term-folders', admin)).body.find((f) => f.id === folder.body.id);
  assert.equal(listed.term_count, 2);

  assert.equal((await call('PATCH', `/api/term-folders/${folder.body.id}`, admin, { name: 'Oct 2026' })).body.name, 'Oct 2026');

  // Open terms block folder delete; drafts with no slips can go with the folder.
  assert.match((await call('DELETE', `/api/term-folders/${folder.body.id}`, admin)).body.error, /open terms/);
  await call('PATCH', `/api/terms/${a.id}`, admin, { status: 'draft' });
  await call('PATCH', `/api/terms/${b.id}`, admin, { status: 'draft' });
  const gone = await call('DELETE', `/api/term-folders/${folder.body.id}`, admin);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.deleted_terms, 2);
  assert.ok(!(await call('GET', '/api/term-folders', admin)).body.some((f) => f.id === folder.body.id));
  assert.equal((await call('GET', `/api/terms/${a.id}`, admin)).status, 404);
  assert.equal((await call('GET', `/api/terms/${b.id}`, admin)).status, 404);
});

test('folder delete: open blocked; unsettled blocked; settled with sales allowed', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const folder = (await call('POST', '/api/term-folders', admin, { name: 'Settle then wipe' })).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'In folder', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 1 }] });
  assert.match((await call('DELETE', `/api/term-folders/${folder.id}`, admin)).body.error, /open terms/);
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  assert.match((await call('DELETE', `/api/term-folders/${folder.id}`, admin)).body.error, /settled/);
  await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '00' }]);
  assert.equal((await call('GET', `/api/terms/${term.id}`, admin)).body.status, 'settled');
  const gone = await call('DELETE', `/api/term-folders/${folder.id}`, admin);
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.deleted_terms, 1);
  assert.equal((await call('GET', `/api/terms/${term.id}`, admin)).status, 404);
});

test('a settled result can be corrected: old winnings taken back, slips settled again', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const me = async () => (await call('GET', '/api/auth/me', user)).body.balance;
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Correct me', game: '2D', unit_price: 100 })).body;
  const a = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '31', units: 1 }] })).body;
  const b = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '32', units: 2 }] })).body;
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  const start = await me();

  // Wrong result 31: slip a wins 1 * 100 * 80.
  assert.equal((await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '31' }])).body.payout, 8000);
  assert.equal(await me(), start + 8000);

  // Corrected to 32: a's 8,000 is taken back, b wins 2 * 100 * 80.
  const fixed = await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '32' }]);
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(fixed.body.corrected, true);
  assert.equal(fixed.body.payout, 16000);
  assert.equal(await me(), start + 16000);
  const slip = async (t) => (await call('GET', `/api/tickets/${t.id}`, user)).body;
  assert.deepEqual([(await slip(a)).status, (await slip(a)).win_amount], ['lost', 0]);
  assert.deepEqual([(await slip(b)).status, (await slip(b)).win_amount], ['won', 16000]);
  const detail = (await call('GET', `/api/terms/${term.id}`, admin)).body;
  assert.equal(detail.status, 'settled');
  assert.deepEqual(detail.results.map((r) => r.value), ['32']);
  const winRows = (await call('GET', '/api/reports/mine?game=2D', user)).body.find((r) => r.term_id === term.id);
  assert.equal(winRows.win, 16000);
});

test('full numbers: a number at its break is listed; raising the break opens it again', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Full numbers', game: '2D', unit_price: 100, unit_break: 2 })).body;
  const full = async () => (await call('GET', `/api/terms/${term.id}/full-numbers`, admin)).body.map((f) => f.number);

  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 2 }] })).status, 201);
  assert.deepEqual(await full(), ['45']);
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 1 }] })).status, 400);

  // Break raised from 2 to 5: 45 is no longer full and can be bet again.
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 5 }]);
  assert.deepEqual(await full(), []);
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 1 }] })).status, 201);
});

test('slip numbers run per user within each term: S-/A-/M-/G- then <username>-0001, …', async () => {
  const admin = await login('admin', 'admin123');
  const masterAcc = await seedAccount({ username: 'slipmaster', password: 'pass123', role: 'master', name: 'Slip Master' });
  const agentAcc = await seedAccount({ username: 'slipagent', password: 'pass123', role: 'agent', name: 'Slip Agent', parent_id: masterAcc.id });
  const userAcc = await seedAccount({ username: 'slipuser', password: 'pass123', role: 'user', name: 'Slip User', parent_id: agentAcc.id });
  await fund(userAcc.id, 50000);
  const master = await login('slipmaster', 'pass123');
  const agent = await login('slipagent', 'pass123');
  const user = await login('slipuser', 'pass123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Slip numbers', game: '2D', unit_price: 100 })).body;
  const other = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Slip numbers 2', game: '2D', unit_price: 100 })).body;
  const next = async (termId, who = user) => (await call('GET', `/api/tickets/next-slip?term_id=${termId}&user_id=${userAcc.id}`, who)).body.slip_no;
  const bet = async (termId) => (await call('POST', '/api/tickets', user, { term_id: termId, entries: [{ bet_type_id: 0, input: '10', units: 1 }] })).body;

  assert.equal(await next(term.id), 'S-slipuser-0001');
  assert.equal((await bet(term.id)).slip_no, 'S-slipuser-0001');
  assert.equal(await next(term.id), 'S-slipuser-0002');
  assert.equal((await bet(term.id)).slip_no, 'S-slipuser-0002');
  assert.equal((await call('POST', '/api/tickets', admin, { term_id: term.id, user_id: userAcc.id, entries: [{ bet_type_id: 0, input: '11', units: 1 }] })).body.slip_no, 'A-slipuser-0003');
  assert.equal((await call('POST', '/api/tickets', master, { term_id: term.id, user_id: userAcc.id, entries: [{ bet_type_id: 0, input: '12', units: 1 }] })).body.slip_no, 'M-slipuser-0004');
  assert.equal((await call('POST', '/api/tickets', agent, { term_id: term.id, user_id: userAcc.id, entries: [{ bet_type_id: 0, input: '13', units: 1 }] })).body.slip_no, 'G-slipuser-0005');
  // Every term starts again at 0001.
  assert.equal(await next(other.id), 'S-slipuser-0001');
  assert.equal((await bet(other.id)).slip_no, 'S-slipuser-0001');
});

test('slip delete requests: the user asks, an upline approval cancels and refunds', async () => {
  const admin = await login('admin', 'admin123');
  const agentAcc = await seedAccount({ username: 'delagent', password: 'agent123', role: 'agent', name: 'Del Agent' });
  await fund(agentAcc.id, 100000);
  const agent = await login('delagent', 'agent123');
  const userRes = await call('POST', '/api/users', agent, { username: 'deluser', password: 'user123', role: 'user', name: 'Del User' });
  assert.equal(userRes.status, 201);
  await call('POST', '/api/wallet/deposit', agent, { user_id: userRes.body.id, amount: 20000 });
  const user = await login('deluser', 'user123');
  const balance = async () => (await call('GET', '/api/auth/me', user)).body.balance;
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Delete requests', game: '2D', unit_price: 100 })).body;
  const slip = async () => (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '30', units: 2 }] })).body;

  const a = await slip();
  const before = await balance();
  const req1 = await call('POST', '/api/slip-cancel-requests', user, { ticket_id: a.id });
  assert.equal(req1.status, 201);
  assert.equal(req1.body.status, 'pending');
  assert.equal((await call('POST', '/api/slip-cancel-requests', user, { ticket_id: a.id })).status, 400); // already waiting
  assert.equal((await call('GET', `/api/tickets/${a.id}`, user)).body.status, 'active'); // not deleted yet
  assert.equal((await call('GET', `/api/tickets?term_id=${term.id}`, user)).body[0].cancel_request, 'pending');
  assert.equal((await call('GET', '/api/slip-cancel-requests?status=pending', agent)).status, 200);

  // Approve: the agent of that user cancels and refunds.
  const ok = await call('POST', `/api/slip-cancel-requests/${req1.body.id}/approve`, agent);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'approved');
  assert.equal((await call('GET', `/api/tickets/${a.id}`, user)).body.status, 'cancelled');
  assert.equal(await balance(), before + a.net_amount);

  // Reject: the slip stays and is settled like any other.
  const b = await slip();
  const req2 = (await call('POST', '/api/slip-cancel-requests', user, { ticket_id: b.id })).body;
  assert.equal((await call('POST', `/api/slip-cancel-requests/${req2.id}/reject`, admin, { reason: 'too late' })).body.status, 'rejected');
  assert.equal((await call('GET', `/api/tickets/${b.id}`, user)).body.status, 'active');
  assert.equal((await call('GET', '/api/slip-cancel-requests', user)).body.length >= 2, true);

  // After results there is nothing to delete.
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '30' }]);
  assert.equal((await call('GET', `/api/tickets/${b.id}`, user)).body.status, 'won');
  assert.equal((await call('POST', '/api/slip-cancel-requests', user, { ticket_id: b.id })).status, 400);
});

test('admin slip edit / delete: units lowered or lines removed, refunded and logged for the user', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const balance = async () => (await call('GET', '/api/auth/me', user)).body.balance;
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Slip edits', game: '2D', unit_price: 100 })).body;
  // "12R" is a group of 12 and 21, 5 units each; 40 is a plain line of 3 units. user1 has 10% off 2D.
  const t = (await call('POST', '/api/tickets', user, {
    term_id: term.id, entries: [{ bet_type_id: 0, input: '12R', units: 5 }, { bet_type_id: 0, input: '40', units: 3 }],
  })).body;
  assert.equal(t.net_amount, 1170);
  const [l12, l21, l40] = t.items;
  const before = await balance();

  // Only the admin edits, and units can only go down.
  assert.equal((await call('PATCH', `/api/tickets/${t.id}/items`, agent, { items: [{ id: l12.id, units: 1 }] })).status, 403);
  assert.equal((await call('PATCH', `/api/tickets/${t.id}/items`, admin, { items: [{ id: l12.id, units: 9 }] })).status, 400);

  // 12: 5 -> 2 and 40 removed. Left: 12×2 + 21×5 = 700 gross, 630 net; 540 refunded.
  const e = await call('PATCH', `/api/tickets/${t.id}/items`, admin, { items: [{ id: l12.id, units: 2 }, { id: l40.id, units: 0 }] });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.gross_amount, 700);
  assert.equal(e.body.net_amount, 630);
  assert.deepEqual(e.body.items.map((i) => [i.number, i.units, i.group_id === null]), [['12', 2, true], ['21', 5, true]]);
  assert.equal(e.body.groups.length, 0); // the "12R" group is gone once one of its lines changed
  assert.equal(await balance(), before + 540);

  // Removing every line cancels the slip and refunds the rest.
  const c = await call('PATCH', `/api/tickets/${t.id}/items`, admin, { items: [{ id: l12.id, units: 0 }, { id: l21.id, units: 0 }] });
  assert.equal(c.body.status, 'cancelled');
  assert.equal(c.body.items.length, 2); // lines kept so the cancelled slip can still be opened
  assert.equal(await balance(), before + 1170);
  assert.equal((await call('PATCH', `/api/tickets/${t.id}/items`, admin, { items: [{ id: l12.id, units: 0 }] })).status, 400);

  // A plain cancel is logged too.
  const t2 = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '55', units: 1 }] })).body;
  await call('POST', `/api/tickets/${t2.id}/cancel`, admin);

  // The user sees every change to their slips, newest first.
  const logs = (await call('GET', `/api/tickets/edit-logs?term_id=${term.id}`, user)).body;
  assert.deepEqual(logs.map((l) => [l.slip_no, l.action, l.net_before, l.net_after, l.refund]), [
    [t2.slip_no, 'cancel', 90, 0, 90],
    [t.slip_no, 'cancel', 630, 0, 630],
    [t.slip_no, 'edit', 1170, 630, 540],
  ]);
  assert.deepEqual(logs[2].lines.map((l) => [l.number, l.before, l.after]), [['12', 5, 2], ['40', 3, 0]]);
  assert.equal(logs[2].created_by_username, 'admin');
  // Other users see nothing of it.
  await call('POST', '/api/users', agent, { username: 'user9', password: 'user123', role: 'user', name: 'Nine' });
  assert.equal((await call('GET', '/api/tickets/edit-logs', await login('user9', 'user123'))).body.length, 0);

  // After results the slip can no longer be edited.
  const t3 = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '66', units: 1 }] })).body;
  await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '30' }]);
  assert.equal((await call('PATCH', `/api/tickets/${t3.id}/items`, admin, { items: [{ id: t3.items[0].id, units: 0 }] })).status, 400);
});

test('Live Ledger number tap: who bet on one number, with their units', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Number bets', game: '2D', unit_price: 100 })).body;
  const bet = (entries) => call('POST', '/api/tickets', user, { term_id: term.id, entries });
  await bet([{ bet_type_id: 0, input: '25', units: 3 }]);
  await bet([{ bet_type_id: 0, input: '25', units: 2 }, { bet_type_id: 0, input: '52', units: 9 }]);
  const cancelled = (await bet([{ bet_type_id: 0, input: '25', units: 50 }])).body;
  await call('POST', `/api/tickets/${cancelled.id}/cancel`, admin); // cancelled slips are left out

  const rows = (await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=25`, admin)).body;
  assert.deepEqual(rows.map((r) => [r.username, r.units, r.amount, r.slips]), [['user1', 5, 500, 2]]);
  assert.equal(rows[0].agent_username, 'agent1');
  assert.equal((await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=77`, admin)).body.length, 0);
  assert.equal((await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=25`, agent)).body.length, 1); // own user, no admin grant
  assert.equal((await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=25`, user)).status, 403);
});

// The view-only admin (users.ledger_only) is gone: no such column, and the field is ignored, so
// an admin account made with it is an ordinary full admin.
test('no view-only admins: ledger_only is gone', async () => {
  const admin = await login('admin', 'admin123');
  assert.equal((await call('POST', '/api/users', admin, { username: 'viewer', password: 'view123', role: 'admin', name: 'Viewer', ledger_only: true })).status, 403);
  await seedAccount({ username: 'viewer', password: 'view123', role: 'admin', name: 'Viewer', parent_id: null });
  const res = await call('POST', '/api/users', admin, { username: 'flagmaster', password: 'view123', role: 'master', name: 'Flag', ledger_only: true });
  assert.equal(res.status, 201);
  assert.ok(!('ledger_only' in res.body));
  const viewer = await login('viewer', 'view123');
  assert.ok(!('ledger_only' in (await call('GET', '/api/auth/me', viewer)).body));
  assert.equal((await call('GET', '/api/users', viewer)).status, 200);
});

test('whole-ledger access is admin-only for masters; own-tree ledger needs no grant', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const me = (await call('GET', '/api/auth/me', agent)).body;
  assert.equal(me.ledger_access, 0);
  assert.equal((await call('PATCH', `/api/users/${me.id}`, agent, { ledger_access: true })).status, 403);
  const userId = (await call('GET', '/api/users?role=user', admin)).body[0].id;
  assert.equal((await call('PATCH', `/api/users/${userId}`, admin, { ledger_access: true })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${me.id}`, admin, { ledger_access: true })).status, 400);
  const made = await call('POST', '/api/users', admin, { username: 'ledgerflag', password: 'xxxxxx', role: 'master', name: 'LF' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.ledger_access, 0);
  assert.equal((await call('PATCH', `/api/users/${made.body.id}`, admin, { ledger_access: true })).body.ledger_access, 1);
  assert.equal((await call('PATCH', `/api/users/${made.body.id}`, admin, { ledger_access: false })).body.ledger_access, 0);
});

test('a settled term stays in its own folder (no archive any more)', async () => {
  const admin = await login('admin', 'admin123');
  const folder = (await call('POST', '/api/term-folders', admin, { name: 'Week 42' })).body;
  const a = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'Week 42 A', game: '2D' })).body;

  await call('PATCH', `/api/terms/${a.id}`, admin, { status: 'closed' });
  const res = await call('PUT', `/api/terms/${a.id}/results`, admin, [{ slot: 2, value: '11' }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = (await call('GET', `/api/terms/${a.id}`, admin)).body;
  assert.equal(after.status, 'settled');
  assert.equal(after.folder_id, folder.id); // not moved anywhere
  // Still in the normal lists, and no "(Archived)" twin folder was made.
  assert.ok((await call('GET', '/api/terms', admin)).body.some((t) => t.id === a.id));
  const folders = (await call('GET', '/api/term-folders', admin)).body;
  assert.ok(!folders.some((f) => /\(Archived\)/.test(f.name)));
  assert.equal(folders.find((f) => f.id === folder.id).term_count, 1);
  // The archive endpoints are gone.
  assert.equal((await call('POST', `/api/terms/${a.id}/archive`, admin)).status, 404);
  assert.equal((await call('POST', `/api/term-folders/${folder.id}/unarchive`, admin)).status, 404);
});

test('auto terms: a new folder gets one term per template; empty terms delete at once', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  // 20 October next year: the dates must stay ahead of today, because a draft whose open time has
  // come opens by itself (services/auto-open.js) and these terms are expected to stay drafts.
  const year = new Date().getFullYear() + 1;
  assert.equal((await call('PUT', '/api/term-folders/templates', agent, [])).status, 403);
  assert.equal((await call('PUT', '/api/term-folders/templates', admin, [{ name: 'AM', open: '25:00', close: '11:59', draw: '12:01' }])).status, 400);
  const templates = [
    { name: 'AM', game: '2D', open: '09:30', close: '11:59', draw: '12:01' },
    { name: 'PM', game: '2D', unit_price: 50, unit_break: 10, open: '12:30', close: '16:00', draw: '16:30' },
  ];
  assert.equal((await call('PUT', '/api/term-folders/templates', admin, templates)).status, 200);
  assert.equal((await call('GET', '/api/term-folders/templates', admin)).body.length, 2);

  const folder = await call('POST', '/api/term-folders', admin, { name: 'Auto 20-10', date: `${year}-10-20`, tz: '+06:30' });
  assert.equal(folder.status, 201, JSON.stringify(folder.body));
  assert.equal(folder.body.auto_terms, 2);
  const made = (await call('GET', `/api/terms?folder_id=${folder.body.id}`, admin)).body.sort((x, y) => x.id - y.id);
  assert.deepEqual(made.map((t) => t.description), [`20-10-${year} AM`, `20-10-${year} PM`]);
  assert.equal(made[0].open_at, `${year}-10-20T03:00:00.000Z`); // 09:30 at +06:30
  assert.equal(made[1].draw_at, `${year}-10-20T10:00:00.000Z`); // 16:30 at +06:30
  assert.equal(made[0].unit_price, 1); // blank price / break default to 1
  assert.equal(made[1].unit_price, 50);
  assert.ok(made.every((t) => t.status === 'draft' && t.slip_count === 0)); // not Active yet
  const user = await login('user1', 'user123');
  assert.ok(!(await call('GET', '/api/terms', user)).body.some((t) => t.folder_id === folder.body.id)); // users don't see drafts
  const activeAt = Date.now();
  const activated = (await call('PATCH', `/api/terms/${made[1].id}`, admin, { status: 'open' })).body; // admin makes it Active
  assert.equal(activated.status, 'open');
  assert.ok(Math.abs(Date.parse(activated.open_at) - activeAt) < 60000); // opens from the moment it was made Active
  assert.ok((await call('GET', '/api/terms?status=open', user)).body.some((t) => t.id === made[1].id));
  // …and Unactive again: users no longer see it.
  assert.equal((await call('PATCH', `/api/terms/${made[1].id}`, admin, { status: 'draft' })).body.status, 'draft');
  assert.ok(!(await call('GET', '/api/terms', user)).body.some((t) => t.id === made[1].id));
  assert.equal((await call('PATCH', `/api/terms/${made[1].id}`, agent, { status: 'draft' })).status, 403);
  assert.equal((await call('GET', `/api/terms/${made[1].id}`, admin)).body.status, 'draft'); // Unactive cleared open_at: stays hidden

  // Auto Active: a draft whose open time has come opens by itself.
  const past = new Date(Date.now() - 60000).toISOString();
  const future = new Date(Date.now() + 3600000).toISOString();
  await call('PATCH', `/api/terms/${made[1].id}`, admin, { open_at: future });
  assert.equal((await call('GET', `/api/terms/${made[1].id}`, admin)).body.status, 'draft'); // not yet
  await call('PATCH', `/api/terms/${made[1].id}`, admin, { open_at: past });
  assert.ok((await call('GET', '/api/terms?status=open', user)).body.some((t) => t.id === made[1].id)); // open now
  const detail = (await call('GET', `/api/terms/${made[0].id}`, admin)).body;
  assert.ok(detail.limits.length > 0 && detail.limits.every((l) => l.max_units === 1)); // break default 1
  const pm = (await call('GET', `/api/terms/${made[1].id}`, admin)).body;
  assert.ok(pm.limits.length > 0 && pm.limits.every((l) => l.max_units === 10));

  // A date range: every template on every day, 17 … 19 Oct = 6 terms.
  const week = await call('POST', '/api/term-folders', admin, { name: 'Auto week', date: `${year}-10-17`, date_to: `${year}-10-19` });
  assert.equal(week.body.auto_terms, 6, JSON.stringify(week.body));
  const weekTerms = (await call('GET', `/api/terms?folder_id=${week.body.id}`, admin)).body.map((t) => t.description).sort();
  assert.deepEqual(weekTerms, [`17-10-${year} AM`, `17-10-${year} PM`, `18-10-${year} AM`, `18-10-${year} PM`, `19-10-${year} AM`, `19-10-${year} PM`]);
  assert.equal((await call('POST', '/api/term-folders', admin, { name: 'Backwards', date: `${year}-10-20`, date_to: `${year}-10-19` })).status, 400);

  // No auto terms when asked not to.
  const plain = await call('POST', '/api/term-folders', admin, { name: 'Auto off', date: `${year}-10-20`, auto_terms: false });
  assert.equal(plain.body.auto_terms, 0);

  // A term without slips is deleted straight away, no backup needed.
  const del = await call('DELETE', `/api/terms/${made[0].id}`, admin);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await call('GET', `/api/terms/${made[0].id}`, admin)).status, 404);
  await call('PUT', '/api/term-folders/templates', admin, []);
});

test('ငွေရှင်း: per settled term, the admin marks users / agents settled up; users see it in their report', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const me = (await call('GET', '/api/auth/me', user)).body;
  const agentMe = (await call('GET', '/api/auth/me', agent)).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Clear me', game: '2D', unit_price: 100 })).body;
  const slip = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 2 }] })).body;

  assert.equal((await call('POST', `/api/terms/${term.id}/clearing`, admin, { account_ids: [me.id] })).status, 400); // not settled yet
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  assert.equal((await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '45' }])).status, 200);

  const view = (await call('GET', `/api/terms/${term.id}/clearing`, admin)).body;
  const urow = view.users.find((r) => r.account_id === me.id);
  const arow = view.agents.find((r) => r.account_id === agentMe.id);
  assert.ok(urow && arow);
  assert.equal(urow.net, slip.net_amount);
  assert.ok(urow.win > 0);
  assert.equal(urow.balance, urow.net - urow.win);
  assert.equal(arow.net, urow.net); // the agent's row adds up its users
  assert.equal(urow.cleared, false);
  assert.equal((await call('GET', `/api/terms/${term.id}/clearing`, agent)).status, 403);

  assert.equal((await call('POST', `/api/terms/${term.id}/clearing`, admin, { account_ids: [me.id, agentMe.id] })).body.cleared, 2);
  const after = (await call('GET', `/api/terms/${term.id}/clearing`, admin)).body;
  assert.ok(after.users.find((r) => r.account_id === me.id).cleared);
  assert.ok(after.agents.find((r) => r.account_id === agentMe.id).cleared);

  // The user's report marks it, and ?cleared=1 lists only cleared terms.
  const mine = (await call('GET', '/api/reports/mine', user)).body.find((r) => r.term_id === term.id);
  assert.ok(mine.cleared_at);
  assert.ok((await call('GET', '/api/reports/mine?cleared=1', user)).body.every((r) => r.cleared_at));
  assert.ok((await call('GET', '/api/reports/mine?cleared=0', user)).body.every((r) => !r.cleared_at));

  // Undo.
  assert.equal((await call('DELETE', `/api/terms/${term.id}/clearing/${me.id}`, admin)).status, 200);
  assert.ok(!(await call('GET', '/api/reports/mine', user)).body.find((r) => r.term_id === term.id).cleared_at);
});

// Account levels: admin (superadmin) > master > agent > user. A master runs its own tree — the
// accounts under it, their money and their slips — but the term itself and its break stay with the
// admin. Money flows down the chain hop by hop and ငွေလက်ခံ requests run back up it.
test('master level: its own tree of accounts, money and slips; the term stays with the admin', async () => {
  const admin = await login('admin', 'admin123');
  const agent1 = await login('agent1', 'agent123'); // another tree, straight under the admin
  const bal = async (token) => (await call('GET', '/api/auth/me', token)).body.balance;
  const seen = async (token) => (await call('GET', '/api/users', token)).body.map((u) => u.username).sort();

  // --- accounts -------------------------------------------------------------
  const m = await call('POST', '/api/users', admin, { username: 'master1', password: 'master123', role: 'master', name: 'Master One' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.equal(m.body.role, 'master');
  assert.equal(m.body.parent_id, 1); // under the admin
  const master = await login('master1', 'master123');

  // A master creates agents and users, never another master or an admin.
  const ag = await call('POST', '/api/users', master, { username: 'magent', password: 'xxxxxx', role: 'agent', name: 'M Agent' });
  assert.equal(ag.status, 201, JSON.stringify(ag.body));
  assert.equal(ag.body.parent_id, m.body.id);
  const magent = await login('magent', 'xxxxxx');
  assert.equal((await call('POST', '/api/users', master, { username: 'master2', password: 'xxxxxx', role: 'master', name: 'X' })).status, 403);
  assert.equal((await call('POST', '/api/users', master, { username: 'admin2', password: 'xxxxxx', role: 'admin', name: 'X' })).status, 403);
  assert.equal((await call('POST', '/api/users', magent, { username: 'agent9', password: 'xxxxxx', role: 'agent', name: 'X' })).status, 403);

  // One user under the master's agent (parent_id names it), one straight under the master.
  const deep = await call('POST', '/api/users', master, { username: 'muser', password: 'xxxxxx', role: 'user', name: 'M User', parent_id: ag.body.id });
  assert.equal(deep.status, 201, JSON.stringify(deep.body));
  assert.equal(deep.body.parent_id, ag.body.id);
  const direct = await call('POST', '/api/users', master, { username: 'mdirect', password: 'xxxxxx', role: 'user', name: 'M Direct' });
  assert.equal(direct.body.parent_id, m.body.id);
  // A user may not hang under another user.
  assert.equal((await call('POST', '/api/users', master, { username: 'mbad', password: 'xxxxxx', role: 'user', name: 'X', parent_id: deep.body.id })).status, 400);

  // Scope: the master sees its whole tree however deep, its agent only itself and its own user.
  assert.deepEqual(await seen(master), ['magent', 'master1', 'mdirect', 'muser']);
  assert.deepEqual(await seen(magent), ['magent', 'muser']);
  assert.equal((await call('GET', `/api/users/${deep.body.id}`, master)).status, 200); // two levels down
  // The other tree is out of reach both ways.
  assert.ok(!(await seen(agent1)).includes('muser'));
  assert.equal((await call('GET', `/api/users/${deep.body.id}`, agent1)).status, 404);
  const user1 = (await call('GET', '/api/users?role=user', admin)).body.find((u) => u.username === 'user1');
  assert.equal((await call('GET', `/api/users/${user1.id}`, master)).status, 404);

  // --- money down the chain -------------------------------------------------
  // The admin is where money enters a master: a plain credit, nothing is taken from the admin.
  assert.equal((await call('POST', '/api/wallet/deposit', admin, { user_id: m.body.id, amount: 100000 })).body.balance, 100000);
  // A master fills an agent directly. The master's own balance stays put.
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: ag.body.id, amount: 40000 })).body.balance, 40000);
  assert.equal(await bal(master), 100000);
  // An agent still hands over its own balance.
  assert.equal((await call('POST', '/api/wallet/deposit', magent, { user_id: deep.body.id, amount: 15000 })).body.balance, 15000);
  assert.equal(await bal(magent), 25000);
  // More than the master holds is still credited, then taken back so the chain below is unchanged.
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: ag.body.id, amount: 100000 })).status, 200);
  assert.equal(await bal(master), 100000);
  assert.equal((await call('POST', '/api/wallet/withdraw', master, { user_id: ag.body.id, amount: 100000 })).body.balance, 25000);
  assert.equal(await bal(master), 100000);
  // Nobody pays themselves, and nobody reaches outside their own tree.
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: m.body.id, amount: 1 })).status, 403);
  assert.equal((await call('POST', '/api/wallet/deposit', magent, { user_id: m.body.id, amount: 1 })).status, 404);
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: user1.id, amount: 1 })).status, 404);

  // An agent pulls a user's money back into its own balance. A master takes an agent's money off
  // and does not keep it.
  assert.equal((await call('POST', '/api/wallet/withdraw', magent, { user_id: deep.body.id, amount: 5000 })).body.balance, 10000);
  assert.equal(await bal(magent), 30000);
  assert.equal((await call('POST', '/api/wallet/withdraw', master, { user_id: ag.body.id, amount: 30000 })).body.balance, 0);
  assert.equal(await bal(master), 100000);
  // The agent's own rows still add up to its balance. The 100,000 round trip is in there too.
  const tx = (await call('GET', `/api/wallet/transactions?user_id=${ag.body.id}`, master)).body;
  assert.equal(tx.filter((t) => t.type === 'transfer_in').length, 3);
  assert.equal(tx.filter((t) => t.type === 'transfer_out').length, 3);
  assert.equal(tx[0].balance_after, 0);
  assert.equal(tx.reduce((sum, t) => sum + t.amount, 0), 0);

  // --- ငွေလက်ခံ: requests run up the chain ----------------------------------
  // pay-to shows the KPay number of the account the caller hangs under.
  await call('PATCH', `/api/users/${m.body.id}`, admin, { kpay_no: '09555', kpay_name: 'Master' });
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', magent)).body.kpay_no, '09555');
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', master)).body.kpay_no, '09111'); // the admin's

  // An agent asks its master. Approving credits the agent and does not spend the master's balance.
  const ask = await call('POST', '/api/wallet-requests', magent, { type: 'deposit', amount: 20000, method: 'KPay', txn_ref: 'TX1' });
  assert.equal(ask.status, 201, JSON.stringify(ask.body));
  assert.equal(ask.body.agent_id, m.body.id); // snapshot of the upline asked
  assert.equal((await call('GET', '/api/wallet-requests/pending-count', master)).body.count, 1);
  assert.equal((await call('POST', `/api/wallet-requests/${ask.body.id}/approve`, master)).body.status, 'approved');
  assert.equal(await bal(magent), 20000);
  assert.equal(await bal(master), 100000);

  // A master asks the admin, which credits it — money entering the system.
  const mAsk = await call('POST', '/api/wallet-requests', master, { type: 'deposit', amount: 5000, method: 'Cash' });
  assert.equal(mAsk.status, 201, JSON.stringify(mAsk.body));
  assert.equal((await call('POST', `/api/wallet-requests/${mAsk.body.id}/approve`, admin)).body.status, 'approved');
  assert.equal(await bal(master), 105000);
  assert.equal((await call('POST', '/api/wallet-requests', admin, { type: 'deposit', amount: 1, method: 'Cash' })).status, 403); // no upline

  // Nobody approves their own request, nor one from another tree.
  const ask2 = await call('POST', '/api/wallet-requests', magent, { type: 'withdraw', amount: 1000, method: 'KPay', account_no: '09777' });
  assert.equal(ask2.status, 201, JSON.stringify(ask2.body));
  assert.equal((await call('POST', `/api/wallet-requests/${ask2.body.id}/approve`, magent)).status, 404);
  assert.equal((await call('POST', `/api/wallet-requests/${ask2.body.id}/approve`, agent1)).status, 404);
  assert.equal((await call('POST', `/api/wallet-requests/${ask2.body.id}/approve`, master)).body.status, 'approved');
  assert.equal(await bal(magent), 19000);
  assert.equal(await bal(master), 105000);

  // A user created straight under the master asks that master. Approving does not spend the master's balance.
  const mdirect = await login('mdirect', 'xxxxxx');
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', mdirect)).body.role, 'master');
  assert.equal((await call('GET', '/api/wallet-requests/pay-to', mdirect)).body.kpay_no, '09555');
  const directAsk = await call('POST', '/api/wallet-requests', mdirect, { type: 'deposit', amount: 8000, method: 'KPay', txn_ref: 'DIR' });
  assert.equal(directAsk.status, 201, JSON.stringify(directAsk.body));
  assert.equal(directAsk.body.agent_id, m.body.id);
  assert.equal((await call('POST', `/api/wallet-requests/${directAsk.body.id}/approve`, master)).body.status, 'approved');
  assert.equal(await bal(mdirect), 8000);
  assert.equal(await bal(master), 105000);
  // The same account can be topped up and drawn down directly. The master's balance stays put.
  assert.equal((await call('POST', '/api/wallet/withdraw', master, { user_id: direct.body.id, amount: 1000 })).body.balance, 7000);
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: direct.body.id, amount: 1000 })).body.balance, 8000);
  assert.equal(await bal(master), 105000);

  // A user under an agent asks that agent. Naming the master does not change the recipient.
  await call('PATCH', `/api/users/${ag.body.id}`, master, { kpay_no: '09666', kpay_name: 'Agent' });
  const muserTok = await login('muser', 'xxxxxx');
  const pay = (await call('GET', '/api/wallet-requests/pay-to', muserTok)).body;
  assert.equal(pay.role, 'agent');
  assert.equal(pay.kpay_no, '09666');
  assert.equal(pay.master, undefined);
  const normal = await call('POST', '/api/wallet-requests', muserTok, { type: 'deposit', amount: 1000, method: 'KPay', ask_master: true });
  assert.equal(normal.status, 201, JSON.stringify(normal.body));
  assert.equal(normal.body.agent_id, ag.body.id);
  assert.equal((await call('POST', `/api/wallet-requests/${normal.body.id}/cancel`, muserTok)).body.status, 'cancelled');

  // --- the အပါတ်စဥ် and its break belong to the admin alone ----------------
  const folder = (await call('POST', '/api/term-folders', admin, { name: 'Master tests' })).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'Master draw', game: '2D', unit_price: 100, status: 'open' })).body;
  assert.equal((await call('POST', '/api/terms', master, { folder_id: folder.id, description: 'Mine', game: '2D' })).status, 403);
  assert.equal((await call('PATCH', `/api/terms/${term.id}`, master, { unit_price: 50 })).status, 403);
  assert.equal((await call('DELETE', `/api/terms/${term.id}`, master, { confirm: 'DELETE' })).status, 403);
  assert.equal((await call('PUT', `/api/terms/${term.id}/limits`, master, [{ bet_type_id: 0, max_units: 50 }])).status, 403);
  assert.equal((await call('PUT', `/api/terms/${term.id}/blocked`, master, [{ bet_type_id: 0, number: '99' }])).status, 403);
  assert.equal((await call('PUT', `/api/terms/${term.id}/hot`, master, { percent: 10, numbers: [] })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${m.body.id}`, master, { hot_edit: true })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${ag.body.id}`, admin, { hot_edit: true })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${m.body.id}`, admin, { hot_edit: true })).body.hot_edit, 1);
  assert.equal((await call('PUT', `/api/terms/${term.id}/hot`, master, { percent: 15, numbers: [{ bet_type_id: 0, number: '12' }] })).status, 200);
  assert.equal((await call('GET', `/api/terms/${term.id}`, admin)).body.hot_percent, 15);
  assert.deepEqual((await call('GET', `/api/terms/${term.id}`, admin)).body.hot, [{ bet_type_id: 0, number: '12' }]);
  await call('PATCH', `/api/users/${m.body.id}`, admin, { hot_edit: false });
  assert.equal((await call('PUT', `/api/terms/${term.id}/hot`, master, { percent: 10, numbers: [] })).status, 403);
  assert.equal((await call('PUT', `/api/terms/${term.id}/results`, master, [{ slot: 2, value: '45' }])).status, 403);
  const mine = (await call('POST', '/api/term-folders', master, { name: 'Mine' })).body;
  assert.equal(mine.master_id, m.body.id);
  const own = (await call('POST', '/api/terms', master, { folder_id: mine.id, description: 'Own draw', game: '2D', unit_price: 100, status: 'open' })).body;
  assert.equal(own.can_manage, true);
  // Own file: hot numbers, break, closed numbers, max unit and settings need no hot_edit grant.
  assert.equal((await call('PUT', `/api/terms/${own.id}/limits`, master, [{ bet_type_id: 0, max_units: 5 }])).status, 200);
  assert.equal((await call('PUT', `/api/terms/${own.id}/hot`, master, { percent: 20, numbers: [{ bet_type_id: 0, number: '07' }] })).status, 200);
  assert.equal((await call('PUT', `/api/terms/${own.id}/blocked`, master, [{ bet_type_id: 0, number: '08' }])).status, 200);
  assert.equal((await call('PUT', `/api/terms/${own.id}/user-limits`, master, [{ user_id: deep.body.id, bet_type_id: 0, max_units: 3 }])).status, 200);
  assert.equal((await call('PATCH', `/api/terms/${own.id}`, master, { description: 'Own draw 2' })).body.description, 'Own draw 2');
  assert.equal((await call('GET', `/api/terms/${own.id}`, await login('agent1', 'agent123'))).status, 404);
  assert.equal((await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 50 }])).status, 200);

  // The per-user limit of its own users is the master's, and only its own: the admin's row for
  // user1 is left standing when the master saves its list again.
  const setLimit = (who, rows) => call('PUT', `/api/terms/${term.id}/user-limits`, who, rows);
  assert.equal((await setLimit(master, [{ user_id: user1.id, bet_type_id: 0, max_units: 20 }])).status, 400); // not its user
  assert.equal((await setLimit(admin, [{ user_id: user1.id, bet_type_id: 0, max_units: 10 }])).status, 200);
  assert.equal((await setLimit(master, [{ user_id: deep.body.id, bet_type_id: 0, max_units: 20 }])).status, 200);
  assert.deepEqual((await call('GET', `/api/terms/${term.id}/user-limits`, master)).body.map((r) => r.username), ['muser']);
  assert.deepEqual((await call('GET', `/api/terms/${term.id}/user-limits`, admin)).body.map((r) => r.username).sort(), ['muser', 'user1']);
  assert.equal((await call('GET', `/api/terms/${term.id}/user-limits`, magent)).status, 403);

  // --- slips of its own tree ------------------------------------------------
  const muser = await login('muser', 'xxxxxx');
  const slip = (await call('POST', '/api/tickets', muser, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 4 }] })).body;
  assert.equal(slip.net_amount, 400);
  assert.equal((await call('GET', `/api/tickets/${slip.id}`, master)).status, 200); // two levels down
  assert.equal((await call('GET', `/api/tickets/${slip.id}`, agent1)).status, 404);

  // Lower a line: the difference comes back into the user's wallet. An agent never edits slips.
  const beforeEdit = await bal(muser);
  const edited = await call('PATCH', `/api/tickets/${slip.id}/items`, master, { items: [{ id: slip.items[0].id, units: 1 }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.net_amount, 100);
  assert.equal(await bal(muser), beforeEdit + 300);
  assert.equal((await call('PATCH', `/api/tickets/${slip.id}/items`, magent, { items: [{ id: slip.items[0].id, units: 0 }] })).status, 403);

  // A slip delete request from its own user is the master's to approve.
  const del = await call('POST', '/api/slip-cancel-requests', muser, { ticket_id: slip.id });
  assert.equal(del.status, 201, JSON.stringify(del.body));
  assert.equal((await call('GET', '/api/slip-cancel-requests/pending-count', master)).body.count, 1);
  assert.equal((await call('POST', `/api/slip-cancel-requests/${del.body.id}/approve`, master)).body.status, 'approved');
  assert.equal((await call('GET', `/api/tickets/${slip.id}`, master)).body.status, 'cancelled');
  assert.equal(await bal(muser), beforeEdit + 400); // the 100 left on it came back too

  // --- ငွေရှင်း rolls the figures up the whole chain -------------------------
  const slip2 = (await call('POST', '/api/tickets', muser, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 2 }] })).body;
  assert.equal(slip2.net_amount, 200);
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  assert.equal((await call('PUT', `/api/terms/${term.id}/results`, admin, [{ slot: 2, value: '45' }])).status, 200);

  const view = (await call('GET', `/api/terms/${term.id}/clearing`, master)).body;
  assert.deepEqual(view.masters.map((r) => r.username), ['master1']);
  assert.deepEqual(view.agents.map((r) => r.username), ['magent']);
  assert.deepEqual(view.users.map((r) => r.username), ['muser']);
  assert.equal(view.users[0].net, 200); // the cancelled slip is left out
  assert.equal(view.agents[0].net, 200); // its agent's row adds up its users
  assert.equal(view.masters[0].net, 200); // the master's adds up its whole downline
  assert.ok(view.users[0].win > 0);
  assert.equal(view.masters[0].balance, view.masters[0].net - view.masters[0].win);
  // Agents never see ငွေရှင်း; the admin sees every tree.
  assert.equal((await call('GET', `/api/terms/${term.id}/clearing`, magent)).status, 403);
  assert.ok((await call('GET', `/api/terms/${term.id}/clearing`, admin)).body.masters.some((r) => r.username === 'master1'));
  assert.equal((await call('POST', `/api/terms/${term.id}/clearing`, master, { account_ids: [m.body.id, ag.body.id] })).body.cleared, 2);
  assert.equal((await call('POST', `/api/terms/${term.id}/clearing`, master, { account_ids: [user1.id] })).status, 400); // another tree
  assert.equal((await call('POST', `/api/terms/${term.id}/clearing`, magent, { account_ids: [ag.body.id] })).status, 403);
  assert.equal((await call('DELETE', `/api/terms/${term.id}/clearing/${ag.body.id}`, master)).status, 200);

  // --- the rest of the back office, each read scoped to its own tree --------
  // Commission (ကော်မရှင်): the master's own agent and users, and it may set theirs but not another
  // tree's. (The admin, one step above, sets the master's own.)
  const comm = (await call('GET', '/api/users/commissions', master)).body;
  assert.deepEqual(comm.map((u) => u.username).sort(), ['magent', 'mdirect', 'muser']);
  assert.equal((await call('PUT', '/api/users/commissions', master, [{ user_id: deep.body.id, bet_type_id: 0, discount: 7 }])).status, 200);
  assert.equal((await call('PUT', '/api/users/commissions', master, [{ user_id: user1.id, bet_type_id: 0, discount: 7 }])).status, 400);
  assert.equal((await call('PUT', `/api/users/${deep.body.id}/discounts`, master, [{ bet_type_id: 0, discount: 5 }])).status, 200);

  // Dashboard counts and the per-term summary: its own tree, by user or by agent.
  const overview = (await call('GET', '/api/reports/overview', master)).body;
  assert.deepEqual(overview.accounts.map((r) => [r.role, r.count]).sort(), [['agent', 1], ['master', 1], ['user', 2]]);
  const byUser = (await call('GET', `/api/reports/summary?term_id=${term.id}`, master)).body;
  assert.deepEqual(byUser.map((r) => [r.username, r.net]), [['muser', 200]]);
  const byAgent = (await call('GET', `/api/reports/summary?term_id=${term.id}&group_by=agent`, master)).body;
  assert.deepEqual(byAgent.map((r) => [r.username, r.net]), [['magent', 200]]);

  // Own-tree Live Ledger is always on; another tree's agent does not see this master's bets.
  const bets = (await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=45`, master)).body;
  assert.deepEqual(bets.map((r) => [r.username, r.units]), [['muser', 2]]);
  assert.ok((await call('GET', `/api/terms/${term.id}/exposure`, master)).body.some((r) => r.number === '45' && r.units === 2));
  assert.ok((await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=45`, admin)).body.length >= 1);
  assert.equal((await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=45`, agent1)).body.length, 0);

  // Slip edit / delete log: the master sees what it did to its user's slip.
  const logs = (await call('GET', `/api/tickets/edit-logs?term_id=${term.id}`, master)).body;
  assert.deepEqual(logs.map((l) => [l.username, l.action]).sort(), [['muser', 'cancel'], ['muser', 'edit']]);
  assert.deepEqual((await call('GET', `/api/tickets/edit-logs?term_id=${term.id}`, agent1)).body, []);

  // Shared prize sets stay with the admin. A master makes its own and cannot edit the default set.
  assert.ok((await call('GET', '/api/prize-sets', master)).body.some((set) => set.id === 0));
  const mineSet = await call('POST', '/api/prize-sets', master, { name: 'Mine odds', copy_from: 0 });
  assert.equal(mineSet.status, 201, JSON.stringify(mineSet.body));
  assert.equal(mineSet.body.master_id, m.body.id);
  assert.equal((await call('PUT', `/api/prize-sets/${mineSet.body.id}/rates`, master, [{ bet_type_id: 0, multiplier: 70, discount: -1 }])).status, 200);
  assert.equal((await call('PUT', '/api/prize-sets/0/rates', master, [])).status, 403);
  assert.ok(!(await call('GET', '/api/prize-sets', await login('agent1', 'agent123'))).body.some((set) => set.id === mineSet.body.id));

  // Sales data (Excel backup / wipe) stays with the admin.
  assert.equal((await call('GET', '/api/sales-data/summary', master)).status, 403);
});

// The company name heading the admin app's shared စာရင်း: anyone signed in reads it, the admin sets it.
test('company name: admin sets it, everyone reads it', async () => {
  const admin = await login('admin', 'admin123');
  const master = await login('master1', 'master123');
  assert.equal((await call('PUT', '/api/settings/company', admin, { company_name: '  Golden Lotto ' })).body.company_name, 'Golden Lotto');
  assert.equal((await call('GET', '/api/settings/company', master)).body.company_name, 'Golden Lotto');
  assert.equal((await call('PUT', '/api/settings/company', master, { company_name: 'Mine' })).status, 403);
});

// ပေါက်သီး with ငွေရှင်း unticked: the result is saved and the term closed ('drawn'), nobody is paid
// until it is settled; ticked (the default) it settles at once.
test('results: save and close without settling, settle later', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const folder = (await call('POST', '/api/term-folders', admin, { name: 'Results only' })).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'No settle yet', game: '2D', unit_price: 100, status: 'open' })).body;
  const before = (await call('GET', '/api/auth/me', user)).body.balance;
  const slip = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 1 }] })).body;
  assert.equal(slip.status, 'active');
  const afterBet = before - slip.net_amount;

  const saved = await call('PUT', `/api/terms/${term.id}/results?settle=0`, admin, [{ slot: 2, value: '45' }]);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settled, false);
  const drawn = (await call('GET', `/api/terms/${term.id}`, admin)).body;
  assert.equal(drawn.status, 'drawn');
  assert.deepEqual(drawn.results.map((r) => r.value), ['45']);
  assert.equal((await call('GET', `/api/tickets/${slip.id}`, user)).body.status, 'active'); // not settled
  assert.equal((await call('GET', '/api/auth/me', user)).body.balance, afterBet); // nobody paid
  // Closed for betting.
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '12', units: 1 }] })).status, 400);
  // The result can still be changed before settling.
  assert.equal((await call('PUT', `/api/terms/${term.id}/results?settle=0`, admin, [{ slot: 2, value: '46' }])).status, 200);
  assert.equal((await call('PUT', `/api/terms/${term.id}/results?settle=0`, admin, [{ slot: 2, value: '45' }])).status, 200);

  // Settle later: the winner is paid.
  const settled = await call('POST', `/api/terms/${term.id}/settle`, admin);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal((await call('GET', `/api/tickets/${slip.id}`, user)).body.status, 'won');
  assert.ok((await call('GET', '/api/auth/me', user)).body.balance > afterBet);
  // A settled term cannot go back to "saved only".
  assert.equal((await call('PUT', `/api/terms/${term.id}/results?settle=0`, admin, [{ slot: 2, value: '45' }])).status, 400);
});

// The admin opens masters only. A master opens its own agents and users.
test('admin opens masters only; a master opens its own tree', async () => {
  const admin = await login('admin', 'admin123');
  const all = (await call('GET', '/api/users', admin)).body;
  const m = all.find((u) => u.username === 'master1');
  const ag = all.find((u) => u.username === 'magent');
  const user1 = all.find((u) => u.username === 'user1');
  const open = (body) => call('POST', '/api/users', admin, { password: 'xxxxxx', ...body });

  assert.equal((await open({ username: 'adminagent', role: 'agent', name: 'A' })).status, 403);
  assert.equal((await open({ username: 'adminuser', role: 'user', name: 'U' })).status, 403);
  assert.equal((await open({ username: 'adminagent', role: 'agent', name: 'A', parent_id: m.id })).status, 403);
  assert.equal((await open({ username: 'adminuser', role: 'user', name: 'U', parent_id: ag.id })).status, 403);
  assert.equal((await open({ username: 'adminuser', role: 'user', name: 'U', parent_id: user1.id })).status, 403);

  const master = await login('master1', 'master123');
  const agent = await call('POST', '/api/users', master, { username: 'adminagent', password: 'xxxxxx', role: 'agent', name: 'A' });
  assert.equal(agent.status, 201, JSON.stringify(agent.body));
  assert.equal(agent.body.parent_id, m.id);
  const user = await call('POST', '/api/users', master, { username: 'adminuser', password: 'xxxxxx', role: 'user', name: 'U', parent_id: ag.id });
  assert.equal(user.status, 201, JSON.stringify(user.body));
  assert.equal(user.body.parent_id, ag.id);

  // Both are in the master's own tree from the start, and it may manage them.
  const seen = (await call('GET', '/api/users', master)).body.map((x) => x.username);
  assert.ok(seen.includes('adminagent') && seen.includes('adminuser'));
  assert.equal((await call('PATCH', `/api/users/${user.body.id}`, master, { name: 'U2' })).status, 200);

  // A master still needs nothing named: it belongs to the admin.
  const m2 = await open({ username: 'master9', role: 'master', name: 'M9' });
  assert.equal(m2.status, 201, JSON.stringify(m2.body));
  assert.equal(m2.body.parent_id, (await call('GET', '/api/auth/me', admin)).body.id);
  // The admin's master list carries the logo, and closing the account stops its login.
  const marked = await call('POST', '/api/users', admin, {
    username: 'masterlogo', password: 'xxxxxx', role: 'master', name: 'Logo M', master_name: 'Logo House', logo: 'data:image/png;base64,aaaa',
  });
  assert.equal(marked.status, 201, JSON.stringify(marked.body));
  const listed = (await call('GET', '/api/users?role=master', admin)).body.find((u) => u.username === 'masterlogo');
  assert.equal(listed.logo, 'data:image/png;base64,aaaa');
  assert.equal((await call('GET', '/api/auth/brand?username=masterlogo')).body.logo, 'data:image/png;base64,aaaa');
  assert.equal((await call('GET', '/api/auth/brand?username=master9')).body.logo, null);
  assert.equal((await call('GET', '/api/auth/brand?username=admin')).body.logo, null);
  assert.equal((await call('GET', '/api/auth/brand?username=nobody-brand')).body.logo, null);
  assert.equal((await call('PATCH', `/api/users/${listed.id}`, admin, { status: 'suspended' })).body.status, 'suspended');
  assert.equal((await call('POST', '/api/auth/login', null, { username: 'masterlogo', password: 'xxxxxx' })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${listed.id}`, admin, { status: 'active' })).body.status, 'active');
  const house = await login('masterlogo', 'xxxxxx');
  assert.ok(house);
  const logoAgent = await call('POST', '/api/users', house, { username: 'logogent', password: 'xxxxxx', role: 'agent', name: 'Logo Agent' });
  assert.equal(logoAgent.status, 201, JSON.stringify(logoAgent.body));
  const logoUser = await call('POST', '/api/users', house, { username: 'logouser', password: 'xxxxxx', role: 'user', name: 'Logo User', parent_id: logoAgent.body.id });
  assert.equal(logoUser.status, 201, JSON.stringify(logoUser.body));
  assert.equal((await call('GET', '/api/auth/brand?username=logogent')).body.logo, 'data:image/png;base64,aaaa');
  assert.equal((await call('GET', '/api/auth/brand?username=logouser')).body.logo, 'data:image/png;base64,aaaa');
  // A master / an agent still opens its own without naming anyone.
  assert.equal((await call('POST', '/api/users', master, { username: 'mown', password: 'xxxxxx', role: 'agent', name: 'Own' })).status, 201);
  assert.equal((await call('POST', '/api/users', await login('magent', 'xxxxxx'),
    { username: 'agown', password: 'xxxxxx', role: 'user', name: 'Own' })).status, 201);
});

// Role change (admin only): an old view-only admin becomes a user under an agent, keeping its login.
test('role change: admin -> user, with the safety checks', async () => {
  const admin = await login('admin', 'admin123');
  const master = await login('master1', 'master123');
  const users = (await call('GET', '/api/users', admin)).body;
  const viewer = users.find((u) => u.username === 'viewer'); // an admin made earlier in this file
  const agent1 = users.find((u) => u.username === 'agent1');
  const user1 = users.find((u) => u.username === 'user1');
  const me = (await call('GET', '/api/auth/me', admin)).body;

  assert.equal((await call('PUT', `/api/users/${viewer.id}/role`, master, { role: 'user' })).status, 403); // admins only
  assert.equal((await call('PUT', `/api/users/${me.id}/role`, admin, { role: 'user' })).status, 403); // not oneself
  assert.equal((await call('PUT', `/api/users/${viewer.id}/role`, admin, { role: 'user', parent_id: user1.id })).status, 400); // a user is no upline

  const changed = await call('PUT', `/api/users/${viewer.id}/role`, admin, { role: 'user', parent_id: agent1.id });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.role, 'user');
  assert.equal(changed.body.parent_id, agent1.id);
  const agent = await login('agent1', 'agent123');
  assert.ok((await call('GET', '/api/users', agent)).body.some((u) => u.id === viewer.id)); // now in the agent's tree
  const asUser = await login('viewer', 'view123'); // same login still works
  assert.equal((await call('GET', '/api/auth/me', asUser)).body.role, 'user');

  // A user with slips stays a user; an account with users under it cannot become a user.
  assert.match((await call('PUT', `/api/users/${user1.id}/role`, admin, { role: 'agent' })).body.error, /slips/);
  assert.match((await call('PUT', `/api/users/${agent1.id}/role`, admin, { role: 'user' })).body.error, /Move the user accounts/);
  // An agent can become a master (its users may hang under a master), straight under the admin.
  const promoted = await call('PUT', `/api/users/${agent1.id}/role`, admin, { role: 'master' });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.parent_id, me.id);
  assert.equal((await call('PUT', `/api/users/${agent1.id}/role`, admin, { role: 'agent' })).status, 200); // and back
});

// A master stays in its own tree except for the global Live Ledger when the admin enables it.
test('master tree scope with admin-enabled global Live Ledger', async () => {
  const admin = await login('admin', 'admin123');
  const master = await login('master1', 'master123');
  const agent = await login('agent1', 'agent123');
  const all = (await call('GET', '/api/users', admin)).body;
  const m = all.find((u) => u.username === 'master1');
  const user1 = all.find((u) => u.username === 'user1');
  const seen = async () => (await call('GET', '/api/users', master)).body.map((u) => u.username);

  // Even a legacy view_all value no longer opens another tree.
  await db.execute({ sql: 'UPDATE users SET view_all = 1 WHERE id = ?', args: [m.id] });
  await call('PATCH', `/api/users/${m.id}`, admin, { ledger_access: false });
  assert.ok(!('view_all' in (await call('GET', '/api/auth/me', master)).body));
  assert.ok(!(await seen()).includes('user1'));
  assert.equal((await call('GET', `/api/users/${user1.id}`, master)).status, 404);
  assert.equal((await call('PATCH', `/api/users/${m.id}`, admin, { view_all: true })).status, 400);

  const term = (await call('POST', '/api/terms', admin, {
    folder_id: 1, description: 'Global master ledger', game: '2D', unit_price: 100, status: 'open',
  })).body;
  await fund(user1.id, 10000); // user1 hangs under agent1, outside any master: not the admin's to top up
  const placed = await call('POST', '/api/tickets', await login('user1', 'user123'), {
    term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 1 }],
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const outsideSlip = placed.body;

  // Without the admin grant, the master still sees its own tree's ledger — not user1's other-tree bets.
  const ownLedger = await call('GET', `/api/terms/${term.id}/ledger-users`, master);
  assert.equal(ownLedger.status, 200);
  assert.ok(!ownLedger.body.some((u) => u.id === user1.id));
  assert.ok(!(await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=45`, master)).body
    .some((r) => r.username === 'user1'));
  const enabled = await call('PATCH', `/api/users/${m.id}`, admin, { ledger_access: true });
  assert.equal(enabled.body.ledger_access, 1);

  // Only Live Ledger reads cross the tree; account, slips, reports and wallet history stay scoped.
  assert.ok(!(await seen()).includes('user1'));
  assert.equal((await call('GET', `/api/users/${user1.id}`, master)).status, 404);
  assert.deepEqual((await call('GET', `/api/tickets?term_id=${term.id}`, master)).body, []);
  assert.equal((await call('GET', `/api/tickets/${outsideSlip.id}`, master)).status, 404);
  assert.deepEqual((await call('GET', `/api/wallet/transactions?user_id=${user1.id}`, master)).body, []);
  const report = (await call('GET', `/api/reports/summary?term_id=${term.id}&group_by=user`, master)).body;
  assert.ok(!report.some((r) => r.username === 'user1'));

  // The enabled Live Ledger sees users from other masters and can filter their bets.
  const ledgerUsers = (await call('GET', `/api/terms/${term.id}/ledger-users`, master)).body;
  assert.ok(ledgerUsers.some((u) => u.id === user1.id));
  const bets = (await call('GET', `/api/terms/${term.id}/number-bets?bet_type_id=0&number=45`, master)).body;
  assert.ok(bets.some((r) => r.username === 'user1'));
  assert.deepEqual((await call('GET', `/api/terms/${term.id}/exposure?bet_type_id=0&user_ids=${user1.id}`, master)).body, []);
  assert.ok((await call('GET', `/api/terms/${term.id}/exposure?bet_type_id=0&user_ids=${user1.id}&live_ledger=1`, master)).body
    .some((r) => r.number === '45'));

  // The admin still sees everything, and the master can only change its own tree.
  assert.ok((await call('GET', `/api/tickets?user_id=${user1.id}`, admin)).body.length > 0);
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: user1.id, amount: 1 })).status, 404);
  assert.equal((await call('PATCH', `/api/users/${user1.id}`, master, { name: 'x' })).status, 404);
  assert.equal((await call('POST', `/api/tickets/${outsideSlip.id}/cancel`, master)).status, 404);
  const muser = all.find((u) => u.username === 'muser');
  assert.equal((await call('GET', `/api/users/${muser.id}`, master)).body.can_manage, true);
});

// အဝယ်: units over the break are ကျွံ; buying takes them off; the dealer's win shows after the result.
test('purchases: excess over the break, bought off, dealer win after the result', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const master = await login('master1', 'master123');
  const folder = (await call('POST', '/api/term-folders', admin, { name: 'Purchases' })).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'Lay-off', game: '2D', unit_price: 100, status: 'open' })).body;
  await fund((await call('GET', '/api/auth/me', user)).body.id, 100000);
  assert.equal((await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '45', units: 30 }, { bet_type_id: 0, input: '12', units: 5 }] })).status, 201);

  // No break: no excess. Break lowered to 10: 45 has 20 over it, 12 none.
  assert.deepEqual((await call('GET', `/api/terms/${term.id}/purchases`, admin)).body.excess, []);
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 10 }]);
  let view = (await call('GET', `/api/terms/${term.id}/purchases`, admin)).body;
  assert.deepEqual(view.excess.map((r) => [r.number, r.units, r.break_units, r.excess]), [['45', 30, 10, 20]]);
  assert.equal(view.multipliers[0], 80); // set 0's odds by default

  // Admin only.
  assert.equal((await call('GET', `/api/terms/${term.id}/purchases`, master)).status, 403);
  assert.equal((await call('POST', `/api/terms/${term.id}/purchases`, master, { items: [{ bet_type_id: 0, number: '45', units: 1 }] })).status, 403);
  assert.equal((await call('POST', `/api/terms/${term.id}/purchases`, admin, { items: [{ bet_type_id: 0, number: '456', units: 1 }] })).status, 400);

  // Buy 15 of the 20, then 5 more on 45 and 3 on 99 (not over the break: bought anyway).
  view = (await call('POST', `/api/terms/${term.id}/purchases`, admin, { items: [{ bet_type_id: 0, number: '45', units: 15 }], multiplier: { 0: 85 }, note: 'dealer A' })).body;
  assert.equal(view.excess[0].excess, 5);
  view = (await call('POST', `/api/terms/${term.id}/purchases`, admin, { items: [{ bet_type_id: 0, number: '45', units: 5 }, { bet_type_id: 0, number: '99', units: 3 }] })).body;
  assert.equal(view.excess[0].excess, 0);
  assert.equal(view.excess[0].purchased, 20);
  assert.deepEqual(view.totals, { units: 23, amount: 2300, win: 0 });
  // A mistaken line can be removed.
  const line99 = view.purchases.find((p) => p.number === '99');
  view = (await call('DELETE', `/api/terms/${term.id}/purchases/${line99.id}`, admin)).body;
  assert.equal(view.totals.units, 20);

  // Result 45: the dealer owes 15 × 100 × 85 + 5 × 100 × 80.
  await call('PATCH', `/api/terms/${term.id}`, admin, { status: 'closed' });
  assert.equal((await call('PUT', `/api/terms/${term.id}/results?settle=0`, admin, [{ slot: 2, value: '45' }])).status, 200);
  view = (await call('GET', `/api/terms/${term.id}/purchases`, admin)).body;
  assert.equal(view.totals.win, 15 * 100 * 85 + 5 * 100 * 80);
  // No new purchases once the result is in.
  assert.equal((await call('POST', `/api/terms/${term.id}/purchases`, admin, { items: [{ bet_type_id: 0, number: '45', units: 1 }] })).status, 400);
});

// The admin app's 👁 on a စာရင်း row: one account's per-term report, like the user app's own.
test('reports/mine for one account: user, agent roll-up, access', async () => {
  const admin = await login('admin', 'admin123');
  const user = await login('user1', 'user123');
  const agent = await login('agent1', 'agent123');
  const master = await login('master1', 'master123');
  const all = (await call('GET', '/api/users', admin)).body;
  const user1 = all.find((u) => u.username === 'user1');
  const agent1 = all.find((u) => u.username === 'agent1');
  const own = (await call('GET', '/api/reports/mine', user)).body;
  assert.ok(own.length > 0);
  // The admin sees exactly what the user sees for itself.
  assert.deepEqual((await call('GET', `/api/reports/mine?user_id=${user1.id}`, admin)).body, own);
  assert.deepEqual((await call('GET', `/api/reports/mine?user_id=${user1.id}`, agent)).body.map((r) => r.term_id), own.map((r) => r.term_id));
  // An agent's report adds up its users' slips per term.
  const byAgent = (await call('GET', `/api/reports/mine?user_id=${agent1.id}`, admin)).body;
  const ownUsers = (await call('GET', `/api/users?parent_id=${agent1.id}&role=user`, admin)).body.map((u) => u.id);
  assert.ok(byAgent.length >= own.length && ownUsers.includes(user1.id));
  // Another tree is out of reach; the cleared filter still works.
  assert.equal((await call('GET', `/api/reports/mine?user_id=${user1.id}`, master)).status, 404);
  const cleared = (await call('GET', `/api/reports/mine?user_id=${user1.id}&cleared=1`, admin)).body;
  assert.ok(cleared.every((r) => r.cleared_at));
});

// ငွေ Transfer: the admin squares a master back onto its float — the money it has handed that master
// (its deposits minus its withdrawals). The squaring moves are left out of the float itself, so the
// float stays the same figure however often it is squared.
test('float transfer: masters squared back onto the money the admin handed them', async () => {
  const admin = await login('admin', 'admin123');
  const master = await login('master1', 'master123');
  const all = (await call('GET', '/api/users', admin)).body;
  const m = all.find((u) => u.username === 'master1');
  const magent = all.find((u) => u.username === 'magent');
  const user1 = all.find((u) => u.username === 'user1');
  const bal = async (token) => (await call('GET', '/api/auth/me', token)).body.balance;
  const view = async () => (await call('GET', '/api/wallet/float-targets', admin)).body;
  const row = (v) => v.masters.find((x) => x.id === m.id);

  // Every upline has a page of its own — the admin's holds its masters — and none of them reaches
  // into another's list. A user has no page at all.
  assert.equal((await call('GET', '/api/wallet/float-targets', master)).status, 200);
  assert.equal((await call('POST', '/api/wallet/float-reset', master, { user_ids: [m.id] })).status, 400); // itself
  assert.equal((await call('GET', '/api/wallet/float-targets', await login('user1', 'user123'))).status, 403);

  // The float is what the admin has put in, and delta is the move that squares the balance onto it.
  const v0 = await view();
  assert.deepEqual(v0.accounts, v0.masters); // 'masters' is the old name of the same list
  const float = row(v0).float_amount;
  assert.ok(float > 0);
  assert.equal(row(v0).balance, await bal(master));
  assert.equal(row(v0).delta, float - row(v0).balance);

  // Squaring up: the balance lands exactly on the float, and the float itself does not move.
  const done = await call('POST', '/api/wallet/float-reset', admin, { user_ids: [m.id] });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await bal(master), float);
  const v1 = await view();
  assert.equal(row(v1).float_amount, float);
  assert.equal(row(v1).delta, 0);

  // Already on its float: nothing moves.
  const again = (await call('POST', '/api/wallet/float-reset', admin, { user_ids: [m.id] })).body;
  assert.equal(again.moved, 0);
  assert.equal(again.masters[0].skipped, 'on_float');

  // The master hands 1,000 to its agent without spending its own balance, so the admin's float
  // does not move and there is nothing to square back onto the master.
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: magent.id, amount: 1000 })).status, 200);
  assert.equal(await bal(master), float);
  const v2 = await view();
  assert.equal(row(v2).float_amount, float);
  assert.equal(row(v2).delta, 0);
  const filled = (await call('POST', '/api/wallet/float-reset', admin, { user_ids: [m.id] })).body;
  assert.equal(filled.moved, 0);
  assert.equal(await bal(master), float);

  // Taking 2,500 back off the agent does not credit the master.
  assert.equal((await call('POST', '/api/wallet/withdraw', master, { user_id: magent.id, amount: 2500 })).status, 200);
  assert.equal(await bal(master), float);
  const over = (await call('POST', '/api/wallet/float-reset', admin, { user_ids: [m.id] })).body;
  assert.equal(over.moved, 0);
  assert.equal(await bal(master), float);

  // A further ငွေသွင်း by the admin raises the float with it.
  assert.equal((await call('POST', '/api/wallet/deposit', admin, { user_id: m.id, amount: 5000 })).body.balance, float + 5000);
  const v3 = await view();
  assert.equal(row(v3).float_amount, float + 5000);
  assert.equal(row(v3).delta, 0);

  // Only masters: an agent or a user is not on this page and cannot be squared up.
  assert.ok(!(await view()).masters.some((x) => x.id === user1.id));
  assert.equal((await call('POST', '/api/wallet/float-reset', admin, { user_ids: [user1.id] })).status, 400);

  // A master squares its own agents and users without spending its balance; an agent does it for
  // its users out of its own balance. Each level sees only the accounts straight under it.
  const muser = all.find((u) => u.username === 'muser');
  await call('POST', '/api/wallet/deposit', admin, { user_id: m.id, amount: 1000000 }); // room to top up
  const mView = async () => (await call('GET', '/api/wallet/float-targets', master)).body;
  const mRow = (v) => v.accounts.find((x) => x.id === magent.id);
  let mv = await mView();
  assert.ok(mv.accounts.length > 0);
  assert.ok(!mv.accounts.some((a) => a.id === m.id)); // itself is not on its own page
  assert.ok(!mv.accounts.some((a) => a.id === muser.id)); // nor an account further down
  assert.ok(!(await view()).masters.some((a) => a.id === magent.id)); // and not on the admin's

  // Handing it more raises its float with it, so nothing is left to square.
  const before = mRow(mv).delta;
  assert.equal((await call('POST', '/api/wallet/deposit', master, { user_id: magent.id, amount: 3000 })).status, 200);
  assert.equal(mRow(await mView()).delta, before);
  // What the agent then hands down comes off its balance, and the master tops exactly that back up.
  assert.equal((await call('POST', '/api/wallet/deposit', await login('magent', 'xxxxxx'), { user_id: muser.id, amount: 1000 })).status, 200);
  assert.equal(mRow(await mView()).delta, before + 1000);
  const masterBal = await bal(master);
  const mDone = await call('POST', '/api/wallet/float-reset', master, { user_ids: [magent.id] });
  assert.equal(mDone.status, 200, JSON.stringify(mDone.body));
  assert.equal(await bal(master), masterBal);
  assert.equal(mRow(await mView()).delta, 0);
  assert.equal(mRow(await mView()).balance, mRow(await mView()).float_amount);

  // An agent's own page: its users, and the squaring comes out of the agent's balance.
  const agentTok = await login('magent', 'xxxxxx');
  const aView = async () => (await call('GET', '/api/wallet/float-targets', agentTok)).body;
  assert.ok((await aView()).accounts.some((a) => a.id === muser.id));
  assert.ok(!(await aView()).accounts.some((a) => a.id === magent.id));
  assert.equal((await call('POST', '/api/wallet/float-reset', agentTok, { user_ids: [m.id] })).status, 400); // not below it
  const aDone = await call('POST', '/api/wallet/float-reset', agentTok, { user_ids: [muser.id] });
  assert.equal(aDone.status, 200, JSON.stringify(aDone.body));
  const aRow = (await aView()).accounts.find((x) => x.id === muser.id);
  assert.equal(aRow.delta, 0);

  // Each upline keeps its own weekdays.
  assert.deepEqual((await call('PUT', '/api/wallet/float-days', master, { days: [2] })).body.days, [2]);
  assert.deepEqual((await mView()).days, [2]);

  // The weekly check boxes are kept on the server, deduplicated and sorted.
  assert.deepEqual((await call('PUT', '/api/wallet/float-days', admin, { days: [6, 3, 3] })).body.days, [3, 6]);
  assert.deepEqual((await view()).days, [3, 6]);
  assert.equal((await call('PUT', '/api/wallet/float-days', admin, { days: [8] })).status, 400);
  assert.deepEqual((await call('PUT', '/api/wallet/float-days', admin, { days: [] })).body.days, []);
});

// Agents sign into the admin dashboard too (public/admin), so every call its pages make for an
// agent has to go through — and the admin-only ones have to stay shut.
test('admin dashboard as an agent: its own tree is served, the admin-only parts refused', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const term = (await call('GET', '/api/terms', agent)).body[0];
  const user1 = (await call('GET', '/api/users?role=user', agent)).body[0];
  const ok = async (method, path, body) => (await call(method, path, agent, body)).status;

  // Dashboard, Users, account detail, Commission, Wallet, Wallet requests, Prize set assign.
  assert.equal(await ok('GET', '/api/reports/overview'), 200);
  assert.equal(await ok('GET', '/api/terms'), 200);
  assert.equal(await ok('GET', '/api/term-folders'), 200); // the term list shows each term's ဖိုင်
  assert.equal(await ok('GET', '/api/auth/me'), 200);
  assert.equal(await ok('GET', '/api/users?role=user'), 200);
  assert.equal(await ok('GET', `/api/users/${user1.id}`), 200);
  assert.equal(await ok('GET', `/api/wallet/transactions?user_id=${user1.id}&limit=50`), 200);
  assert.equal(await ok('GET', '/api/users/commissions'), 200);
  assert.equal(await ok('GET', '/api/wallet/transactions?limit=500'), 200);
  assert.equal(await ok('GET', '/api/wallet-requests'), 200);
  assert.equal(await ok('GET', '/api/wallet-requests/pending-count'), 200);
  assert.equal(await ok('GET', '/api/prize-sets'), 200);
  assert.equal(await ok('GET', '/api/meta'), 200);

  // The term tabs an agent gets: Live Ledger of its own users, ဟော့ဂဏန်း read-only,
  // Exposure, စလစ်, စာရင်း — but not the per-user Max Unit.
  assert.equal(await ok('GET', `/api/terms/${term.id}`), 200);
  assert.equal(await ok('GET', `/api/terms/${term.id}/exposure?bet_type_id=0`), 200);
  assert.equal(await ok('GET', `/api/tickets?term_id=${term.id}&limit=500`), 200);
  assert.equal(await ok('GET', `/api/reports/summary?term_id=${term.id}&group_by=user`), 200);
  assert.equal(await ok('GET', `/api/terms/${term.id}/user-limits`), 403);
  assert.equal(await ok('PUT', `/api/terms/${term.id}/user-limits`, []), 403);

  // Admin-only pages: the sidebar leaves them out and the server refuses them anyway.
  assert.equal(await ok('GET', '/api/slip-cancel-requests?status=pending'), 200);
  // ငွေ Transfer is every upline's own page: an agent gets its users, never another's accounts.
  assert.equal(await ok('GET', '/api/wallet/float-targets'), 200);
  assert.equal(await ok('POST', '/api/wallet/float-reset', { user_ids: [1] }), 400);
  assert.equal(await ok('POST', '/api/prize-sets', { name: 'Nope' }), 403);
  assert.equal(await ok('PUT', `/api/terms/${term.id}/limits`, [{ bet_type_id: 0, max_units: 1 }]), 403);
  assert.equal(await ok('PATCH', `/api/terms/${term.id}`, { description: 'Nope' }), 403);
  assert.equal(await ok('POST', '/api/term-folders', { name: 'Nope' }), 403);
  assert.equal(await ok('POST', '/api/users', { username: 'agz', password: 'xxxxxx', role: 'agent', name: 'X' }), 403);
  // Own-tree Live Ledger always loads; the agent cannot grant whole-ledger, and the admin cannot grant it to an agent.
  assert.equal(await ok('PATCH', `/api/users/${user1.id}`, { ledger_access: true }), 403);
  assert.equal(await ok('GET', `/api/terms/${term.id}/ledger-users`), 200);
  const me = (await call('GET', '/api/auth/me', agent)).body;
  assert.equal((await call('PATCH', `/api/users/${me.id}`, admin, { ledger_access: true })).status, 400);
});

// Keep last: it wipes every term, folder and slip.
test('all delete: with sales an Excel backup first, then every term, folder and slip goes; active slips refunded', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent1', 'agent123');
  const user = await login('user1', 'user123');
  const balance = async () => (await call('GET', '/api/auth/me', user)).body.balance;
  const exportXlsx = async (token = admin) => {
    const res = await fetch(`${base}/api/sales-data/export.xlsx`, { headers: { authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, token: res.headers.get('x-export-token'), bytes };
  };
  const wipe = (body) => call('DELETE', '/api/sales-data', admin, body);

  const term = (await call('POST', '/api/terms', admin, { folder_id: 1, description: 'Wipe me', game: '2D', unit_price: 100 })).body;
  const slip = (await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '61', units: 3 }] })).body;
  const before = await balance();

  assert.equal((await exportXlsx(agent)).status, 403); // admin only
  assert.equal((await wipe({ export_token: 'nope', confirm: 'DELETE' })).status, 400); // no backup yet
  const first = await exportXlsx();
  assert.equal(first.status, 200);
  assert.equal(first.bytes.subarray(0, 2).toString(), 'PK'); // a real .xlsx (zip)
  assert.equal((await wipe({ export_token: first.token, confirm: 'delete' })).status, 400); // must type DELETE

  // A slip after the backup makes it stale.
  await call('POST', '/api/tickets', user, { term_id: term.id, entries: [{ bet_type_id: 0, input: '62', units: 1 }] });

  // All delete never wipes a live draw: while any term is open it refuses, so the admin closes
  // them first (ထိုးကြေးပိတ် → Excel backup → All delete).
  assert.match((await wipe({ export_token: first.token, confirm: 'DELETE' })).body.error, /term is open/);
  for (const t of (await call('GET', '/api/terms', admin)).body) {
    if (t.status !== 'open') continue;
    // A master's own draw is closed by that master. The shared book is still the admin's.
    if (t.can_manage) assert.equal((await call('PATCH', `/api/terms/${t.id}`, admin, { status: 'closed' })).status, 200);
    else await db.execute({ sql: `UPDATE terms SET status = 'closed' WHERE id = ?`, args: [t.id] });
  }
  assert.match((await wipe({ export_token: first.token, confirm: 'DELETE' })).body.error, /New slips/);

  const summary = (await call('GET', '/api/sales-data/summary', admin)).body;
  assert.ok(summary.terms.some((x) => x.id === term.id && x.slips === 2));
  // Every active (unsettled) slip of this user, in any term, is refunded.
  const active = (await call('GET', '/api/tickets?status=active&limit=500', user)).body;
  assert.ok(active.some((x) => x.id === slip.id));
  const owed = active.reduce((sum, x) => sum + x.net_amount, 0);
  const beforeWipe = await balance();
  assert.ok(beforeWipe < before); // the second slip was charged
  const second = await exportXlsx();
  const done = await wipe({ export_token: second.token, confirm: 'DELETE' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.refunded >= owed);
  assert.equal(await balance(), beforeWipe + owed);
  assert.deepEqual((await call('GET', '/api/terms', admin)).body, []);
  assert.deepEqual((await call('GET', '/api/term-folders', admin)).body, []);
  assert.deepEqual((await call('GET', '/api/tickets', user)).body, []);
  // Nothing sold any more: no backup needed, only DELETE typed.
  assert.equal((await wipe({ confirm: 'DELETE' })).status, 200);
});

test('Sale over-break: admin always, master/agent only when the admin allows it', async () => {
  const admin = await login('admin', 'admin123');
  const master = (await call('POST', '/api/users', admin, { username: 'so_master', password: 'pass123', role: 'master', name: 'SO Master' })).body;
  const outsider = (await call('POST', '/api/users', admin, { username: 'so_out_m', password: 'pass123', role: 'master', name: 'Other master' })).body;
  const masterTokEarly = await login('so_master', 'pass123');
  const outTok = await login('so_out_m', 'pass123');
  const agent = (await call('POST', '/api/users', masterTokEarly, { username: 'so_agent', password: 'pass123', role: 'agent', name: 'SO Agent' })).body;
  const user = (await call('POST', '/api/users', masterTokEarly, { username: 'so_user', password: 'pass123', role: 'user', name: 'SO User', parent_id: agent.id })).body;
  const outAgent = (await call('POST', '/api/users', outTok, { username: 'so_out_a', password: 'pass123', role: 'agent', name: 'Other agent' })).body;
  const outUser = (await call('POST', '/api/users', outTok, { username: 'so_out_u', password: 'pass123', role: 'user', name: 'Other user', parent_id: outAgent.id })).body;
  await fund(user.id, 200000);
  await fund(outUser.id, 200000);

  const folder = (await call('POST', '/api/term-folders', admin, { name: 'SO folder' })).body;
  const term = (await call('POST', '/api/terms', admin, { folder_id: folder.id, description: 'SO break', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PUT', `/api/terms/${term.id}/limits`, admin, [{ bet_type_id: 0, max_units: 5 }]);

  const masterTok = await login('so_master', 'pass123');
  const agentTok = await login('so_agent', 'pass123');
  const userTok = await login('so_user', 'pass123');

  assert.equal((await call('GET', '/api/auth/me', agentTok)).body.sale_over, 0);
  assert.equal((await call('PATCH', `/api/users/${agent.id}`, agentTok, { sale_over: true })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${user.id}`, admin, { sale_over: true })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${agent.id}`, admin, { sale_over: true })).status, 403);

  const place = (who, number, units, extra = {}) =>
    call('POST', '/api/tickets', who, { term_id: term.id, user_id: extra.user_id ?? user.id, entries: [{ bet_type_id: 0, input: number, units }], ...extra });

  const trimmed = await place(admin, '71', 8);
  assert.equal(trimmed.status, 201, JSON.stringify(trimmed.body));
  assert.deepEqual(trimmed.body.adjustments.map((a) => [a.number, a.saved, a.reason]), [['71', 5, 'break']]);

  const adminOver = await place(admin, '72', 8, { save_over: true });
  assert.equal(adminOver.status, 201, JSON.stringify(adminOver.body));
  assert.equal(adminOver.body.adjustments.length, 0);
  assert.equal(adminOver.body.items[0].units, 8);

  assert.equal((await call('POST', '/api/tickets', userTok, { term_id: term.id, entries: [{ bet_type_id: 0, input: '73', units: 8 }], save_over: true })).status, 403);
  assert.equal((await place(agentTok, '73', 8, { save_over: true })).status, 403);

  assert.equal((await call('PATCH', `/api/users/${agent.id}`, masterTok, { sale_over: true })).body.sale_over, 1);
  assert.equal((await call('GET', '/api/auth/me', agentTok)).body.sale_over, 1);
  const agentOver = await place(agentTok, '73', 8, { save_over: true });
  assert.equal(agentOver.status, 201, JSON.stringify(agentOver.body));
  assert.equal(agentOver.body.items[0].units, 8);

  const ownFolder = (await call('POST', '/api/term-folders', masterTok, { name: 'SO own' })).body;
  const ownTerm = (await call('POST', '/api/terms', masterTok, { folder_id: ownFolder.id, description: 'SO own', game: '2D', unit_price: 100, status: 'open' })).body;
  await call('PUT', `/api/terms/${ownTerm.id}/limits`, masterTok, [{ bet_type_id: 0, max_units: 5 }]);
  const ownOver = await call('POST', '/api/tickets', masterTok, {
    term_id: ownTerm.id, user_id: user.id, save_over: true,
    entries: [{ bet_type_id: 0, input: '81', units: 8 }],
  });
  assert.equal(ownOver.status, 201, JSON.stringify(ownOver.body));
  assert.equal(ownOver.body.items[0].units, 8);

  assert.equal((await place(masterTok, '74', 8, { save_over: true })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${master.id}`, admin, { sale_over: true })).body.sale_over, 1);
  const masterOver = await place(masterTok, '74', 8, { save_over: true });
  assert.equal(masterOver.status, 201, JSON.stringify(masterOver.body));
  assert.equal(masterOver.body.items[0].units, 8);

  const asAdmin = (await call('GET', '/api/users?role=user', admin)).body.map((u) => u.username);
  assert.ok(asAdmin.includes('so_user') && asAdmin.includes('so_out_u'));
  const asMaster = (await call('GET', '/api/users?role=user', masterTok)).body.map((u) => u.username);
  assert.deepEqual(asMaster.sort(), ['so_user']);
  const asAgent = (await call('GET', '/api/users?role=user', agentTok)).body.map((u) => u.username);
  assert.deepEqual(asAgent, ['so_user']);
});

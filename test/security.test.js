// Automated security cases: auth, IDOR / broken access control, injection, input limits.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const dir = mkdtempSync(join(tmpdir(), 'lotto-sec-'));
process.env.TURSO_DATABASE_URL = pathToFileURL(join(dir, 'test.db')).href;
delete process.env.TURSO_AUTH_TOKEN;
process.env.JWT_SECRET = 'test-secret';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.CORS_ORIGIN = 'https://lotto.test';

const { db } = await import('../src/db.js');
const { app } = await import('../src/app.js');
const { attachLive, closeLive } = await import('../src/live.js');

let server;
let base;
let admin;
let agentA;
let agentB;
let userA;
let userB;
let userAId;
let userBId;
let adminId;
let termId;
let slipAId;

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const login = async (username, password) => (await call('POST', '/api/auth/login', null, { username, password })).body.token;

async function seedAccount({ username, password, role, name, parent_id = 1 }) {
  const rs = await db.execute({
    sql: `INSERT INTO users (username, password_hash, role, parent_id, name, unlimited)
          VALUES (?, ?, ?, ?, ?, 0) RETURNING id`,
    args: [username, await bcrypt.hash(password, 4), role, parent_id, name],
  });
  return Number(rs.rows[0].id);
}

async function fund(userId, amount) {
  await db.execute({ sql: 'UPDATE users SET balance = balance + ? WHERE id = ?', args: [amount, userId] });
}

before(async () => {
  for (const f of ['schema.sql', 'seed.sql']) {
    await db.executeMultiple(readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8'));
  }
  await db.execute({
    sql: `INSERT INTO users (username, password_hash, role, name) VALUES ('admin', ?, 'admin', 'Admin')`,
    args: [await bcrypt.hash('admin123', 4)],
  });
  await db.execute("INSERT INTO term_folders (id, name) VALUES (1, 'Tests')");
  server = app.listen(0);
  attachLive(server);
  base = `http://127.0.0.1:${server.address().port}`;

  admin = await login('admin', 'admin123');
  adminId = (await call('GET', '/api/auth/me', admin)).body.id;
  const agentAId = await seedAccount({ username: 'secagentA', password: 'agent123', role: 'agent', name: 'Agent A' });
  const agentBId = await seedAccount({ username: 'secagentB', password: 'agent123', role: 'agent', name: 'Agent B' });
  await fund(agentAId, 100000);
  await fund(agentBId, 100000);
  agentA = await login('secagentA', 'agent123');
  agentB = await login('secagentB', 'agent123');

  const a = await call('POST', '/api/users', agentA, { username: 'seccustA', password: 'user123', role: 'user', name: 'Customer A' });
  const b = await call('POST', '/api/users', agentB, { username: 'seccustB', password: 'user123', role: 'user', name: 'Customer B' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  userAId = a.body.id;
  userBId = b.body.id;
  await call('POST', '/api/wallet/deposit', agentA, { user_id: userAId, amount: 20000 });
  await call('POST', '/api/wallet/deposit', agentB, { user_id: userBId, amount: 20000 });
  userA = await login('seccustA', 'user123');
  userB = await login('seccustB', 'user123');

  const term = await call('POST', '/api/terms', admin, {
    folder_id: 1, description: 'Sec draw', game: '2D', unit_price: 100, status: 'open',
  });
  termId = term.body.id;
  const slip = await call('POST', '/api/tickets', userA, {
    term_id: termId, entries: [{ bet_type_id: 0, input: '12', units: 1 }],
  });
  assert.equal(slip.status, 201, JSON.stringify(slip.body));
  slipAId = slip.body.id;
});

after(() => {
  closeLive();
  server.close();
  db.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows file lock */ }
});

describe('authentication', () => {
  test('API routes refuse a missing token', async () => {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    for (const path of [
      '/api/tickets',
      `/api/tickets/${slipAId}`,
      '/api/users',
      `/api/users/${userAId}`,
      '/api/wallet/transactions',
      '/api/reports/mine',
      `/api/terms/${termId}`,
      '/api/settings/company',
      '/api/auth/me',
    ]) {
      assert.equal((await fetch(base + path)).status, 401, path);
    }
  });

  test('forged JWT (wrong secret, swapped role, unsigned) is rejected', async () => {
    const asAdmin = jwt.sign({ role: 'admin' }, 'not-the-secret', { subject: String(userAId), expiresIn: '1h' });
    assert.equal((await call('GET', '/api/auth/me', asAdmin)).status, 401);

    const swappedRole = jwt.sign({ role: 'admin' }, 'test-secret', { subject: String(userAId), expiresIn: '1h' });
    const me = await call('GET', '/api/auth/me', swappedRole);
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'user'); // role comes from the database, not the token
    assert.equal((await call('POST', '/api/terms', swappedRole, {
      folder_id: 1, description: 'Hijack', game: '2D', unit_price: 100, status: 'open',
    })).status, 403);

    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'admin', sub: String(adminId) })).toString('base64url')}.`;
    assert.equal((await call('GET', '/api/auth/me', unsigned)).status, 401);
  });
});

describe('IDOR / broken access control (customer)', () => {
  test('customer cannot read another customer account, slip, wallet or report by changing ids', async () => {
    assert.equal((await call('GET', `/api/users/${userAId}`, userA)).status, 200);
    assert.equal((await call('GET', `/api/users/${userBId}`, userA)).status, 404);
    assert.equal((await call('GET', `/api/users/${adminId}`, userA)).status, 404);
    assert.equal((await call('GET', '/api/users', userA)).status, 403);

    assert.equal((await call('GET', `/api/tickets/${slipAId}`, userA)).status, 200);
    assert.equal((await call('GET', `/api/tickets/${slipAId}`, userB)).status, 404);
    const listed = await call('GET', `/api/tickets?user_id=${userAId}`, userB);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 0);
    const ownList = await call('GET', '/api/tickets', userA);
    assert.ok(ownList.body.every((t) => t.user_id === userAId));

    const txs = await call('GET', `/api/wallet/transactions?user_id=${userAId}`, userB);
    assert.equal(txs.status, 200);
    assert.equal(txs.body.length, 0);

    assert.equal((await call('GET', `/api/reports/mine?user_id=${userAId}`, userB)).status, 404);
    const mine = await call('GET', '/api/reports/mine', userB);
    assert.equal(mine.status, 200);
    assert.ok(!mine.body.some((r) => r.term_id === termId && r.tickets > 0));
  });

  test('customer cannot place, print or cancel another customer slip', async () => {
    const place = await call('POST', '/api/tickets', userB, {
      term_id: termId, user_id: userAId, entries: [{ bet_type_id: 0, input: '34', units: 1 }],
    });
    assert.equal(place.status, 404);

    assert.equal((await call('POST', `/api/tickets/${slipAId}/print`, userB)).status, 404);
    assert.equal((await call('POST', `/api/tickets/${slipAId}/cancel`, userA)).status, 403);
    assert.equal((await call('POST', `/api/tickets/${slipAId}/cancel`, userB)).status, 404);

    const req = await call('POST', '/api/slip-cancel-requests', userB, { ticket_id: slipAId });
    assert.equal(req.status, 404);
  });

  test('customer cannot cancel another account wallet request or approve money moves', async () => {
    const created = await call('POST', '/api/wallet-requests', userA, {
      type: 'deposit', amount: 100, method: 'Cash',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((await call('POST', `/api/wallet-requests/${created.body.id}/cancel`, userB)).status, 404);
    assert.equal((await call('POST', `/api/wallet-requests/${created.body.id}/approve`, userB)).status, 403);
    assert.equal((await call('POST', '/api/wallet/deposit', userA, { user_id: userBId, amount: 1 })).status, 403);
    assert.equal((await call('POST', `/api/wallet-requests/${created.body.id}/cancel`, userA)).status, 200);
  });
});

describe('admin privileges stay behind requireRole', () => {
  test('customer is forbidden on admin and upline-only routes', async () => {
    const forbidden = [
      ['POST', '/api/terms', { folder_id: 1, description: 'Nope', game: '2D', unit_price: 100, status: 'open' }],
      ['PATCH', `/api/terms/${termId}`, { status: 'closed' }],
      ['PUT', `/api/terms/${termId}/results`, [{ slot: 2, value: '12' }]],
      ['POST', `/api/terms/${termId}/settle`, {}],
      ['GET', `/api/terms/${termId}/purchases`],
      ['GET', `/api/terms/${termId}/ledger-users`],
      ['GET', `/api/terms/${termId}/number-bets?bet_type_id=0&number=12`],
      ['GET', `/api/terms/${termId}/exposure`],
      ['GET', `/api/terms/${termId}/user-limits`],
      ['GET', `/api/terms/${termId}/clearing`],
      ['PUT', `/api/terms/${termId}/limits`, [{ bet_type_id: 0, max_units: 1 }]],
      ['PUT', `/api/terms/${termId}/blocked`, []],
      ['PUT', `/api/terms/${termId}/hot`, { percent: 10, numbers: [] }],
      ['GET', '/api/term-folders'],
      ['GET', '/api/term-folders/templates'],
      ['POST', '/api/users', { username: 'hacked', password: 'xxxxxx', role: 'admin', name: 'X' }],
      ['PATCH', `/api/users/${userAId}`, { name: 'Renamed' }],
      ['PUT', `/api/users/${userAId}/role`, { role: 'admin' }],
      ['GET', '/api/users/commissions'],
      ['GET', '/api/prize-sets'],
      ['POST', '/api/prize-sets', { name: 'Mine' }],
      ['PUT', '/api/settings/company', { company_name: 'Hacked' }],
      ['GET', '/api/sales-data/summary'],
      ['GET', '/api/reports/overview'],
      ['GET', `/api/reports/summary?term_id=${termId}`],
      ['GET', '/api/wallet/float-targets'],
      ['PATCH', `/api/tickets/${slipAId}/items`, { items: [{ id: 1, units: 0 }] }],
      ['DELETE', `/api/terms/${termId}`, { confirm: 'DELETE' }],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await call(method, path, userA, body);
      assert.equal(res.status, 403, `${method} ${path} -> ${res.status}`);
    }
  });
});

describe('CORS, Helmet, PII columns', () => {
  test('Helmet headers are set and unknown browser origins are refused', async () => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.match(health.headers.get('x-frame-options') || '', /SAMEORIGIN/i);
    assert.ok(health.headers.get('content-security-policy'));
    assert.ok(health.headers.get('strict-transport-security'));
    assert.match(health.headers.get('permissions-policy') || '', /camera=\(\)/);
    assert.equal(health.headers.get('x-powered-by'), null);

    const blocked = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);

    const allowed = await fetch(`${base}/api/health`, { headers: { Origin: 'https://lotto.test' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://lotto.test');

    const sameOrigin = new URL(base).origin;
    const fromThisHost = await fetch(`${base}/api/health`, { headers: { Origin: sameOrigin } });
    assert.equal(fromThisHost.status, 200);
  });

  test('login and user lists do not dump hashes or payment numbers to everyone', async () => {
    const session = await call('POST', '/api/auth/login', null, { username: 'seccustA', password: 'user123' });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.password_hash, undefined);
    assert.ok(session.body.user.phone !== undefined);

    const listed = await call('GET', '/api/users?role=user', agentA);
    assert.equal(listed.status, 200);
    const row = listed.body.find((u) => u.id === userAId);
    assert.ok(row);
    assert.equal(row.address, undefined);
    assert.equal(row.phone2, undefined);
    assert.equal(row.kpay_no, undefined);
    assert.equal(row.kpay_name, undefined);
    assert.equal(row.wave_no, undefined);
    assert.equal(row.wave_name, undefined);

    const detail = await call('GET', `/api/users/${userAId}`, agentA);
    assert.equal(detail.status, 200);
    assert.ok('address' in detail.body);
    assert.ok('phone' in detail.body);
    assert.equal(detail.body.password_hash, undefined);
  });
});

describe('injection and input limits', () => {
  test('login and search do not run SQL from the typed text', async () => {
    const inj = await call('POST', '/api/auth/login', null, { username: "' OR 1=1 --", password: 'x' });
    assert.equal(inj.status, 401);

    const search = await call('GET', `/api/users?search=${encodeURIComponent("a' OR '1'='1")}`, admin);
    assert.equal(search.status, 200);
    assert.ok(Array.isArray(search.body));
    assert.ok(!search.body.some((u) => u.username === 'admin'));

    const likeAll = await call('GET', `/api/users?search=${encodeURIComponent('%')}`, admin);
    assert.equal(likeAll.status, 200);
    assert.equal(likeAll.body.length, 0);

    const underscore = await call('GET', `/api/users?search=${encodeURIComponent('_')}`, admin);
    assert.equal(underscore.status, 200);
    assert.ok(!underscore.body.some((u) => u.username === 'admin'));

    assert.equal((await call('GET', `/api/users?search=${'x'.repeat(51)}`, admin)).status, 400);
    assert.equal((await call('GET', '/api/terms?status=open', admin)).status, 200);
    assert.equal((await call('GET', '/api/terms?status=drop-table', userA)).status, 400);
    assert.equal((await call('GET', `/api/tickets/1%20OR%201=1`, userA)).status, 400);
  });

  test('ticket input and XSS-looking names stay data, not commands', async () => {
    const sqlInput = await call('POST', '/api/tickets', userA, {
      term_id: termId, entries: [{ bet_type_id: 0, input: "12'; DROP TABLE tickets;--", units: 1 }],
    });
    assert.equal(sqlInput.status, 400);

    const xss = '<script>alert(1)</script>';
    const named = await call('PATCH', `/api/users/${userAId}`, agentA, { name: xss });
    assert.equal(named.status, 200);
    const profile = await call('GET', `/api/users/${userAId}`, userA);
    assert.equal(profile.body.name, xss);

    await call('PUT', '/api/settings/company', admin, { company_name: xss.slice(0, 60) });
    const company = await call('GET', '/api/settings/company', userA);
    assert.equal(company.status, 200);
    assert.equal(company.body.company_name, xss.slice(0, 60));
    assert.equal((await call('PUT', '/api/settings/company', userA, { company_name: 'nope' })).status, 403);

    const stillThere = await call('GET', `/api/tickets/${slipAId}`, userA);
    assert.equal(stillThere.status, 200);
    assert.equal(stillThere.body.id, slipAId);
  });
});

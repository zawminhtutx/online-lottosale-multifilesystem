// Prints schema version, row counts and a foreign key check for a database.
// Usage: node scripts/db-status.mjs [url]   (defaults to TURSO_DATABASE_URL from .env)
import 'dotenv/config';
import { createClient } from '@libsql/client';
const db = createClient({ url: process.argv[2] || process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const q = async (sql) => (await db.execute(sql)).rows;
console.log('version', (await q("SELECT value FROM settings WHERE key='schema_version'"))[0]?.value);
console.log('users', (await q('SELECT COUNT(*) n, SUM(balance) b FROM users'))[0]);
console.log('cols', (await q('PRAGMA table_info(users)')).map(c => c.name).join(','));
console.log('fk_check', (await q('PRAGMA foreign_key_check')).length, 'problems');
console.log('children', (await q('SELECT (SELECT COUNT(*) FROM tickets) t, (SELECT COUNT(*) FROM wallet_transactions) w, (SELECT COUNT(*) FROM user_discounts) d'))[0]);
console.log('users sql', (await q("SELECT sql FROM sqlite_master WHERE name='users'"))[0].sql.includes('balance >= 0') ? 'HAS balance check' : 'no balance check');

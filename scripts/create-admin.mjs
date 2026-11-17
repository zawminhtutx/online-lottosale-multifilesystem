// Creates the first admin account.
// Usage: node scripts/create-admin.mjs <username> <password> [display name]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createClient } from '@libsql/client';

const [username, password, name = 'Administrator'] = process.argv.slice(2);
if (!username || !password || password.length < 6) {
  console.error('Usage: node scripts/create-admin.mjs <username> <password (6+ chars)> [name]');
  process.exit(1);
}

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const rs = await db.execute({
  sql: `INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'admin', ?) RETURNING id`,
  args: [username, await bcrypt.hash(password, 10), name],
});
console.log(`admin "${username}" created with id ${rs.rows[0].id}`);

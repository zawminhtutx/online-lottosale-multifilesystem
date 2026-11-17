// Dumps every table of the database in TURSO_DATABASE_URL to backups/<timestamp>.json.
// Usage: node scripts/backup.mjs
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const toObjects = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));

const schema = toObjects(await db.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
));
const tables = {};
for (const { name } of schema.filter((s) => s.type === 'table')) {
  tables[name] = toObjects(await db.execute(`SELECT * FROM "${name}"`));
}

const dir = new URL('../backups/', import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir);
writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), schema, tables }, null, 2));
console.log(`backup written: ${file.pathname}`);
console.log(Object.entries(tables).map(([k, v]) => `${k}: ${v.length}`).join(', '));

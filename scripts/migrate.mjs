// Creates/updates the database in TURSO_DATABASE_URL:
//   1. db/schema.sql + db/seed.sql (idempotent; new databases get the latest schema)
//   2. db/migrations/NNN_*.sql newer than settings.schema_version, in order
// Usage: node scripts/migrate.mjs            (uses .env)
//        TURSO_DATABASE_URL=file:local.db node scripts/migrate.mjs
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('TURSO_DATABASE_URL is not set');
  process.exit(1);
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const file of ['db/schema.sql', 'db/seed.sql']) {
  await db.executeMultiple(read(file));
  console.log(`applied ${file}`);
}

const version = async () =>
  Number((await db.execute("SELECT value FROM settings WHERE key = 'schema_version'")).rows[0]?.value ?? 1);

const migrations = readdirSync(new URL('../db/migrations/', import.meta.url))
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();
for (const file of migrations) {
  const target = Number(file.slice(0, 3));
  if (target <= (await version())) continue;
  await db.executeMultiple(read(`db/migrations/${file}`));
  if ((await version()) !== target) throw new Error(`${file} did not set schema_version to ${target}`);
  console.log(`applied db/migrations/${file}`);
}
console.log(`schema_version = ${await version()}`);

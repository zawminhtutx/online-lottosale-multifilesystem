import { createClient } from '@libsql/client';
import { config } from './config.js';

export const db = createClient({ url: config.dbUrl, authToken: config.dbToken });

// LIKE pattern for "contains this text". `%` `_` and `!` are literals (not wildcards).
// Pair with `LIKE ? ESCAPE '!'` so a search of `%` cannot match every row.
export function likeContains(value) {
  return `%${String(value).replace(/[!%_]/g, (ch) => `!${ch}`)}%`;
}

// libSQL rows carry both index and name keys; convert to plain objects for JSON.
export function rowsOf(rs) {
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));
}

// `client` may be the db or an open transaction.
export async function all(client, sql, args = []) {
  return rowsOf(await client.execute({ sql, args }));
}

export async function one(client, sql, args = []) {
  return (await all(client, sql, args))[0];
}

// Runs fn inside a write transaction, committing on success and rolling back on error.
export async function withTransaction(fn) {
  const tx = await db.transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

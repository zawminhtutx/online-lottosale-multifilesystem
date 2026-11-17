import { all, db } from '../db.js';
import { broadcast } from '../live.js';

// Auto Active: a draft term ("Active မလုပ်ရသေး") opens by itself once its open time (open_at) has
// come, without the admin pressing ▶ Active. Unactive clears open_at (see PATCH /terms/:id), so a
// term the admin hid on purpose stays hidden.
export async function openDueTerms(client = db) {
  const drafts = await all(client, `SELECT id, open_at FROM terms WHERE status = 'draft' AND open_at IS NOT NULL`);
  const now = Date.now();
  const due = drafts.filter((t) => Date.parse(t.open_at) <= now).map((t) => t.id);
  if (!due.length) return 0;
  await client.execute({
    sql: `UPDATE terms SET status = 'open' WHERE status = 'draft' AND id IN (${due.map(() => '?').join(',')})`,
    args: due,
  });
  broadcast('terms');
  return due.length;
}

// Checks every [ms] (30 s by default); also run on start. Doesn't keep the process alive.
export function startAutoOpen(ms = 30_000) {
  const run = () => openDueTerms().catch((e) => console.error('auto open:', e.message));
  run();
  setInterval(run, ms).unref();
}

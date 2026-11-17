// Lists strings shown in the admin and agent UIs that have no Myanmar translation.
// Usage: node scripts/check-i18n.mjs
import { readFileSync, readdirSync } from 'node:fs';

globalThis.document = { documentElement: {} }; // i18n.js sets <html lang>
globalThis.location = { pathname: '/' };
const { MY } = await import('../public/common/js/i18n.js');

const root = new URL('../public/', import.meta.url);
const jsFiles = (dir) => readdirSync(new URL(dir, root), { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => new URL(dir + f.split(/[\\/]/).join('/'), root));
const files = [...jsFiles('common/js/'), ...jsFiles('admin/js/'), ...jsFiles('agent/js/')];
const used = new Set();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // t('literal') / t("literal")
  for (const m of src.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)) used.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\bt\(\s*"((?:\\.|[^"\\])*)"/g)) used.add(m[1].replace(/\\"/g, '"'));
  // labels translated later with t(label): ['key', 'Label'] tables, nav { label: 'X' } and startApp({ title: 'X' })
  for (const m of src.matchAll(/\['[a-z_]+', '([A-Z][^']*)'\]/g)) used.add(m[1]);
  for (const m of src.matchAll(/\b(?:label|title): '([^']+)'/g)) used.add(m[1]);
}

// Values from the database rendered through badge() / t(value).
for (const k of ['active', 'suspended', 'closed', 'draft', 'open', 'drawn', 'settled', 'cancelled', 'won', 'lost',
  'This dashboard is for admin accounts only', 'This dashboard is for agent accounts only',
  'admin', 'master', 'agent', 'user', 'deposit', 'withdraw', 'transfer_in', 'transfer_out', 'bet', 'win', 'refund']) used.add(k);

// Shown as-is in both languages.
const UNTRANSLATED = new Set(['English', '#', '2D', '3D']);
// Text already written in Myanmar needs no entry.
const missing = [...used].filter((k) => !(k in MY) && !UNTRANSLATED.has(k) && !/[က-႟]/.test(k));
console.log(`${used.size} strings used, ${missing.length} missing a Myanmar translation`);
for (const k of missing) console.log('  -', JSON.stringify(k));
process.exit(missing.length ? 1 : 0);

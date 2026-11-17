import { Router } from 'express';
import { z } from 'zod';
import { all, db, one, withTransaction } from '../db.js';
import { requireRole } from '../auth.js';
import { assertManagesFolder, managesFolder, visibleOwnerSql } from '../books.js';
import { badRequest, notFound } from '../errors.js';
import { broadcast } from '../live.js';
import { eraseTerm, insertTerm } from './terms.js';

// Folders (ဖိုင်). A master owns the folders it creates (master_id). The admin still owns folders
// with no master — the original shared book. An agent only reads the folders its tree can see.
export const router = Router();

router.use((req, res, next) => {
  const list = req.method === 'GET' && (req.path === '/' || req.path === '');
  return (list ? requireRole('admin', 'master', 'agent') : requireRole('admin', 'master'))(req, res, next);
});
// Folder changes alter the term lists, so live clients reload them like any other term change.
router.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) broadcast('terms'); });
  next();
});

const id = z.coerce.number().int().positive();
const folderBody = z.object({ name: z.string().trim().min(1).max(60) });

async function loadFolder(folderId) {
  const folder = await one(db, 'SELECT * FROM term_folders WHERE id = ?', [folderId]);
  if (!folder) throw notFound('Folder not found');
  return folder;
}

async function assertNameFree(name, masterId, exceptId = 0) {
  if (await one(
    db,
    'SELECT 1 FROM term_folders WHERE name = ? AND id <> ? AND IFNULL(master_id, 0) = IFNULL(?, 0)',
    [name, exceptId, masterId]
  )) {
    throw badRequest('A folder with this name already exists');
  }
}

function present(actor, rows) {
  for (const row of rows) row.can_manage = managesFolder(actor, row);
  return rows;
}

const withCounts = (where = '', args = []) => all(
  db,
  `SELECT f.*, COUNT(t.id) AS term_count
   FROM term_folders f LEFT JOIN terms t ON t.folder_id = f.id
   ${where} GROUP BY f.id ORDER BY f.id DESC`,
  args
);

// Every folder, newest first.
router.get('/', async (req, res) => {
  const scope = await visibleOwnerSql(db, req.user, 'f.master_id');
  res.json(present(req.user, await withCounts(`WHERE ${scope.sql}`, scope.args)));
});

// Auto terms (အပါတ်စဥ် auto setting): a list of term templates kept in settings.term_templates.
// Creating a folder makes one term per template for each day from date to date_to: name
// "dd-mm-yyyy <name>", open / close / draw at the template's times that day. Unit price and break
// default to 1 when the admin leaves them blank (0 break = no limit). They start as drafts
// ("Active မလုပ်ရသေး"): users only see a term once the admin picks it and makes it Active (opens
// it). The admin deletes the ones not needed (a term without slips can be deleted at once).
const TEMPLATES_KEY = 'term_templates';
const templatesKey = (user) => (user?.role === 'master' ? `${TEMPLATES_KEY}:${user.id}` : TEMPLATES_KEY);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm');
const templateSchema = z.object({
  name: z.string().trim().max(60).default(''),
  game: z.enum(['2D', '3D']).default('2D'),
  unit_price: z.number().int().positive().default(1),
  unit_break: z.number().int().min(0).default(1),
  open: hhmm,
  close: hhmm,
  draw: hhmm,
});

export async function loadTemplates(client = db, user = null) {
  const row = await one(client, 'SELECT value FROM settings WHERE key = ?', [templatesKey(user)]);
  try {
    return z.array(templateSchema).parse(JSON.parse(row?.value ?? '[]'));
  } catch {
    return [];
  }
}

router.get('/templates', async (req, res) => res.json(await loadTemplates(db, req.user)));

router.put('/templates', async (req, res) => {
  const list = z.array(templateSchema).max(50).parse(req.body);
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [templatesKey(req.user), JSON.stringify(list)],
  });
  res.json(list);
});

// date … date_to: the folder's days (yyyy-mm-dd; date_to defaults to date, at most 62 days) and tz:
// the admin's UTC offset (+06:30) — the templates' times are local times on each day.
// auto_terms: false skips the automatic terms.
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_AUTO_DAYS = 62;
const newFolderBody = folderBody.extend({
  date: ymd.optional(),
  date_to: ymd.optional(),
  tz: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('+06:30'),
  auto_terms: z.boolean().default(true),
});

router.post('/', async (req, res) => {
  const { name, date, date_to: dateTo = date, tz, auto_terms: auto } = newFolderBody.parse(req.body);
  const masterId = req.user.role === 'master' ? req.user.id : null;
  await assertNameFree(name, masterId);
  // Calendar days from date to date_to (UTC midnights, used only for the date).
  const days = [];
  if (auto && date) {
    const last = new Date(`${dateTo}T00:00:00Z`);
    for (let day = new Date(`${date}T00:00:00Z`); day <= last; day = new Date(day.getTime() + 86400000)) {
      if (days.length === MAX_AUTO_DAYS) throw badRequest(`At most ${MAX_AUTO_DAYS} days at once`);
      days.push(day);
    }
    if (!days.length) throw badRequest('The end date is before the start date');
  }
  const templates = days.length ? await loadTemplates(db, req.user) : [];
  let made = 0;
  const folderId = await withTransaction(async (tx) => {
    const { id: newId } = await one(tx, 'INSERT INTO term_folders (name, master_id, created_by) VALUES (?, ?, ?) RETURNING id', [name, masterId, req.user.id]);
    for (const day of days) {
      const iso = day.toISOString().slice(0, 10);
      const [y, m, d] = iso.split('-');
      const at = (time) => new Date(`${iso}T${time}:00${tz}`).toISOString();
      for (const tpl of templates) {
        await insertTerm(tx, {
          description: `${d}-${m}-${y}${tpl.name ? ` ${tpl.name}` : ''}`,
          game: tpl.game,
          unit_price: tpl.unit_price,
          open_at: at(tpl.open),
          close_at: at(tpl.close),
          draw_at: at(tpl.draw),
          status: 'draft', // users see it only once the admin makes it Active (opens it)
          folder_id: newId,
          unit_break: tpl.unit_break,
        }, req.user.id);
        made += 1;
      }
    }
    return newId;
  });
  res.status(201).json({ ...present(req.user, await withCounts('WHERE f.id = ?', [folderId]))[0], auto_terms: made });
});

router.patch('/:id', async (req, res) => {
  const folder = await loadFolder(id.parse(req.params.id));
  await assertManagesFolder(db, req.user, folder.id);
  const { name } = folderBody.parse(req.body);
  await assertNameFree(name, folder.master_id, folder.id);
  await db.execute({ sql: 'UPDATE term_folders SET name = ? WHERE id = ?', args: [name, folder.id] });
  res.json(present(req.user, await withCounts('WHERE f.id = ?', [folder.id]))[0]);
});

// Deleting a folder erases it with its terms. An open term blocks it; a folder with sales is
// only allowed once every remaining term is settled (ငွေရှင်းပြီး). Draft / cancelled terms with
// no slips can go with it. Nothing is archived: what is deleted is gone.
router.delete('/:id', async (req, res) => {
  const folder = await loadFolder(id.parse(req.params.id));
  await assertManagesFolder(db, req.user, folder.id);
  const terms = await all(db, 'SELECT id, status, (SELECT COUNT(*) FROM tickets k WHERE k.term_id = t.id) AS slips FROM terms t WHERE folder_id = ?', [folder.id]);
  if (terms.some((t) => t.status === 'open')) throw badRequest('Cannot delete a folder that has open terms');
  const finished = new Set(['settled', 'cancelled', 'draft']);
  if (terms.some((t) => !finished.has(t.status)) || terms.some((t) => t.slips > 0 && t.status !== 'settled')) {
    throw badRequest('Only settled folders can be deleted');
  }
  await withTransaction(async (tx) => {
    for (const t of terms) await eraseTerm(tx, t.id);
    await tx.execute({ sql: 'DELETE FROM term_folders WHERE id = ?', args: [folder.id] });
    await tx.execute({
      sql: `INSERT INTO audit_logs (user_id, action, detail) VALUES (?, 'folder.delete', ?)`,
      args: [req.user.id, JSON.stringify({ folderId: folder.id, name: folder.name, terms: terms.length })],
    });
  });
  res.json({ id: folder.id, deleted: true, deleted_terms: terms.length });
});

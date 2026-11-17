import { one } from './db.js';
import { badRequest, forbidden, notFound } from './errors.js';

// A master's book is its own files (term_folders.master_id) and the terms inside them.
// The admin does not edit them: deleting a file, its terms and its agents is that master's job.
// Folders with no master are the original shared book, still run by the admin.

export function managesFolder(actor, folder) {
  const owner = folder?.master_id == null || folder.master_id === '' ? null : Number(folder.master_id);
  if (actor.role === 'admin') return owner == null;
  if (owner == null) return false;
  return actor.role === 'master' && owner === Number(actor.id);
}

export async function houseMasterId(client, user) {
  if (!user || user.role === 'admin') return null;
  if (user.role === 'master') return Number(user.id);
  const row = await one(
    client,
    `WITH RECURSIVE chain(id, parent_id, role) AS (
       SELECT id, parent_id, role FROM users WHERE id = ?
       UNION ALL
       SELECT u.id, u.parent_id, u.role FROM users u JOIN chain c ON u.id = c.parent_id
     )
     SELECT id FROM chain WHERE role = 'master' LIMIT 1`,
    [user.id]
  );
  return row ? Number(row.id) : null;
}

// SQL for a master_id column the actor may see: admin everything, a house its own rows plus the
// shared book (NULL), an account with no master only the shared book.
export async function visibleOwnerSql(client, actor, column) {
  if (actor.role === 'admin') return { sql: '1 = 1', args: [] };
  const house = await houseMasterId(client, actor);
  if (house) return { sql: `(${column} IS NULL OR ${column} = ?)`, args: [house] };
  return { sql: `${column} IS NULL`, args: [] };
}

export async function assertManagesFolder(client, actor, folderId) {
  const folder = await one(client, 'SELECT id, name, master_id FROM term_folders WHERE id = ?', [folderId]);
  if (!folder) throw badRequest('Folder not found');
  if (!managesFolder(actor, folder)) throw forbidden('This file belongs to another account');
  return folder;
}

export async function assertTermVisible(client, actor, term) {
  if (actor.role === 'admin') return;
  const owner = term.folder_id
    ? (await one(client, 'SELECT master_id FROM term_folders WHERE id = ?', [term.folder_id]))?.master_id
    : null;
  if (owner == null) return;
  const house = await houseMasterId(client, actor);
  if (Number(owner) !== Number(house)) throw notFound('Term not found');
}

export async function assertManagesTerm(client, actor, term) {
  if (!term.folder_id) {
    if (actor.role !== 'admin') throw forbidden('This term belongs to another account');
    return null;
  }
  return assertManagesFolder(client, actor, term.folder_id);
}

// Per-master configuration saved in the settings table (key = master_settings_{userId}).
// These settings affect downline behaviour: agent commission UI, prize set assignment,
// wallet display for users, and whether users may rename their own shop.
import { Router } from 'express';
import { z } from 'zod';
import { db, one } from '../db.js';
import { requireRole } from '../auth.js';

export const router = Router();

const schema = z.object({
  allow_agent_commission: z.boolean().optional(),
  allow_prize_assign: z.boolean().optional(),
  user_wallet_display: z.enum(['upline', 'master']).optional(),
  allow_name_edit: z.boolean().optional(),
});

function key(userId) { return `master_settings_${userId}`; }

export async function getMasterSettings(userId) {
  const row = await one(db, 'SELECT value FROM settings WHERE key = ?', [key(userId)]);
  return row ? JSON.parse(row.value) : {};
}

router.get('/', requireRole('master'), async (req, res) => {
  res.json(await getMasterSettings(req.user.id));
});

router.put('/', requireRole('master'), async (req, res) => {
  const data = schema.parse(req.body);
  const existing = await getMasterSettings(req.user.id);
  const merged = { ...existing, ...data };
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key(req.user.id), JSON.stringify(merged)],
  });
  res.json(merged);
});

// Business-wide settings shown in the apps. company_name: the heading of every စာရင်း the admin
// app shares (Viber / Telegram …). Anyone signed in may read it; only the admin changes it.
import { Router } from 'express';
import { z } from 'zod';
import { db, one } from '../db.js';
import { requireRole } from '../auth.js';

export const router = Router();

const COMPANY_KEY = 'company_name';

router.get('/company', async (_req, res) => {
  const row = await one(db, 'SELECT value FROM settings WHERE key = ?', [COMPANY_KEY]);
  res.json({ company_name: row?.value ?? '' });
});

router.put('/company', requireRole('admin'), async (req, res) => {
  const { company_name: name } = z.object({ company_name: z.string().trim().max(60) }).parse(req.body);
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [COMPANY_KEY, name],
  });
  res.json({ company_name: name });
});

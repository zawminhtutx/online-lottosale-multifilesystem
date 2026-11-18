import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, one } from '../db.js';
import { config } from '../config.js';
import { authenticate, PUBLIC_USER_COLUMNS, signToken } from '../auth.js';
import { houseMasterId } from '../books.js';
import { HttpError, badRequest } from '../errors.js';
import { getMasterSettings } from './master-settings.js';

export const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: 'draft-8', legacyHeaders: false });
const brandLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

// Login screens ask for this username's house logo: a master's own picture, or the master above
// an agent (a user under that agent, and a user hanging directly under the master, get the same
// picture). Unknown names, the admin, and a master with no picture come back as null.
router.get('/brand', brandLimiter, async (req, res) => {
  const username = z.object({ username: z.string().trim().max(60).optional() }).parse(req.query).username ?? '';
  if (!username) return res.json({ logo: null });
  const user = await one(db, 'SELECT id, role FROM users WHERE username = ?', [username]);
  if (!user) return res.json({ logo: null });
  const masterId = await houseMasterId(db, user);
  if (!masterId) return res.json({ logo: null });
  const master = await one(db, 'SELECT logo FROM users WHERE id = ?', [masterId]);
  const logo = master?.logo ? String(master.logo) : '';
  res.json({ logo: logo || null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const user = await one(db, `SELECT ${PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE username = ?`, [username]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid username or password');
  }
  if (user.status !== 'active') throw new HttpError(403, 'Account is not active');

  await db.execute({
    sql: `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`,
    args: [user.id],
  });
  await db.execute({
    sql: `INSERT INTO audit_logs (user_id, action, client_ip) VALUES (?, 'auth.login', ?)`,
    args: [user.id, req.ip],
  });
  const { password_hash: _hash, ...publicUser } = user;
  res.json({ token: signToken(user), user: publicUser });
});

router.get('/me', authenticate, async (req, res) => {
  // For non-master users include their master's settings so the mobile app can apply them.
  if (req.user.role === 'user' || req.user.role === 'agent') {
    const masterId = await houseMasterId(db, req.user);
    if (masterId) {
      const masterSettings = await getMasterSettings(masterId);
      return res.json({ ...req.user, master_settings: masterSettings });
    }
  }
  res.json(req.user);
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = z
    .object({ current_password: z.string(), new_password: z.string().min(6) })
    .parse(req.body);
  const { password_hash } = await one(db, 'SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current_password, password_hash))) throw badRequest('Current password is wrong');
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [await bcrypt.hash(new_password, 10), req.user.id],
  });
  res.json({ ok: true });
});

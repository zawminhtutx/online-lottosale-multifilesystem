import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, one } from '../db.js';
import { config } from '../config.js';
import { authenticate, PUBLIC_USER_COLUMNS, signToken } from '../auth.js';
import { HttpError, badRequest } from '../errors.js';

export const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: 'draft-8', legacyHeaders: false });

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

router.get('/me', authenticate, (req, res) => res.json(req.user));

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

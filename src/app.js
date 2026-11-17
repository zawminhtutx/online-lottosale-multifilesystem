import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import { isAllowedOrigin } from './config.js';
import { all, db } from './db.js';
import { authenticate } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { router as authRoutes } from './routes/auth.js';
import { router as userRoutes } from './routes/users.js';
import { router as walletRoutes } from './routes/wallet.js';
import { router as walletRequestRoutes } from './routes/wallet-requests.js';
import { router as slipCancelRequestRoutes } from './routes/slip-cancel-requests.js';
import { router as salesDataRoutes } from './routes/sales-data.js';
import { router as termRoutes } from './routes/terms.js';
import { router as termFolderRoutes } from './routes/term-folders.js';
import { router as ticketRoutes } from './routes/tickets.js';
import { router as reportRoutes } from './routes/reports.js';
import { router as prizeRoutes } from './routes/prizes.js';
import { router as settingsRoutes } from './routes/settings.js';

export const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // The online web app may print through the POS server running on the same machine.
      // (data: — the slip renderer turns its canvas image into a Blob with fetch(dataUrl).)
      connectSrc: ["'self'", 'data:', 'http://localhost:*', 'http://127.0.0.1:*'],
      imgSrc: ["'self'", 'data:', 'blob:'], // slip previews (URL.createObjectURL)
      // Vite inlines the small entry sounds as data: URLs.
      mediaSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'sameorigin' },
  hsts: { maxAge: 15552000, includeSubDomains: true },
}));
app.use((req, res, next) => {
  cors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin, req)),
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(req, res, next);
});
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (isAllowedOrigin(req.get('origin'), req)) return next();
  res.status(403).json({ error: 'Origin not allowed' });
});
// A master logo is a data URL. 200kb dropped a normal photo (the file check allowed 350 KB,
// and base64 is larger than the file), so the save never stored a picture for the master list.
app.use(express.json({ limit: '1mb' }));

const publicDir = (name) => express.static(fileURLToPath(new URL(`../public/${name}`, import.meta.url)));
app.use('/common', publicDir('common'));
app.use('/admin', publicDir('admin'));
app.use('/agent', publicDir('agent'));

// Online web app for users (online-web/, built to online-web/dist) at the site root.
const onlineWebDir = fileURLToPath(new URL('../online-web/dist', import.meta.url));
const onlineWebIndex = fileURLToPath(new URL('../online-web/dist/index.html', import.meta.url));
app.use(express.static(onlineWebDir, { index: 'index.html' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);

app.use('/api', authenticate);
app.get('/api/meta', async (req, res) => {
  const [betTypes, prizeRates] = await Promise.all([
    all(db, 'SELECT * FROM bet_types WHERE is_active = 1 ORDER BY id'),
    all(db, `SELECT bet_type_id, multiplier FROM prize_rates WHERE prize_set_id = ? AND side = 'sale'`, [req.user.prize_set_id]),
  ]);
  res.json({ bet_types: betTypes, prize_rates: prizeRates });
});
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wallet-requests', walletRequestRoutes);
app.use('/api/slip-cancel-requests', slipCancelRequestRoutes);
app.use('/api/sales-data', salesDataRoutes);
app.use('/api/terms', termRoutes);
app.use('/api/term-folders', termFolderRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/prize-sets', prizeRoutes);
app.use('/api/settings', settingsRoutes);

// Client-side routes of the online web app (/login, /terms, /sale/3, ...) load its index.html.
app.get(/^\/(?!api\/|admin\/|agent\/|common\/).*/, (req, res, next) => {
  if (!existsSync(onlineWebIndex)) return next();
  res.sendFile(onlineWebIndex);
});

app.use((_req, _res, next) => next(notFound()));
app.use(errorHandler);

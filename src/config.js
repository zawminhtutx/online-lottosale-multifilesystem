import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

// Browser origins allowed to call the API (CORS). Empty = same-origin pages + apps with no Origin
// (Flutter). `*` allows every site and is ignored in production. Comma-separated list otherwise.
function parseCors() {
  const raw = (process.env.CORS_ORIGIN ?? '').trim();
  const production = process.env.NODE_ENV === 'production';
  if (raw === '*' && production) {
    console.warn('CORS_ORIGIN=* is ignored in production; only same-origin and non-browser clients may call the API');
    return { corsAllowAll: false, corsOrigins: [] };
  }
  if (raw === '*') return { corsAllowAll: true, corsOrigins: [] };
  return { corsAllowAll: false, corsOrigins: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

const cors = parseCors();

function header(req, name) {
  if (!req) return '';
  if (typeof req.get === 'function') return req.get(name) || '';
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function originHost(origin) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return '';
  }
}

// Same-origin browsers (the Render site itself) send Origin. Empty CORS_ORIGIN used to
// 403 those requests and made the live site unusable. Flutter still sends no Origin.
export function isAllowedOrigin(origin, req) {
  if (!origin) return true;
  if (cors.corsAllowAll) return true;
  if (cors.corsOrigins.includes(origin)) return true;
  const host = String(header(req, 'x-forwarded-host') || header(req, 'host'))
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!host) return false;
  const proto = String(header(req, 'x-forwarded-proto') || req.protocol || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (origin.toLowerCase() === `${proto}://${host}`) return true;
  return originHost(origin) === host;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  dbUrl: required('TURSO_DATABASE_URL'),
  dbToken: process.env.TURSO_AUTH_TOKEN,
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  corsAllowAll: cors.corsAllowAll,
  corsOrigins: cors.corsOrigins,
  maxItemsPerTicket: Number(process.env.MAX_ITEMS_PER_TICKET || 1000),
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT || 20), // login attempts per IP per 15 minutes
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
};

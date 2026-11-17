// Online Lotto Print Agent — runs on the user's own Windows PC so the online web app can list this
// machine's printers and print slips straight to one (no print dialog). Browsers cannot see local
// printers themselves; the app's Slip Printer Settings talks to this agent at http://localhost:3010.
//
//   GET  /api/health           -> { ok: true }
//   GET  /api/system-printers  -> ["EPSON TM-T82", "Microsoft Print to PDF", ...]
//   POST /api/print-image      { printer, imageBase64 (data URL of a PNG), paperWidth: "58mm" | "80mm" }
//
// No packages needed: `node server.mjs` (or start-print-agent.bat). Listens on 127.0.0.1 only.
// PRINT_AGENT_PORT changes the port; PRINT_AGENT_ORIGINS adds allowed web origins (comma separated,
// "*" allows any).
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PRINT_AGENT_PORT) || 3010;
const PRINT_SCRIPT = fileURLToPath(new URL('./print-image.ps1', import.meta.url));
const MAX_BODY = 10 * 1024 * 1024;

// Which web pages may use the agent: this PC and the LAN (any port), the Render site, plus extras.
const extraOrigins = (process.env.PRINT_AGENT_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
function originAllowed(origin) {
  if (!origin) return true; // not a browser page (e.g. curl)
  if (extraOrigins.includes('*') || extraOrigins.includes(origin)) return true;
  let host;
  try { ({ hostname: host } = new URL(origin)); } catch { return false; }
  return host === 'localhost'
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host.endsWith('.onrender.com');
}

function powershell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      // First line only: PowerShell appends "At ...ps1:15 char:44" and similar noise.
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().split(/\r?\n/)[0])) : resolve(stdout)));
  });
}

async function listPrinters() {
  const out = await powershell(['-Command', 'Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress']);
  const text = out.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function printImage({ printer, imageBase64, paperWidth }) {
  if (!printer || typeof printer !== 'string') throw Object.assign(new Error('printer is required'), { status: 400 });
  const match = /^data:image\/png;base64,(.+)$/.exec(imageBase64 || '');
  if (!match) throw Object.assign(new Error('imageBase64 must be a PNG data URL'), { status: 400 });
  const widthMm = paperWidth === '58mm' ? 58 : 80;
  const file = join(tmpdir(), `online-lotto-slip-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await writeFile(file, Buffer.from(match[1], 'base64'));
  try {
    await powershell(['-File', PRINT_SCRIPT, '-Printer', printer, '-File', file, '-WidthMm', String(widthMm)]);
  } finally {
    unlink(file).catch(() => {});
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  if (!originAllowed(origin)) return send(403, { error: 'Origin not allowed' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Chrome asks before a public site (e.g. the Render page) may call a local address.
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true });
    if (req.method === 'GET' && path === '/api/system-printers') return send(200, await listPrinters());
    if (req.method === 'POST' && path === '/api/print-image') {
      await printImage(await readJson(req));
      return send(200, { ok: true });
    }
    return send(404, { error: 'Not found' });
  } catch (err) {
    console.error(new Date().toISOString(), req.method, req.url, err.message);
    return send(err.status || 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Online Lotto Print Agent — http://localhost:${PORT}`);
  if (process.platform !== 'win32') console.warn('Warning: printing works on Windows only.');
  listPrinters()
    .then((names) => console.log(`Printers: ${names.length ? names.join(', ') : '(none found)'}`))
    .catch((e) => console.warn('Could not list printers:', e.message));
});

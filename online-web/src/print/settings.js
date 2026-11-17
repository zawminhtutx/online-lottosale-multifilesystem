// Slip printer settings, kept per device in localStorage (same keys and defaults as the POS
// app's printer.js). Branding (company name / footer / logo) is set here in the online app's own
// Slip Printer Settings, since there is no POS server to share it from.

const SLIP_WIDTH_KEY = 'lotto_slip_printer_width';
const SLIP_PRINTER_KEY = 'lotto_slip_printer_name';
const SLIP_PRINTER_SUGGESTIONS_KEY = 'lotto_slip_printer_suggestions';
const SLIP_LAYOUT_KEY = 'lotto_slip_layout';
const SLIP_BRANDING_KEY = 'lotto_slip_branding';
const PRINT_SERVER_KEY = 'lotto_local_print_server';

// A local print server on this machine (e.g. the POS server), when one runs, prints straight to Windows printers.
const PRINT_SERVER = 'http://localhost:3010';

const DEFAULT_SLIP_LAYOUT = {
  fontSize: 'normal', // small | normal | large
  bold: false,
  columns: 'two', // single | two
  showTotal: true,
  showAmount: true,
  // print a pattern entry ("45R", "1P") as one line instead of every expanded number
  groupPrint: true,
  marginMm: 1.6,
  itemsExtraMarginMm: 8,
};

// companyName left empty on this device = the company name the admin set on the server (see
// setServerCompanyName), or '2D/3D LOTTERY' when there is none.
const FALLBACK_COMPANY = '2D/3D LOTTERY';
let serverCompany = '';
export function setServerCompanyName(name) { serverCompany = (name || '').trim(); }

const DEFAULT_SLIP_BRANDING = {
  companyName: '',
  footerText: '— Thank you —',
  logoDataUrl: null,
  logoWidthMm: 20,
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: setting lasts for this page only */ }
}

function readJson(key) {
  try { return JSON.parse(read(key, '{}')) || {}; } catch { return {}; }
}

// This device's own branding as saved (companyName '' = not set here).
// Older versions saved the whole branding object, default name included: that old default counts
// as "not set here", so those devices follow the server's name too.
const ownSlipBranding = () => {
  const own = { ...DEFAULT_SLIP_BRANDING, ...readJson(SLIP_BRANDING_KEY) };
  if ((own.companyName || '').trim() === FALLBACK_COMPANY) own.companyName = '';
  return own;
};
export const getOwnCompanyName = () => (ownSlipBranding().companyName || '').trim();
export const defaultCompanyName = () => serverCompany || FALLBACK_COMPANY;
// What slips print: the device's own company name, else the server's.
export const getSlipBranding = () => {
  const own = ownSlipBranding();
  return { ...own, companyName: (own.companyName || '').trim() || defaultCompanyName() };
};
export function setSlipBranding(partial) {
  const next = { ...ownSlipBranding(), ...partial }; // never stores the server's name as this device's own
  write(SLIP_BRANDING_KEY, JSON.stringify(next));
  return getSlipBranding();
}

const getLocalSlipLayout = () => ({ ...DEFAULT_SLIP_LAYOUT, ...readJson(SLIP_LAYOUT_KEY) });

// What the renderer draws from: layout prefs plus branding.
export const getSlipLayout = () => ({ ...getLocalSlipLayout(), ...getSlipBranding() });
export function setSlipLayout(partial) {
  const next = { ...getLocalSlipLayout(), ...partial };
  write(SLIP_LAYOUT_KEY, JSON.stringify(next));
  return { ...next, ...getSlipBranding() };
}

export const getSlipWidth = () => read(SLIP_WIDTH_KEY, '80mm');
export const setSlipWidth = (width) => write(SLIP_WIDTH_KEY, width);

export const getSlipPrinterName = () => read(SLIP_PRINTER_KEY, '');
export function setSlipPrinterName(name) {
  const clean = (name || '').trim();
  if (clean) {
    const list = getSlipPrinterSuggestions().filter((n) => n !== clean);
    write(SLIP_PRINTER_SUGGESTIONS_KEY, JSON.stringify([clean, ...list].slice(0, 8)));
  }
  write(SLIP_PRINTER_KEY, clean);
}

export function getSlipPrinterSuggestions() {
  try { return JSON.parse(read(SLIP_PRINTER_SUGGESTIONS_KEY, '[]')) || []; } catch { return []; }
}

// Calls that server's printer routes (/api/system-printers, /api/print-image). The address is
// fixed (no longer a setting); an address saved by older versions is dropped.
try { localStorage.removeItem(PRINT_SERVER_KEY); } catch { /* ignore */ }
export async function printServerApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PRINT_SERVER}/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.error || `Print server error (${res.status})`);
  return data;
}

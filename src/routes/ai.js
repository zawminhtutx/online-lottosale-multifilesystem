// Gemini AI proxy — the mobile app calls this so the API request comes from the server,
// bypassing geographic restrictions on direct client access to the Google AI endpoint.
// The API key is stored in the settings table (key = 'gemini_api_key'); admin sets it
// once via the web dashboard and all users share it.
import { Router } from 'express';
import { z } from 'zod';
import { db, one } from '../db.js';
import { requireRole } from '../auth.js';

export const router = Router();

const GEMINI_KEY = 'gemini_api_key';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Cache the detected model per API key so we don't call ListModels on every request.
const _modelCache = new Map();

async function detectModel(apiKey) {
  if (_modelCache.has(apiKey)) return _modelCache.get(apiKey);
  const res = await fetch(`${GEMINI_BASE}?key=${apiKey}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message ?? `ListModels failed (${res.status})`);
  }
  const { models = [] } = await res.json();
  const preferred = [
    'gemini-2.5-flash-lite', 'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-flash', 'gemini-1.5-pro',
    'gemini-1.0-pro', 'gemini-pro',
    'gemini-2.0-flash',
  ];
  let found = null;
  outer: for (const want of preferred) {
    for (const m of models) {
      if (m.name?.includes(want) && m.supportedGenerationMethods?.includes('generateContent')) {
        found = m.name.replace('models/', '');
        break outer;
      }
    }
  }
  if (!found) {
    for (const m of models) {
      if (m.supportedGenerationMethods?.includes('generateContent')) {
        found = m.name.replace('models/', '');
        break;
      }
    }
  }
  if (!found) throw new Error('ဤ API key မှ generateContent ပံ့ပိုးသော model မတွေ့ပါ');
  _modelCache.set(apiKey, found);
  return found;
}

const PROMPT =
  'You are a Myanmar 2D/3D lottery bet checker and formatter.\n' +
  'Parse the following pasted message and output ONLY valid bet lines in standard format.\n\n' +
  'Output format (one bet per line): [number_or_pattern] [units]\n' +
  'Examples: "25 1000", "25R 500", "R 3000", "3P 200", "W 500"\n\n' +
  'Rules:\n' +
  '- 2-digit plain numbers: 00–99\n' +
  '- Reverse: "25R" or "R 3000" (R-header for the numbers below it)\n' +
  '- Patterns: R, RR, P, W, K, N, SP, MP, SS, SM, MS, MM, T, 1P–9P, 1B–9B, 12*, *12, 1*2\n' +
  '- Units are plain integers (strip ks / ကျပ် / , separators)\n' +
  '- Myanmar digits ၀၁၂၃၄၅၆၇၈၉ → 0123456789\n' +
  '- Ignore greetings, dates, names, running totals, section headers\n' +
  '- Output ONLY the bet lines. No explanation, no extra text.\n\n' +
  'Input:\n';

// Admin: check whether a key is saved (returns {configured: bool}, never the key itself).
router.get('/key', requireRole('admin'), async (_req, res) => {
  const row = await one(db, 'SELECT value FROM settings WHERE key = ?', [GEMINI_KEY]);
  res.json({ configured: !!(row?.value) });
});

// Admin: save or clear the key.
router.put('/key', requireRole('admin'), async (req, res) => {
  const { key } = z.object({ key: z.string().trim().max(200) }).parse(req.body);
  if (key) {
    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [GEMINI_KEY, key],
    });
  } else {
    await db.execute({ sql: `DELETE FROM settings WHERE key = ?`, args: [GEMINI_KEY] });
  }
  _modelCache.clear();
  res.json({ ok: true });
});

// Any authenticated user: proxy a translate-bets request to Gemini.
router.post('/translate-bets', async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(5000) }).parse(req.body);

  const row = await one(db, 'SELECT value FROM settings WHERE key = ?', [GEMINI_KEY]);
  const apiKey = row?.value;
  if (!apiKey) {
    return res.status(503).json({ error: 'Admin ကနေ Gemini AI API key မသတ်မှတ်ရသေးပါ — ဝဘ် dashboard Settings မှာ ထည့်ပါ' });
  }

  let model;
  try {
    model = await detectModel(apiKey);
  } catch (err) {
    return res.status(502).json({ error: `Gemini model ရှာမတွေ့ပါ: ${err.message}` });
  }
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  let geminiRes;
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT + text }] }] }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    return res.status(502).json({ error: `Gemini ချိတ်ဆက်မှု မအောင်မြင်ပါ: ${err.message}` });
  }

  const json = await geminiRes.json().catch(() => ({}));
  if (!geminiRes.ok) {
    const detail = json.error?.message ?? geminiRes.status;
    return res.status(502).json({ error: `Gemini error: ${detail}` });
  }

  const result = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!result) return res.status(502).json({ error: 'Gemini မှ ဖြေဆိုချက် မရပါ' });

  res.json({ result });
});

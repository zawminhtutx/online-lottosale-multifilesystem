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

const PROMPT =
  'You are a Myanmar 2D/3D lottery bet text parser.\n' +
  'Convert the following Viber/Telegram message to standard bet format.\n\n' +
  'Rules:\n' +
  '- Each bet on its own line: [number_or_pattern] [units]\n' +
  '- 2-digit numbers 00–99; "25R 500" for reverse; "R 3000" as R-header\n' +
  '- Units are plain integers (remove ks/ကျပ် suffix)\n' +
  '- Myanmar digits ၀၁၂၃၄၅၆၇၈၉ → 0123456789\n' +
  '- Strip greetings, dates, names, totals, section headers\n' +
  '- Output ONLY the converted bet lines. No explanation.\n\n' +
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

  const model = 'gemini-1.5-flash';
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

-- 018: KPay / WavePay numbers on admin and agent accounts. A user's ငွေဖြည့် screen shows their
-- agent's numbers (or the admin's when the agent has none) so they know where to send the money.

ALTER TABLE users ADD COLUMN kpay_no TEXT;
ALTER TABLE users ADD COLUMN kpay_name TEXT;
ALTER TABLE users ADD COLUMN wave_no TEXT;
ALTER TABLE users ADD COLUMN wave_name TEXT;

UPDATE settings SET value = '18', updated_at = datetime('now') WHERE key = 'schema_version';

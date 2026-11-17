-- 025: masters / agents may save over the unit break on the admin Sale page only when the
-- admin turns this on for that account. Admins always can.

ALTER TABLE users ADD COLUMN sale_over INTEGER NOT NULL DEFAULT 0 CHECK (sale_over IN (0, 1));

UPDATE settings SET value = '25', updated_at = datetime('now') WHERE key = 'schema_version';

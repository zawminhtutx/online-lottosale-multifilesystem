-- 026: a master may add / edit a term's hot numbers only when the admin turns this on
-- for that master account. Agents never get it. Admins always can.

ALTER TABLE users ADD COLUMN hot_edit INTEGER NOT NULL DEFAULT 0 CHECK (hot_edit IN (0, 1));

UPDATE settings SET value = '26', updated_at = datetime('now') WHERE key = 'schema_version';

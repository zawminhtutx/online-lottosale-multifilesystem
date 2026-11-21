-- 028: close-time ledger emails go only to addresses selected by the owning master.
-- The old agent/user ledger_mail flags are retained for historical compatibility but are no
-- longer used as recipients.

ALTER TABLE users ADD COLUMN ledger_recipients TEXT;

UPDATE settings SET value = '28', updated_at = datetime('now') WHERE key = 'schema_version';

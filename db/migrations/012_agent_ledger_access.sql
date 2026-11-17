-- 012: agents only see the Live Ledger (their own users' bets per number) when the admin turns it
-- on for that agent.

ALTER TABLE users ADD COLUMN ledger_access INTEGER NOT NULL DEFAULT 0 CHECK (ledger_access IN (0, 1));

UPDATE settings SET value = '12', updated_at = datetime('now') WHERE key = 'schema_version';

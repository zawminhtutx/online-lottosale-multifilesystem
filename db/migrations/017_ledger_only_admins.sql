-- 017: view-only admin accounts. An admin with ledger_only = 1 can only open the Live Ledger (every
-- user's bets per number, live) — nothing else is shown, and the server refuses every other call.

ALTER TABLE users ADD COLUMN ledger_only INTEGER NOT NULL DEFAULT 0 CHECK (ledger_only IN (0, 1));

UPDATE settings SET value = '17', updated_at = datetime('now') WHERE key = 'schema_version';

-- 022: a master may be allowed to see everything the admin sees (users.view_all = 1, set by the
-- admin): every account, slip, sale, report, Live Ledger and wallet movement — read only. Changes
-- (money, slips, accounts) stay limited to the master's own downline. Off for everyone at first.

ALTER TABLE users ADD COLUMN view_all INTEGER NOT NULL DEFAULT 0 CHECK (view_all IN (0, 1));

UPDATE settings SET value = '22', updated_at = datetime('now') WHERE key = 'schema_version';

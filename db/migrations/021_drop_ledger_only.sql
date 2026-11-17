-- 021: the view-only admin (users.ledger_only = 1: Live Ledger and nothing else) is gone.
-- Without the column such an account would be a full admin, so every one of them is suspended
-- first: it can no longer sign in until an admin turns it back on (as a full admin) on purpose.
-- Masters and agents keep their own Live Ledger switch (users.ledger_access).

UPDATE users SET status = 'suspended', updated_at = datetime('now')
WHERE ledger_only = 1 AND status = 'active';

ALTER TABLE users DROP COLUMN ledger_only;

UPDATE settings SET value = '21', updated_at = datetime('now') WHERE key = 'schema_version';

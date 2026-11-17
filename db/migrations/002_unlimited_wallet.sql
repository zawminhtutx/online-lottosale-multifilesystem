-- 002: unlimited (credit) wallets.
-- Adds users.unlimited and drops CHECK (balance >= 0) so unlimited accounts can go negative.
-- SQLite cannot drop a CHECK constraint in place, so the users table is rebuilt.
-- Child tables reference users by name, so they keep working after the rename.

PRAGMA foreign_keys = OFF;
BEGIN;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE users_new (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','agent','user')),
  parent_id      INTEGER REFERENCES users(id),
  name           TEXT NOT NULL,
  name_mm        TEXT,
  phone          TEXT,
  phone2         TEXT,
  address        TEXT,
  prize_set_id   INTEGER NOT NULL DEFAULT 0 REFERENCES prize_sets(id),
  balance        INTEGER NOT NULL DEFAULT 0,
  unlimited      INTEGER NOT NULL DEFAULT 0 CHECK (unlimited IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new
  (id, username, password_hash, role, parent_id, name, name_mm, phone, phone2, address,
   prize_set_id, balance, unlimited, status, last_login_at, created_at, updated_at)
SELECT id, username, password_hash, role, parent_id, name, name_mm, phone, phone2, address,
       prize_set_id, balance, 0, status, last_login_at, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

UPDATE settings SET value = '2', updated_at = datetime('now') WHERE key = 'schema_version';
COMMIT;
PRAGMA foreign_keys = ON;

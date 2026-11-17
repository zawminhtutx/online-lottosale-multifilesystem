-- 020: the master role. Account levels are now admin (superadmin) > master > agent > user, chained
-- by parent_id: a master belongs to the admin, an agent to a master (or straight to the admin), a
-- user to an agent (or straight to a master / the admin). Every account may act only on its own
-- downline, however deep.
--
-- Nothing is renamed: the existing 'admin' accounts stay 'admin' and are the superadmin level, so
-- every account, slip, balance and client keeps working. Only the role CHECK has to make room for
-- 'master', which SQLite cannot alter in place — the table is rebuilt (column for column as in
-- db/schema.sql) with the rows copied over. Take a backup first: npm run backup.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','master','agent','user')),
  parent_id      INTEGER REFERENCES users(id),
  name           TEXT NOT NULL,
  name_mm        TEXT,
  phone          TEXT,
  phone2         TEXT,
  address        TEXT,
  prize_set_id   INTEGER NOT NULL DEFAULT 0 REFERENCES prize_sets(id),
  balance        INTEGER NOT NULL DEFAULT 0,
  unlimited      INTEGER NOT NULL DEFAULT 0 CHECK (unlimited IN (0,1)),
  ledger_access  INTEGER NOT NULL DEFAULT 0 CHECK (ledger_access IN (0, 1)),
  ledger_only    INTEGER NOT NULL DEFAULT 0 CHECK (ledger_only IN (0, 1)),
  kpay_no        TEXT,
  kpay_name      TEXT,
  wave_no        TEXT,
  wave_name      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new
  (id, username, password_hash, role, parent_id, name, name_mm, phone, phone2, address, prize_set_id,
   balance, unlimited, ledger_access, ledger_only, kpay_no, kpay_name, wave_no, wave_name, status,
   last_login_at, created_at, updated_at)
SELECT id, username, password_hash, role, parent_id, name, name_mm, phone, phone2, address, prize_set_id,
       balance, unlimited, ledger_access, ledger_only, kpay_no, kpay_name, wave_no, wave_name, status,
       last_login_at, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

PRAGMA foreign_keys = ON;

UPDATE settings SET value = '20', updated_at = datetime('now') WHERE key = 'schema_version';

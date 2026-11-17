-- 027: each master owns their own files and prize sets. Accounts can store an email.
-- Masters also have a logo and a master name. Agents and users can be chosen to receive
-- the 00-99 / 000-999 ledger by email once a term's close time has passed.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN master_name TEXT;
ALTER TABLE users ADD COLUMN logo TEXT;
ALTER TABLE users ADD COLUMN ledger_mail INTEGER NOT NULL DEFAULT 0 CHECK (ledger_mail IN (0, 1));

ALTER TABLE terms ADD COLUMN ledger_mailed_at TEXT;

PRAGMA foreign_keys = OFF;

CREATE TABLE term_folders_new (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  master_id   INTEGER REFERENCES users(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO term_folders_new (id, name, created_by, created_at)
  SELECT id, name, created_by, created_at FROM term_folders;
DROP TABLE term_folders;
ALTER TABLE term_folders_new RENAME TO term_folders;
CREATE UNIQUE INDEX idx_term_folders_owner_name ON term_folders(IFNULL(master_id, 0), name);
CREATE INDEX idx_term_folders_master ON term_folders(master_id);

CREATE TABLE prize_sets_new (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  twod_multiplier  INTEGER NOT NULL DEFAULT 10,
  master_id        INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO prize_sets_new (id, name, twod_multiplier, created_at)
  SELECT id, name, twod_multiplier, created_at FROM prize_sets;
DROP TABLE prize_sets;
ALTER TABLE prize_sets_new RENAME TO prize_sets;
CREATE UNIQUE INDEX idx_prize_sets_owner_name ON prize_sets(IFNULL(master_id, 0), name);

PRAGMA foreign_keys = ON;

UPDATE settings SET value = '27', updated_at = datetime('now') WHERE key = 'schema_version';

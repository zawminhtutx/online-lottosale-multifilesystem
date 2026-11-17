-- 014: ငွေရှင်း — per term, the admin marks a user's or an agent's account as settled up (the slips'
-- bet − commission − winnings is squared outside the system). A snapshot of the figures is kept
-- with who cleared it and when. Winnings themselves are still paid into wallets when results are saved.

CREATE TABLE IF NOT EXISTS term_clearings (
  id          INTEGER PRIMARY KEY,
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  account_id  INTEGER NOT NULL REFERENCES users(id),   -- the user or agent cleared
  slips       INTEGER NOT NULL DEFAULT 0,
  gross       INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  net         INTEGER NOT NULL DEFAULT 0,
  win         INTEGER NOT NULL DEFAULT 0,
  balance     INTEGER NOT NULL DEFAULT 0,               -- net − win: + the account pays, − it is paid
  cleared_by  INTEGER NOT NULL REFERENCES users(id),
  cleared_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (term_id, account_id)
);

UPDATE settings SET value = '14', updated_at = datetime('now') WHERE key = 'schema_version';

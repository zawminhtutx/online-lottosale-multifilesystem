-- 023: အဝယ် (purchases / lay-off). When a term's break (ဘရိတ်) is lowered, the units over it on a
-- number are ကျွံ (excess); the admin buys them from another dealer and records that here. A
-- purchase only takes the units off the excess and, once the result is in, shows what the dealer
-- owes on the winning numbers (units × unit price × multiplier) — no wallet changes.

CREATE TABLE IF NOT EXISTS term_purchases (
  id           INTEGER PRIMARY KEY,
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  number       TEXT NOT NULL,
  units        INTEGER NOT NULL CHECK (units > 0),
  multiplier   INTEGER NOT NULL DEFAULT 0,             -- the dealer's odds for this purchase
  note         TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_term_purchases_number ON term_purchases(term_id, bet_type_id, number);

UPDATE settings SET value = '23', updated_at = datetime('now') WHERE key = 'schema_version';

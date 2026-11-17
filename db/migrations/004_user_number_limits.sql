-- 004: per-user maximum units on one number (per bet type), set by admins/agents.
-- Checked per term against the user's own non-cancelled bets, on top of the term's unit break.

CREATE TABLE IF NOT EXISTS user_number_limits (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  max_units    INTEGER NOT NULL CHECK (max_units > 0),
  PRIMARY KEY (user_id, bet_type_id)
);

UPDATE settings SET value = '4', updated_at = datetime('now') WHERE key = 'schema_version';

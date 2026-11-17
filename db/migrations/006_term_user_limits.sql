-- 006: the per-user "max units on one number" moves from the user (all terms) into each term, so
-- the admin sets it per user next to that term's unit break. The old per-user table is dropped;
-- its values no longer apply to any term.

CREATE TABLE IF NOT EXISTS term_user_limits (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  max_units    INTEGER NOT NULL CHECK (max_units > 0),
  PRIMARY KEY (term_id, user_id, bet_type_id)
);

DROP TABLE IF EXISTS user_number_limits;

UPDATE settings SET value = '6', updated_at = datetime('now') WHERE key = 'schema_version';

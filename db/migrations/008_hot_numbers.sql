-- 008: hot numbers (ဟော့ဂဏန်း). Per term, the admin picks hot numbers and one percentage; on a hot
-- number each user may bet only that percentage of their own per-number limit (their unit-per-number
-- limit in term_user_limits, else the term's unit break). Closed numbers stay fully blocked as before.

ALTER TABLE terms ADD COLUMN hot_percent INTEGER NOT NULL DEFAULT 100 CHECK (hot_percent BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS term_hot_numbers (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  number       TEXT NOT NULL,
  PRIMARY KEY (term_id, bet_type_id, number)
);

UPDATE settings SET value = '8', updated_at = datetime('now') WHERE key = 'schema_version';

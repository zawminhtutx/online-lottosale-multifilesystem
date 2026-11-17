-- 010: hot numbers by amount, per user. On a hot number a user may bet at most their hot % of their
-- own total bets in the term (gross, all their slips including the new one). terms.hot_percent is
-- now the default % for users without their own row here.

CREATE TABLE IF NOT EXISTS term_hot_user_percents (
  term_id  INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  percent  INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  PRIMARY KEY (term_id, user_id)
);

UPDATE settings SET value = '10', updated_at = datetime('now') WHERE key = 'schema_version';

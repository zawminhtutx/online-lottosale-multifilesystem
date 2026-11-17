-- 015: slip edit / delete log. Every change the admin (or an agent) makes to a user's slip — lines'
-- units lowered or removed, or the whole slip cancelled — is recorded here with the money refunded,
-- and the slip's owner sees the list in their app.

CREATE TABLE IF NOT EXISTS slip_edit_logs (
  id          INTEGER PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),     -- the slip's owner
  slip_no     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('edit', 'cancel')),
  lines       TEXT,                                      -- edit: JSON [{ bet_type, number, before, after }]
  net_before  INTEGER NOT NULL,
  net_after   INTEGER NOT NULL,
  refund      INTEGER NOT NULL DEFAULT 0,                -- paid back into the user's wallet
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slip_edit_logs_user ON slip_edit_logs(user_id, id);
CREATE INDEX IF NOT EXISTS idx_slip_edit_logs_term ON slip_edit_logs(term_id, id);

UPDATE settings SET value = '15', updated_at = datetime('now') WHERE key = 'schema_version';

-- 011: slip delete requests. A user cannot delete a slip themselves: they ask, and the slip is only
-- cancelled (refunded) when the admin approves. Until then — or if rejected — the slip stays valid
-- and is settled and paid like any other.

CREATE TABLE IF NOT EXISTS slip_cancel_requests (
  id            INTEGER PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slip_cancel_requests_status ON slip_cancel_requests(status, id);
CREATE INDEX IF NOT EXISTS idx_slip_cancel_requests_ticket ON slip_cancel_requests(ticket_id);

UPDATE settings SET value = '11', updated_at = datetime('now') WHERE key = 'schema_version';

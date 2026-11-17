-- 007: deposit / withdraw requests from users (the mobile app's ငွေဖြည့် / ငွေထုတ်). A user asks;
-- their agent (or the admin) approves — which moves the money like a normal deposit/withdraw —
-- or rejects it.

CREATE TABLE IF NOT EXISTS wallet_requests (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  agent_id      INTEGER REFERENCES users(id),            -- snapshot of the user's agent
  type          TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL,                           -- KPay, WavePay, AYA Pay, CB Pay, Cash ...
  account_name  TEXT,                                    -- deposit: sender; withdraw: receiver
  account_no    TEXT,                                    -- phone / account number
  txn_ref       TEXT,                                    -- deposit: transfer transaction number
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reject_reason TEXT,
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_requests_user ON wallet_requests(user_id, id);
CREATE INDEX IF NOT EXISTS idx_wallet_requests_status ON wallet_requests(status, agent_id);

UPDATE settings SET value = '7', updated_at = datetime('now') WHERE key = 'schema_version';

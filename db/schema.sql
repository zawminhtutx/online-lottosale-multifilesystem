-- OnlineLotto (2D/3D) schema for Turso / libSQL (SQLite dialect)
-- Derived from ed_tpl4net.accdb. Access table name noted beside each table.
-- Money is stored as INTEGER (whole kyat). Percentages as REAL (e.g. 10.0 = 10%).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Prize sets (PRIZETIMES.PRIZESET): named odds tables assignable per user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prize_sets (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,                             -- unique per master (see idx_prize_sets_owner_name)
  twod_multiplier INTEGER NOT NULL DEFAULT 10,           -- 3D Twod (တွဒ်) payout multiplier
  master_id   INTEGER,                                   -- NULL = shared set (admin); else the master who owns it
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prize_sets_owner_name ON prize_sets(IFNULL(master_id, 0), name);

-- ---------------------------------------------------------------------------
-- Users (CUSTOMERS) — roles: admin (superadmin) > master > agent > user.
-- parent_id chains them, so every account sits under exactly one account of a higher role and
-- may act only on its own downline (see auth.js canAccess / userScope). Money flows down the
-- same chain: the admin is where it enters, every level below hands over its own balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','master','agent','user')),
  parent_id      INTEGER REFERENCES users(id),          -- user -> agent / master, agent -> master / admin, master -> admin
  name           TEXT NOT NULL,                          -- NAME
  name_mm        TEXT,                                   -- MNAME (Myanmar name)
  phone          TEXT,                                   -- TEL1
  phone2         TEXT,                                   -- TEL2
  address        TEXT,                                   -- ADDRESS
  email          TEXT,                                   -- master, agent, user
  master_name    TEXT,                                   -- master's book name
  logo           TEXT,                                   -- master's logo (data URL or http URL)
  ledger_mail    INTEGER NOT NULL DEFAULT 0 CHECK (ledger_mail IN (0, 1)), -- agent / user: email the close-time ledger
  prize_set_id   INTEGER NOT NULL DEFAULT 0 REFERENCES prize_sets(id), -- PRIZESET
  balance        INTEGER NOT NULL DEFAULT 0,             -- may go negative only when unlimited = 1 (credit owed)
  unlimited      INTEGER NOT NULL DEFAULT 0 CHECK (unlimited IN (0,1)), -- bet / hand out money without balance
  ledger_access  INTEGER NOT NULL DEFAULT 0 CHECK (ledger_access IN (0, 1)), -- masters: also see other masters' Live Ledger; own downline is always visible
  sale_over      INTEGER NOT NULL DEFAULT 0 CHECK (sale_over IN (0, 1)),     -- masters / agents: save over unit break when the admin allows it
  hot_edit       INTEGER NOT NULL DEFAULT 0 CHECK (hot_edit IN (0, 1)),      -- masters: add / edit term hot numbers when the admin allows it
  view_all       INTEGER NOT NULL DEFAULT 0 CHECK (view_all IN (0, 1)),      -- legacy, no longer grants cross-tree access
  kpay_no        TEXT,                                   -- admin / master / agent: where their downline sends money
  kpay_name      TEXT,
  wave_no        TEXT,                                   -- admin / master / agent: WavePay number
  wave_name      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- ---------------------------------------------------------------------------
-- Bet types (TYPES)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bet_types (
  id              INTEGER PRIMARY KEY,                   -- TYPEID (0..10 kept as-is)
  code            TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL,                         -- DESCRIPTION
  description_mm  TEXT,                                  -- MDESCRIPTION
  digits          INTEGER NOT NULL CHECK (digits IN (1,2,3)),
  pattern         TEXT,                                  -- e.g. 'XX-', '-XX', 'X-X', 'ANY'
  is_active       INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Prize multipliers (PRIZETIMES)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prize_rates (
  prize_set_id  INTEGER NOT NULL REFERENCES prize_sets(id) ON DELETE CASCADE,
  bet_type_id   INTEGER NOT NULL REFERENCES bet_types(id),
  side          TEXT NOT NULL DEFAULT 'sale' CHECK (side IN ('sale','purchase')), -- SALEPURCHASEFLAG
  multiplier    INTEGER NOT NULL,                        -- PRIZE (e.g. 80x, 550x)
  discount      REAL,                                    -- DISCOUNT (-1 in Access = use customer discount)
  PRIMARY KEY (prize_set_id, bet_type_id, side)
);

-- ---------------------------------------------------------------------------
-- Per-user commission / discount by bet type (DISCOUNTS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_discounts (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  discount     REAL NOT NULL DEFAULT 0,                  -- DISCOUNT
  discount2    REAL NOT NULL DEFAULT 0,                  -- DISCOUNT2
  discount3    REAL NOT NULL DEFAULT 0,                  -- DISCOUNT3
  PRIMARY KEY (user_id, bet_type_id)
);


-- ---------------------------------------------------------------------------
-- Draw periods (TERM)
-- ---------------------------------------------------------------------------
-- Folders (ဖိုင်): every new term goes in one; deleting one erases it with its terms (none may have sales)
CREATE TABLE IF NOT EXISTS term_folders (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,                             -- unique per master, not across masters
  master_id   INTEGER REFERENCES users(id),              -- NULL = shared book the admin still runs
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_term_folders_owner_name ON term_folders(IFNULL(master_id, 0), name);
CREATE INDEX IF NOT EXISTS idx_term_folders_master ON term_folders(master_id);

CREATE TABLE IF NOT EXISTS terms (
  id           INTEGER PRIMARY KEY,                      -- TERMID
  description  TEXT NOT NULL,                            -- DESCRIPTION
  game         TEXT NOT NULL DEFAULT '2D' CHECK (game IN ('2D','3D','2D3D')), -- 2D3D: legacy terms only
  unit_price   INTEGER NOT NULL DEFAULT 25,              -- UNITPRICE
  open_at      TEXT,
  close_at     TEXT,                                     -- betting cut-off
  draw_at      TEXT,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','open','closed','drawn','settled','cancelled')),
  hot_percent  INTEGER NOT NULL DEFAULT 100 CHECK (hot_percent BETWEEN 0 AND 100), -- default hot % (see term_hot_user_percents)
  folder_id    INTEGER REFERENCES term_folders(id) ON DELETE SET NULL,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ledger_mailed_at TEXT                                  -- set once the close-time ledger email has been sent
);
CREATE INDEX IF NOT EXISTS idx_terms_status ON terms(status);

-- Draw results (TERM.NUM1..NUM12 normalised)
CREATE TABLE IF NOT EXISTS term_results (
  term_id     INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
  label       TEXT,                                      -- e.g. 'First prize', '3D front'
  value       TEXT NOT NULL,
  entered_by  INTEGER REFERENCES users(id),
  entered_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (term_id, slot)
);

-- Max units allowed per number per bet type (UNITBREAK)
CREATE TABLE IF NOT EXISTS term_unit_limits (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  max_units    INTEGER NOT NULL DEFAULT 0,               -- BREAK (0 = no limit)
  PRIMARY KEY (term_id, bet_type_id)
);

-- Per term, per user: maximum units that user may bet on one number (never above the unit break)
CREATE TABLE IF NOT EXISTS term_user_limits (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  max_units    INTEGER NOT NULL CHECK (max_units > 0),
  PRIMARY KEY (term_id, user_id, bet_type_id)
);

-- Closed / hot numbers (new: needed for online)
CREATE TABLE IF NOT EXISTS term_blocked_numbers (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  number       TEXT NOT NULL,
  PRIMARY KEY (term_id, bet_type_id, number)
);

-- Hot numbers: still open, but each user may bet only terms.hot_percent of their own per-number
-- limit (term_user_limits, else the unit break) on them.
CREATE TABLE IF NOT EXISTS term_hot_numbers (
  term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),
  number       TEXT NOT NULL,
  PRIMARY KEY (term_id, bet_type_id, number)
);

-- Per term, per user: hot % (of the user's total bets in the term) allowed on each hot number;
-- users without a row use terms.hot_percent
CREATE TABLE IF NOT EXISTS term_hot_user_percents (
  term_id  INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  percent  INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  PRIMARY KEY (term_id, user_id)
);

-- ငွေရှင်း: per term, a user's or agent's account marked settled up, with a snapshot of the
-- figures (balance = net − win: + the account pays, − it is paid)
CREATE TABLE IF NOT EXISTS term_clearings (
  id          INTEGER PRIMARY KEY,
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  account_id  INTEGER NOT NULL REFERENCES users(id),
  slips       INTEGER NOT NULL DEFAULT 0,
  gross       INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  net         INTEGER NOT NULL DEFAULT 0,
  win         INTEGER NOT NULL DEFAULT 0,
  balance     INTEGER NOT NULL DEFAULT 0,
  cleared_by  INTEGER NOT NULL REFERENCES users(id),
  cleared_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (term_id, account_id)
);

-- အဝယ် (purchases / lay-off): units over the break (ကျွံ) bought from another dealer. Takes them off
-- the excess; once the result is in, the dealer owes units × unit price × multiplier on winners.
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

-- Lay-off / cut rules (LEDGER_WIZARD)
CREATE TABLE IF NOT EXISTS ledger_cut_rules (
  term_id        INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  bet_type_id    INTEGER NOT NULL REFERENCES bet_types(id),
  cut            INTEGER NOT NULL DEFAULT 0,
  linear_cut     INTEGER NOT NULL DEFAULT 0,
  round_by       INTEGER NOT NULL DEFAULT 0,
  cut_values     TEXT,
  divide         INTEGER NOT NULL DEFAULT 0,
  divide_values  TEXT,
  leave_digit    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (term_id, bet_type_id)
);

-- ---------------------------------------------------------------------------
-- Tickets / slips (SALES)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id               INTEGER PRIMARY KEY,                  -- SALEID
  term_id          INTEGER NOT NULL REFERENCES terms(id),-- TERMID
  slip_no          TEXT NOT NULL,                        -- SLIPNO
  user_id          INTEGER NOT NULL REFERENCES users(id),-- CUSTOMERID
  agent_id         INTEGER REFERENCES users(id),         -- snapshot of user's agent
  gross_amount     INTEGER NOT NULL DEFAULT 0,
  discount_amount  INTEGER NOT NULL DEFAULT 0,
  net_amount       INTEGER NOT NULL DEFAULT 0,           -- PAYMENT
  win_amount       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','cancelled','won','lost')),
  print_count      INTEGER NOT NULL DEFAULT 0,           -- SLIPCOPY
  created_by       INTEGER NOT NULL REFERENCES users(id),-- USERID
  client_ip        TEXT,                                 -- MACHINEID
  created_at       TEXT NOT NULL DEFAULT (datetime('now')), -- DATE
  cancelled_at     TEXT,
  UNIQUE (term_id, slip_no)
);
CREATE INDEX IF NOT EXISTS idx_tickets_user  ON tickets(user_id, term_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(agent_id, term_id);

-- Grouped entries such as "R" (reverse) or brake sets (SALES_ADDGROUP)
CREATE TABLE IF NOT EXISTS ticket_groups (
  id           INTEGER PRIMARY KEY,                      -- INDEX
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  input        TEXT NOT NULL,                            -- NUMBER (as typed, e.g. '12R')
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),-- TYPE
  units        INTEGER NOT NULL                          -- UNIT
);

-- Ticket lines (SALES_DETAIL)
CREATE TABLE IF NOT EXISTS ticket_items (
  id           INTEGER PRIMARY KEY,                      -- INDEX
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  term_id      INTEGER NOT NULL REFERENCES terms(id),    -- denormalised for fast per-number totals
  bet_type_id  INTEGER NOT NULL REFERENCES bet_types(id),-- TYPEID
  number       TEXT NOT NULL,                            -- NUMBER
  units        INTEGER NOT NULL CHECK (units > 0),       -- UNIT
  amount       INTEGER NOT NULL,                         -- units * unit_price
  discount     REAL NOT NULL DEFAULT 0,                  -- DISCOUNT %
  group_id     INTEGER REFERENCES ticket_groups(id),     -- INGROUP / GROUPINDEX
  serial       INTEGER,                                  -- SERIAL
  is_winner    INTEGER NOT NULL DEFAULT 0,
  multiplier   INTEGER,                                  -- odds snapshot at bet time
  twod_multiplier INTEGER,                               -- 3D Twod odds snapshot at bet time
  win_amount   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_ticket ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_items_number ON ticket_items(term_id, bet_type_id, number);

-- Winning lines per term (WINNUMBERS)
CREATE TABLE IF NOT EXISTS win_numbers (
  term_id         INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  ticket_item_id  INTEGER NOT NULL REFERENCES ticket_items(id) ON DELETE CASCADE, -- INDEX
  multiplier      INTEGER NOT NULL,                      -- PRIZE
  created_by      INTEGER REFERENCES users(id),          -- USERID
  created_at      TEXT NOT NULL DEFAULT (datetime('now')), -- DATE
  PRIMARY KEY (term_id, ticket_item_id)
);

-- ---------------------------------------------------------------------------
-- Wallet ledger (new: online balance for users/agents)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL CHECK (type IN
                 ('deposit','withdraw','bet','win','refund','commission','transfer_in','transfer_out','adjust')),
  amount         INTEGER NOT NULL,                       -- signed: + credit, - debit
  balance_after  INTEGER NOT NULL,
  ticket_id      INTEGER REFERENCES tickets(id),
  counterparty_id INTEGER REFERENCES users(id),          -- the account the money came from / went to
  note           TEXT,
  created_by     INTEGER REFERENCES users(id),
  float_reset    INTEGER NOT NULL DEFAULT 0 CHECK (float_reset IN (0, 1)), -- ငွေ Transfer: squaring a master back onto its float
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id, created_at);

-- Slip delete requests: users ask, the admin approves (slip cancelled + refunded) or rejects
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

-- Slip edit / delete log (admin or agent changes to a user's slip); the owner sees it in their app
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

-- Deposit / withdraw requests (ငွေလက်ခံ): any account asks its own upline — a user its agent, an agent its
-- master, a master the admin — and that upline (or anyone further above) approves or rejects.
CREATE TABLE IF NOT EXISTS wallet_requests (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  agent_id      INTEGER REFERENCES users(id),            -- snapshot of the asking account's upline (parent_id)
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

-- ---------------------------------------------------------------------------
-- Settings (SETTINGS + LOCAL_SETTING + TAG) and audit log (LOG)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY,                       -- INDEX
  user_id     INTEGER REFERENCES users(id),              -- USERID
  action      TEXT NOT NULL,                             -- LOG
  detail      TEXT,
  client_ip   TEXT,                                      -- MACHINEID
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))    -- DATE
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- WINNUMBERS_VIEW
CREATE VIEW IF NOT EXISTS v_winnings AS
SELECT t.user_id, t.agent_id, t.created_at, t.slip_no, ti.bet_type_id, ti.number, ti.units,
       ti.units * tm.unit_price * wn.multiplier AS prize, t.term_id
FROM win_numbers wn
JOIN ticket_items ti ON ti.id = wn.ticket_item_id
JOIN tickets t       ON t.id = ti.ticket_id
JOIN terms tm        ON tm.id = wn.term_id
WHERE t.status <> 'cancelled';

-- Per-number exposure for a term (used for limits and cut / lay-off)
CREATE VIEW IF NOT EXISTS v_number_totals AS
SELECT ti.term_id, ti.bet_type_id, ti.number,
       SUM(ti.units) AS units, SUM(ti.amount) AS amount
FROM ticket_items ti
JOIN tickets t ON t.id = ti.ticket_id
WHERE t.status <> 'cancelled'
GROUP BY ti.term_id, ti.bet_type_id, ti.number;

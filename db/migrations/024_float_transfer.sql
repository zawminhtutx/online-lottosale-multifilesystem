-- 024: ငွေ Transfer (float). The admin keeps every master on a float — the money the admin has
-- handed it (deposits minus withdrawals, the "ထည့်ပေးထားသော ငွေ"). The ငွေ Transfer page squares a
-- master back onto that float: what sits over it is taken back, what is short is topped up.
-- The squaring moves are marked float_reset = 1 so they do not change the float itself.

ALTER TABLE wallet_transactions ADD COLUMN float_reset INTEGER NOT NULL DEFAULT 0 CHECK (float_reset IN (0, 1));

UPDATE settings SET value = '24', updated_at = datetime('now') WHERE key = 'schema_version';

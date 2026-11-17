-- 005: Twod (တွဒ်) for 3D, as in the POS app. When a 3D number wins, bets on its +1/-1 neighbours
-- and on the other orderings of its digits win at the prize set's (lower) Twod multiplier.

ALTER TABLE prize_sets ADD COLUMN twod_multiplier INTEGER NOT NULL DEFAULT 10;
-- Twod odds snapshot at bet time (3D lines only), like ticket_items.multiplier.
ALTER TABLE ticket_items ADD COLUMN twod_multiplier INTEGER;

UPDATE settings SET value = '5', updated_at = datetime('now') WHERE key = 'schema_version';

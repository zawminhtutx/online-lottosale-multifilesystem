-- 016: only 2D (id 0) and 3D (id 1) remain. The other bet types carried over from Access
-- (2D ANY, 2D X X -, 2D - X X, 2D X - X, 1D …, 3D BREAK; ids 2–10) were never offered (inactive)
-- and are removed with every setting that still pointed at them. No slip ever used them.

DELETE FROM prize_rates          WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM user_discounts       WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM term_unit_limits     WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM term_user_limits     WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM term_blocked_numbers WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM term_hot_numbers     WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM ledger_cut_rules     WHERE bet_type_id BETWEEN 2 AND 10;
DELETE FROM bet_types            WHERE id BETWEEN 2 AND 10;

UPDATE settings SET value = '16', updated_at = datetime('now') WHERE key = 'schema_version';

-- 003: offer only 2D LOTT and 3D. Other bet types stay in the table (old tickets may
-- reference them) but are deactivated, which hides them from the UI and rejects new bets.

UPDATE bet_types SET is_active = CASE WHEN code IN ('2D', '3D') THEN 1 ELSE 0 END;
UPDATE settings SET value = '3', updated_at = datetime('now') WHERE key = 'schema_version';

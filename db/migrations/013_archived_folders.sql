-- 013: deleting a folder (ဖိုင်) archives it instead: its terms are closed and the folder moves to
-- "Archived", where it and its terms can still be looked at. Nothing is erased.

ALTER TABLE term_folders ADD COLUMN archived_at TEXT;

UPDATE settings SET value = '13', updated_at = datetime('now') WHERE key = 'schema_version';

-- 009: term folders (ဖိုင်). The admin makes folders and files terms (အပါတ်စဥ်) under them;
-- every new term goes in exactly one folder. Only an empty folder can be deleted.

CREATE TABLE IF NOT EXISTS term_folders (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE terms ADD COLUMN folder_id INTEGER REFERENCES term_folders(id) ON DELETE SET NULL;

UPDATE settings SET value = '9', updated_at = datetime('now') WHERE key = 'schema_version';

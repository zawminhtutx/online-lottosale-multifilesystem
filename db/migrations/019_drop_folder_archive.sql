-- 019: the folder (ဖိုင်) archive is gone — no "Archived" list, no archiving a term or a folder.
-- Terms whose result was in used to move into a twin folder "<name> (Archived)": they move back
-- into "<name>" where it still exists, and the empty twins go. A twin whose original is gone stays
-- as a plain folder (its terms are still in it, nothing is erased).

UPDATE terms
SET folder_id = (
  SELECT base.id FROM term_folders arch JOIN term_folders base ON base.name = substr(arch.name, 1, length(arch.name) - 11)
  WHERE arch.id = terms.folder_id
)
WHERE folder_id IN (
  SELECT arch.id FROM term_folders arch JOIN term_folders base ON base.name = substr(arch.name, 1, length(arch.name) - 11)
  WHERE arch.archived_at IS NOT NULL AND arch.name LIKE '% (Archived)'
);

DELETE FROM term_folders
WHERE archived_at IS NOT NULL AND name LIKE '% (Archived)'
  AND NOT EXISTS (SELECT 1 FROM terms t WHERE t.folder_id = term_folders.id);

ALTER TABLE term_folders DROP COLUMN archived_at;

UPDATE settings SET value = '19', updated_at = datetime('now') WHERE key = 'schema_version';

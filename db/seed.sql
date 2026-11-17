-- Default data carried over from ed_tpl4net.accdb

INSERT OR IGNORE INTO prize_sets (id, name) VALUES (0, 'Default');

-- Only 2D and 3D are offered (the other Access bet types were removed in migration 016).
INSERT OR IGNORE INTO bet_types (id, code, description, digits, pattern, is_active) VALUES
  (0,  '2D',      '2D LOTT',  2, 'XX',    1),
  (1,  '3D',      '3D',       3, 'XXX',   1);

-- PRIZETIMES set 0.
INSERT OR IGNORE INTO prize_rates (prize_set_id, bet_type_id, side, multiplier, discount) VALUES
  (0, 0,  'sale', 80,  -1),
  (0, 1,  'sale', 550, -1);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('current_term_id', NULL),
  ('default_unit_price', '25'),
  ('schema_version', '27');  -- new databases start at the latest version; see db/migrations

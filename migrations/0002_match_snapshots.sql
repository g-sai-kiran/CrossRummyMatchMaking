ALTER TABLE active_matches
  ADD COLUMN status INTEGER NOT NULL DEFAULT 0;

ALTER TABLE active_matches
  ADD COLUMN current_turn_seat INTEGER;

ALTER TABLE active_matches
  ADD COLUMN turn_ends_at INTEGER;

ALTER TABLE active_matches
  ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE active_match_players
  ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

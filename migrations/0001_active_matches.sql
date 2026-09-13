PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS active_matches (
  game_id TEXT PRIMARY KEY,
  game_type INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  matched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS active_match_players (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id),
  FOREIGN KEY (game_id)
    REFERENCES active_matches(game_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_active_match_players_player
  ON active_match_players(player_id);

CREATE INDEX IF NOT EXISTS idx_active_matches_matched_at
  ON active_matches(matched_at DESC);

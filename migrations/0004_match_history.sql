PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS match_history (
  game_id TEXT PRIMARY KEY,
  game_type INTEGER NOT NULL,
  status INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  matched_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  board_preview TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_history_players (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id),
  FOREIGN KEY (game_id)
    REFERENCES match_history(game_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_history_players_player
  ON match_history_players(player_id);

CREATE INDEX IF NOT EXISTS idx_match_history_finished_at
  ON match_history(finished_at DESC);

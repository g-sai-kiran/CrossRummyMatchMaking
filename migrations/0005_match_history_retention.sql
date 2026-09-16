PRAGMA foreign_keys = ON;

-- Per-player retained history index. Full match/player details stay shared so
-- pruning one player's history does not remove another participant's copy.
CREATE TABLE IF NOT EXISTS match_history_access (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, game_id),
  FOREIGN KEY (game_id)
    REFERENCES match_history(game_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_history_access_player_order
  ON match_history_access(player_id, finished_at DESC, game_id DESC);

CREATE INDEX IF NOT EXISTS idx_match_history_access_game
  ON match_history_access(game_id);

-- Backfill history written before this migration.
INSERT OR IGNORE INTO match_history_access (
  game_id,
  player_id,
  finished_at
)
SELECT
  h.game_id,
  p.player_id,
  h.finished_at
FROM match_history AS h
INNER JOIN match_history_players AS p
  ON p.game_id = h.game_id;

-- Keep only the newest 500 history entries for each player.
DELETE FROM match_history_access
WHERE EXISTS (
  SELECT 1
  FROM (
    SELECT
      player_id,
      game_id,
      ROW_NUMBER() OVER (
        PARTITION BY player_id
        ORDER BY finished_at DESC, game_id DESC
      ) AS history_rank
    FROM match_history_access
  ) AS ranked
  WHERE ranked.player_id = match_history_access.player_id
    AND ranked.game_id = match_history_access.game_id
    AND ranked.history_rank > 500
);

-- A shared match is deleted only after none of its participants retain it.
DELETE FROM match_history
WHERE NOT EXISTS (
  SELECT 1
  FROM match_history_access AS retained
  WHERE retained.game_id = match_history.game_id
);

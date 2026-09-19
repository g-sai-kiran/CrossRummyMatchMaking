PRAGMA foreign_keys = ON;

ALTER TABLE match_history
  ADD COLUMN started_at INTEGER;

ALTER TABLE match_history
  ADD COLUMN duration_ms INTEGER;

ALTER TABLE match_history_players
  ADD COLUMN turns_taken INTEGER NOT NULL DEFAULT 0;

ALTER TABLE match_history_players
  ADD COLUMN best_turn_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE match_history_players
  ADD COLUMN coins_placed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE match_history_players
  ADD COLUMN result TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE match_history_players
  ADD COLUMN rank_delta INTEGER NOT NULL DEFAULT 0;

-- Existing rows predate authoritative start-time tracking. Keep them readable
-- by treating matchmaking time as the best available start timestamp.
UPDATE match_history
SET started_at = matched_at
WHERE started_at IS NULL;

UPDATE match_history
SET duration_ms = MAX(0, finished_at - started_at)
WHERE duration_ms IS NULL;


-- Backfill result/rank for history written before this migration.
UPDATE match_history_players
SET result = CASE
  WHEN (
    SELECT COUNT(*)
    FROM match_history_players AS leaders
    WHERE leaders.game_id = match_history_players.game_id
      AND leaders.score = (
        SELECT MAX(scores.score)
        FROM match_history_players AS scores
        WHERE scores.game_id = match_history_players.game_id
      )
  ) > 1 THEN 'draw'
  WHEN score = (
    SELECT MAX(scores.score)
    FROM match_history_players AS scores
    WHERE scores.game_id = match_history_players.game_id
  ) THEN 'win'
  ELSE 'loss'
END
WHERE result = 'unknown';

UPDATE match_history_players
SET rank_delta = CASE result
  WHEN 'win' THEN 30
  WHEN 'loss' THEN -30
  ELSE 0
END;

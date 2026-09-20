-- Match history UI seed data for PlayFab player: ACA47BDA50B147E4
--
-- Run against the remote D1 database with:
-- npx wrangler d1 execute cross-rummy-matches --remote --file=./test/seed_match_history_ACA47BDA50B147E4.sql
--
-- Safe to re-run: existing rows with this test prefix are deleted first.
-- Requires D1 migrations through 0006_end_game_stats.sql to be applied first.
PRAGMA foreign_keys = ON;


DELETE FROM match_history
WHERE game_id LIKE 'ui-test-ACA47BDA50B147E4-%';

-- 1. WIN 128-97
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-01', 0, 2, 2,
  1789881345000, 1789881360000, 1789882200000, 840000,
  '{"width":15,"height":9,"revision":20,"coins":[{"x":7,"y":4,"type":0,"color":0,"number":1,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":1,"number":3,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":2,"number":5,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-01', 'ACA47BDA50B147E4', 0, 128, 9, 12, 13, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-01', 'UI_TEST_OPPONENT_01', 1, 97, 10, 10, 15, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-01', 'ACA47BDA50B147E4', 1789882200000);

-- 2. LOSS 88-112
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-02', 1, 2, 2,
  1789859505000, 1789859520000, 1789860600000, 1080000,
  '{"width":15,"height":9,"revision":21,"coins":[{"x":7,"y":4,"type":0,"color":1,"number":2,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":2,"number":4,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":3,"number":6,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-02', 'ACA47BDA50B147E4', 0, 88, 10, 17, 14, 'loss', -30),
  ('ui-test-ACA47BDA50B147E4-02', 'UI_TEST_OPPONENT_02', 1, 112, 11, 17, 16, 'win', 30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-02', 'ACA47BDA50B147E4', 1789860600000);

-- 3. WIN 143-120
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-03', 0, 2, 2,
  1789837725000, 1789837740000, 1789839000000, 1260000,
  '{"width":15,"height":9,"revision":22,"coins":[{"x":7,"y":4,"type":0,"color":2,"number":3,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":3,"number":5,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":0,"number":7,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-03', 'ACA47BDA50B147E4', 0, 143, 11, 22, 15, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-03', 'UI_TEST_OPPONENT_03', 1, 120, 12, 24, 17, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-03', 'ACA47BDA50B147E4', 1789839000000);

-- 4. DRAW 104-104
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-04', 1, 2, 2,
  1789816425000, 1789816440000, 1789817400000, 960000,
  '{"width":15,"height":9,"revision":23,"coins":[{"x":7,"y":4,"type":0,"color":3,"number":4,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":0,"number":6,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":1,"number":1,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-04', 'ACA47BDA50B147E4', 0, 104, 12, 27, 16, 'draw', 0),
  ('ui-test-ACA47BDA50B147E4-04', 'UI_TEST_OPPONENT_04', 1, 104, 13, 31, 18, 'draw', 0);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-04', 'ACA47BDA50B147E4', 1789817400000);

-- 5. LOSS 76-105
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-05', 0, 2, 2,
  1789795005000, 1789795020000, 1789795800000, 780000,
  '{"width":15,"height":9,"revision":24,"coins":[{"x":7,"y":4,"type":0,"color":0,"number":5,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":1,"number":7,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":2,"number":2,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-05', 'ACA47BDA50B147E4', 0, 76, 13, 32, 17, 'loss', -30),
  ('ui-test-ACA47BDA50B147E4-05', 'UI_TEST_OPPONENT_05', 1, 105, 8, 16, 19, 'win', 30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-05', 'ACA47BDA50B147E4', 1789795800000);

-- 6. WIN 132-90
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-06', 1, 2, 2,
  1789773045000, 1789773060000, 1789774200000, 1140000,
  '{"width":15,"height":9,"revision":25,"coins":[{"x":7,"y":4,"type":0,"color":1,"number":6,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":2,"number":1,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":3,"number":3,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-06', 'ACA47BDA50B147E4', 0, 132, 14, 13, 18, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-06', 'UI_TEST_OPPONENT_06', 1, 90, 9, 23, 12, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-06', 'ACA47BDA50B147E4', 1789774200000);

-- 7. LOSS 99-101
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-07', 0, 2, 2,
  1789751145000, 1789751160000, 1789752600000, 1440000,
  '{"width":15,"height":9,"revision":26,"coins":[{"x":7,"y":4,"type":0,"color":2,"number":7,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":3,"number":2,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":0,"number":4,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-07', 'ACA47BDA50B147E4', 0, 99, 9, 18, 19, 'loss', -30),
  ('ui-test-ACA47BDA50B147E4-07', 'UI_TEST_OPPONENT_07', 1, 101, 10, 30, 13, 'win', 30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-07', 'ACA47BDA50B147E4', 1789752600000);

-- 8. WIN 150-139
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-08', 1, 2, 2,
  1789729965000, 1789729980000, 1789731000000, 1020000,
  '{"width":15,"height":9,"revision":27,"coins":[{"x":7,"y":4,"type":0,"color":3,"number":1,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":0,"number":3,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":1,"number":5,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-08', 'ACA47BDA50B147E4', 0, 150, 10, 23, 20, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-08', 'UI_TEST_OPPONENT_08', 1, 139, 11, 15, 14, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-08', 'ACA47BDA50B147E4', 1789731000000);

-- 9. DRAW 118-118
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-09', 0, 2, 2,
  1789708065000, 1789708080000, 1789709400000, 1320000,
  '{"width":15,"height":9,"revision":28,"coins":[{"x":7,"y":4,"type":0,"color":0,"number":2,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":1,"number":4,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":2,"number":6,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-09', 'ACA47BDA50B147E4', 0, 118, 11, 28, 13, 'draw', 0),
  ('ui-test-ACA47BDA50B147E4-09', 'UI_TEST_OPPONENT_09', 1, 118, 12, 22, 15, 'draw', 0);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-09', 'ACA47BDA50B147E4', 1789709400000);

-- 10. WIN 125-111
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-10', 1, 2, 2,
  1789686885000, 1789686900000, 1789687800000, 900000,
  '{"width":15,"height":9,"revision":29,"coins":[{"x":7,"y":4,"type":0,"color":1,"number":3,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":2,"number":5,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":3,"number":7,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-10', 'ACA47BDA50B147E4', 0, 125, 12, 33, 14, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-10', 'UI_TEST_OPPONENT_10', 1, 111, 13, 29, 16, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-10', 'ACA47BDA50B147E4', 1789687800000);

-- 11. LOSS 82-121
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-11', 0, 2, 2,
  1789664985000, 1789665000000, 1789666200000, 1200000,
  '{"width":15,"height":9,"revision":30,"coins":[{"x":7,"y":4,"type":0,"color":2,"number":4,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":3,"number":6,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":0,"number":1,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-11', 'ACA47BDA50B147E4', 0, 82, 13, 14, 15, 'loss', -30),
  ('ui-test-ACA47BDA50B147E4-11', 'UI_TEST_OPPONENT_11', 1, 121, 8, 14, 17, 'win', 30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-11', 'ACA47BDA50B147E4', 1789666200000);

-- 12. WIN 140-137
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-12', 1, 2, 2,
  1789643025000, 1789643040000, 1789644600000, 1560000,
  '{"width":15,"height":9,"revision":31,"coins":[{"x":7,"y":4,"type":0,"color":3,"number":5,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":0,"number":7,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":1,"number":2,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-12', 'ACA47BDA50B147E4', 0, 140, 14, 19, 16, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-12', 'UI_TEST_OPPONENT_12', 1, 137, 9, 21, 18, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-12', 'ACA47BDA50B147E4', 1789644600000);

-- 13. LOSS 91-108
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-13', 0, 2, 2,
  1789622265000, 1789622280000, 1789623000000, 720000,
  '{"width":15,"height":9,"revision":32,"coins":[{"x":7,"y":4,"type":0,"color":0,"number":6,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":1,"number":1,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":2,"number":3,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-13', 'ACA47BDA50B147E4', 0, 91, 9, 24, 17, 'loss', -30),
  ('ui-test-ACA47BDA50B147E4-13', 'UI_TEST_OPPONENT_13', 1, 108, 10, 28, 19, 'win', 30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-13', 'ACA47BDA50B147E4', 1789623000000);

-- 14. WIN 160-144
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-14', 1, 2, 2,
  1789600005000, 1789600020000, 1789601400000, 1380000,
  '{"width":15,"height":9,"revision":33,"coins":[{"x":7,"y":4,"type":0,"color":1,"number":7,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":2,"number":2,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":3,"number":4,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-14', 'ACA47BDA50B147E4', 0, 160, 10, 29, 18, 'win', 30),
  ('ui-test-ACA47BDA50B147E4-14', 'UI_TEST_OPPONENT_14', 1, 144, 11, 13, 12, 'loss', -30);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-14', 'ACA47BDA50B147E4', 1789601400000);

-- 15. DRAW 106-106
INSERT INTO match_history (
  game_id, game_type, status, player_count,
  matched_at, started_at, finished_at, duration_ms, board_preview
) VALUES (
  'ui-test-ACA47BDA50B147E4-15', 0, 2, 2,
  1789578705000, 1789578720000, 1789579800000, 1080000,
  '{"width":15,"height":9,"revision":34,"coins":[{"x":7,"y":4,"type":0,"color":2,"number":1,"ownerSeat":0},{"x":8,"y":4,"type":0,"color":3,"number":3,"ownerSeat":1},{"x":7,"y":5,"type":0,"color":0,"number":5,"ownerSeat":0}]}'
);

INSERT INTO match_history_players (
  game_id, player_id, seat, score, turns_taken,
  best_turn_score, coins_placed, result, rank_delta
) VALUES
  ('ui-test-ACA47BDA50B147E4-15', 'ACA47BDA50B147E4', 0, 106, 11, 34, 19, 'draw', 0),
  ('ui-test-ACA47BDA50B147E4-15', 'UI_TEST_OPPONENT_15', 1, 106, 12, 20, 13, 'draw', 0);

INSERT INTO match_history_access (game_id, player_id, finished_at)
VALUES ('ui-test-ACA47BDA50B147E4-15', 'ACA47BDA50B147E4', 1789579800000);


-- Optional verification:
-- SELECT game_id, finished_at FROM match_history_access
-- WHERE player_id = 'ACA47BDA50B147E4'
-- ORDER BY finished_at DESC, game_id DESC;

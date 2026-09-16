export interface StoredMatchHistoryPlayer {
  id: string;
  seat: number;
  score: number;
}

export interface StoredMatchHistoryBoardPreviewCoin {
  x: number;
  y: number;
  type: number;
  color: number | null;
  number: number | null;
  ownerSeat: number | null;
}

export interface StoredMatchHistoryBoardPreview {
  width: number;
  height: number;
  revision: number;
  coins: StoredMatchHistoryBoardPreviewCoin[];
}

export interface StoredMatchHistory {
  gameId: string;
  gameType: number;
  status: number;
  playerCount: number;
  matchedAt: number;
  finishedAt: number;
  boardPreview: StoredMatchHistoryBoardPreview | null;
  players: StoredMatchHistoryPlayer[];
}

interface MatchHistoryPlayerRow {
  game_id: string;
  game_type: number;
  status: number;
  player_count: number;
  matched_at: number;
  finished_at: number;
  board_preview: string;
  player_id: string;
  seat: number;
  score: number;
}

export async function listMatchHistoryForPlayer(
  db: D1Database,
  playerId: string,
  limit = 50
): Promise<StoredMatchHistory[]> {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const result = await db.prepare(
    `SELECT
      h.game_id,
      h.game_type,
      h.status,
      h.player_count,
      h.matched_at,
      h.finished_at,
      h.board_preview,
      p.player_id,
      p.seat,
      p.score
    FROM match_history AS h
    INNER JOIN match_history_players AS p
      ON p.game_id = h.game_id
    WHERE EXISTS (
      SELECT 1
      FROM match_history_players AS mine
      WHERE mine.game_id = h.game_id
        AND mine.player_id = ?
    )
    AND h.game_id IN (
      SELECT recent.game_id
      FROM match_history AS recent
      INNER JOIN match_history_players AS mine
        ON mine.game_id = recent.game_id
      WHERE mine.player_id = ?
      ORDER BY recent.finished_at DESC
      LIMIT ?
    )
    ORDER BY h.finished_at DESC, p.seat ASC`
  )
    .bind(playerId, playerId, safeLimit)
    .all<MatchHistoryPlayerRow>();

  const matches = new Map<string, StoredMatchHistory>();

  for (const row of result.results ?? []) {
    let match = matches.get(row.game_id);
    if (!match) {
      match = {
        gameId: row.game_id,
        gameType: row.game_type,
        status: row.status,
        playerCount: row.player_count,
        matchedAt: row.matched_at,
        finishedAt: row.finished_at,
        boardPreview: parseBoardPreview(row.board_preview),
        players: []
      };
      matches.set(row.game_id, match);
    }

    match.players.push({
      id: row.player_id,
      seat: row.seat,
      score: row.score
    });
  }

  return [...matches.values()];
}

function parseBoardPreview(
  value: string | null
): StoredMatchHistoryBoardPreview | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StoredMatchHistoryBoardPreview;
    if (
      !parsed ||
      !Number.isInteger(parsed.width) ||
      !Number.isInteger(parsed.height) ||
      !Number.isInteger(parsed.revision) ||
      !Array.isArray(parsed.coins)
    ) {
      return null;
    }

    return parsed;
  }
  catch {
    return null;
  }
}

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

export interface MatchHistoryPage {
  matches: StoredMatchHistory[];
  hasMore: boolean;
  nextCursor: string | null;
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

interface CursorParts {
  finishedAt: number;
  gameId: string;
}

export async function listMatchHistoryForPlayer(
  db: D1Database,
  playerId: string,
  limit = 50,
  cursor?: string | null
): Promise<MatchHistoryPage> {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const cursorParts = cursor ? decodeCursor(cursor) : null;

  const pageIdsResult = cursorParts
    ? await db.prepare(
        `SELECT a.game_id, a.finished_at
         FROM match_history_access AS a
         WHERE a.player_id = ?
           AND (
             a.finished_at < ?
             OR (
               a.finished_at = ?
               AND a.game_id < ?
             )
           )
         ORDER BY a.finished_at DESC, a.game_id DESC
         LIMIT ?`
      )
        .bind(
          playerId,
          cursorParts.finishedAt,
          cursorParts.finishedAt,
          cursorParts.gameId,
          safeLimit + 1
        )
        .all<{ game_id: string; finished_at: number }>()
    : await db.prepare(
        `SELECT a.game_id, a.finished_at
         FROM match_history_access AS a
         WHERE a.player_id = ?
         ORDER BY a.finished_at DESC, a.game_id DESC
         LIMIT ?`
      )
        .bind(playerId, safeLimit + 1)
        .all<{ game_id: string; finished_at: number }>();

  const pageIds = pageIdsResult.results ?? [];
  const hasMore = pageIds.length > safeLimit;
  const selected = hasMore ? pageIds.slice(0, safeLimit) : pageIds;

  if (selected.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextCursor: null
    };
  }

  const placeholders = selected.map(() => "?").join(",");
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
    WHERE h.game_id IN (${placeholders})
    ORDER BY h.finished_at DESC, h.game_id DESC, p.seat ASC`
  )
    .bind(...selected.map(item => item.game_id))
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

  const last = selected[selected.length - 1];

  return {
    matches: [...matches.values()],
    hasMore,
    nextCursor: hasMore
      ? encodeCursor(last.finished_at, last.game_id)
      : null
  };
}

function encodeCursor(
  finishedAt: number,
  gameId: string
): string {
  return `${finishedAt}_${gameId}`;
}

function decodeCursor(cursor: string): CursorParts {
  const separator = cursor.indexOf("_");
  if (separator <= 0 || separator === cursor.length - 1) {
    throw new Error("Invalid history cursor");
  }

  const finishedAt = Number(cursor.slice(0, separator));
  const gameId = cursor.slice(separator + 1);

  if (!Number.isFinite(finishedAt) || !gameId) {
    throw new Error("Invalid history cursor");
  }

  return { finishedAt, gameId };
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

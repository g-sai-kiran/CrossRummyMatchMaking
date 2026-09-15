export interface StoredMatchPlayer {
  id: string;
  seat: number;
  score: number;
}

export interface StoredBoardPreviewCoin {
  x: number;
  y: number;
  type: number;
  color: number | null;
  number: number | null;
  ownerSeat: number | null;
}

export interface StoredBoardPreview {
  width: number;
  height: number;
  revision: number;
  coins: StoredBoardPreviewCoin[];
}

export interface StoredActiveMatch {
  gameId: string;
  gameType: number;
  status: number;
  playerCount: number;
  currentTurnSeat: number | null;
  turnEndsAt: number | null;
  matchedAt: number;
  updatedAt: number;
  boardPreview: StoredBoardPreview | null;
  players: StoredMatchPlayer[];
}

export interface CreateActiveMatchInput {
  gameId: string;
  gameType: number;
  playerCount: number;
  players: string[];
  matchedAt: number;
}

interface ActiveMatchPlayerRow {
  game_id: string;
  game_type: number;
  status: number;
  player_count: number;
  current_turn_seat: number | null;
  turn_ends_at: number | null;
  matched_at: number;
  updated_at: number;
  board_preview: string | null;
  player_id: string;
  seat: number;
  score: number;
}

export async function createActiveMatch(
  db: D1Database,
  input: CreateActiveMatchInput
): Promise<void> {
  if (!input.gameId) {
    throw new Error("gameId is required");
  }
  if (input.players.length !== input.playerCount) {
    throw new Error("players must match playerCount");
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO active_matches (
        game_id,
        game_type,
        status,
        player_count,
        current_turn_seat,
        turn_ends_at,
        matched_at,
        updated_at,
        board_preview
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.gameId,
      input.gameType,
      0,
      input.playerCount,
      null,
      null,
      input.matchedAt,
      input.matchedAt,
      null
    )
  ];

  input.players.forEach((playerId, seat) => {
    statements.push(
      db.prepare(
        `INSERT INTO active_match_players (
          game_id,
          player_id,
          seat,
          score
        ) VALUES (?, ?, ?, ?)`
      ).bind(
        input.gameId,
        playerId,
        seat,
        0
      )
    );
  });

  await db.batch(statements);
}

export async function listActiveMatchesForPlayer(
  db: D1Database,
  playerId: string
): Promise<StoredActiveMatch[]> {
  const result = await db.prepare(
    `SELECT
      m.game_id,
      m.game_type,
      m.status,
      m.player_count,
      m.current_turn_seat,
      m.turn_ends_at,
      m.matched_at,
      m.updated_at,
      m.board_preview,
      p.player_id,
      p.seat,
      p.score
    FROM active_matches AS m
    INNER JOIN active_match_players AS p
      ON p.game_id = m.game_id
    WHERE m.status != 2
      AND EXISTS (
        SELECT 1
        FROM active_match_players AS mine
        WHERE mine.game_id = m.game_id
          AND mine.player_id = ?
      )
    ORDER BY m.matched_at DESC, p.seat ASC`
  )
    .bind(playerId)
    .all<ActiveMatchPlayerRow>();

  const matches = new Map<string, StoredActiveMatch>();

  for (const row of result.results ?? []) {
    let match = matches.get(row.game_id);
    if (!match) {
      match = {
        gameId: row.game_id,
        gameType: row.game_type,
        status: row.status,
        playerCount: row.player_count,
        currentTurnSeat: row.current_turn_seat,
        turnEndsAt: row.turn_ends_at,
        matchedAt: row.matched_at,
        updatedAt: row.updated_at,
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

export async function removeActiveMatch(
  db: D1Database,
  gameId: string
): Promise<void> {
  await db.batch([
    db.prepare(
      "DELETE FROM active_match_players WHERE game_id = ?"
    ).bind(gameId),
    db.prepare(
      "DELETE FROM active_matches WHERE game_id = ?"
    ).bind(gameId)
  ]);
}

function parseBoardPreview(value: string | null): StoredBoardPreview | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StoredBoardPreview;
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

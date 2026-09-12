export interface StoredActiveMatch {
  gameId: string;
  gameType: number;
  playerCount: number;
  matchedAt: number;
}

export interface CreateActiveMatchInput extends StoredActiveMatch {
  players: string[];
}

interface ActiveMatchRow {
  game_id: string;
  game_type: number;
  player_count: number;
  matched_at: number;
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
        player_count,
        matched_at
      ) VALUES (?, ?, ?, ?)`
    ).bind(
      input.gameId,
      input.gameType,
      input.playerCount,
      input.matchedAt
    )
  ];

  input.players.forEach((playerId, seat) => {
    statements.push(
      db.prepare(
        `INSERT INTO active_match_players (
          game_id,
          player_id,
          seat
        ) VALUES (?, ?, ?)`
      ).bind(
        input.gameId,
        playerId,
        seat
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
      m.player_count,
      m.matched_at
    FROM active_matches AS m
    INNER JOIN active_match_players AS p
      ON p.game_id = m.game_id
    WHERE p.player_id = ?
    ORDER BY m.matched_at DESC`
  )
    .bind(playerId)
    .all<ActiveMatchRow>();

  return (result.results ?? []).map(row => ({
    gameId: row.game_id,
    gameType: row.game_type,
    playerCount: row.player_count,
    matchedAt: row.matched_at
  }));
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

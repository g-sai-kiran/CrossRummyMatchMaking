import {
  createActiveMatch,
  removeActiveMatch
} from "./match-store";
import type { Env } from "./index";
import type { GameInvite } from "./invite-store";

interface GameRoomStub {
  createGame(
    gameId: string,
    creatorPlayerId: string,
    playerCount: number,
    gameType: number
  ): Promise<unknown>;
  addPlayer(playerId: string): Promise<unknown>;
  syncMatchSnapshot(): Promise<void>;
  clearGame(): Promise<void>;
}

export interface DirectInviteMatch {
  gameId: string;
  players: string[];
  websocketUrls: Record<string, string>;
}

function buildGameWebSocketUrl(
  baseUrl: string,
  gameId: string,
  playerId: string
): string {
  const url = new URL("/ws", baseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";

  url.searchParams.set("gameId", gameId);
  url.searchParams.set("playerId", playerId);
  return url.toString();
}

export async function createMatchForInvite(
  env: Env,
  invite: GameInvite
): Promise<DirectInviteMatch> {
  const players = [...invite.members]
    .sort((a, b) => a.seat - b.seat)
    .map(member => member.playerId);

  if (players.length !== invite.playerCount) {
    throw new Error("Invite player count no longer matches its members");
  }

  const gameId = crypto.randomUUID();
  const room = env.GAME_ROOM.getByName(gameId) as unknown as GameRoomStub;

  try {
    await room.createGame(
      gameId,
      players[0],
      invite.playerCount,
      invite.gameType
    );

    for (const playerId of players.slice(1)) {
      await room.addPlayer(playerId);
    }

    const matchedAt = Date.now();

    await createActiveMatch(env.MATCH_DB, {
      gameId,
      gameType: invite.gameType,
      playerCount: invite.playerCount,
      players,
      matchedAt
    });

    await room.syncMatchSnapshot();

    return {
      gameId,
      players,
      websocketUrls: Object.fromEntries(
        players.map(playerId => [
          playerId,
          buildGameWebSocketUrl(env.GAME_SERVER_URL, gameId, playerId)
        ])
      )
    };
  } catch (error) {
    try {
      await removeActiveMatch(env.MATCH_DB, gameId);
    } catch (databaseCleanupError) {
      console.error("Failed to clean invite-created active match", databaseCleanupError);
    }

    try {
      await room.clearGame();
    } catch (roomCleanupError) {
      console.error("Failed to clear invite-created GameRoom", roomCleanupError);
    }

    throw error;
  }
}

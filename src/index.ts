import { DurableObject } from "cloudflare:workers";
import {
  createActiveMatch,
  listActiveMatchesForPlayer,
  removeActiveMatch,
  StoredBoardPreview
} from "./match-store";
import { listMatchHistoryForPlayer } from "./match-history-store";

export enum GameType {
  Live = 0,
  Persistent = 1
}

interface MatchRequest {
  playerId: string;
  gameType: GameType;
  playerCount: number;
}

type TicketStatus = "queued" | "matching";

interface Ticket extends MatchRequest {
  ticketId: string;
  createdAt: number;
  lastSeenAt: number;
  status: TicketStatus;
}

interface MatchResult {
  ticketId: string;
  playerId: string;
  status: "matched";
  gameId: string;
  players: string[];
  websocketUrl: string;
  matchedAt: number;
  expiresAt: number;
}

interface GamePlayerSummary {
  id: string;
  seat: number;
  score: number;
}

interface PlayerMatchSummary {
  gameId: string;
  gameType: GameType;
  status: number;
  playerCount: number;
  players: GamePlayerSummary[];
  currentTurnSeat: number | null;
  turnEndsAt: number | null;
  isYourTurn: boolean;
  websocketUrl: string;
  matchedAt: number;
  updatedAt: number;
  boardPreview: StoredBoardPreview | null;
}

interface QueuedResponse {
  ticketId: string;
  status: "queued";
  pollAfterMs: number;
}

interface MatchedResponse {
  ticketId: string;
  status: "matched";
  gameId: string;
  players: string[];
  websocketUrl: string;
}

type MatchResponse = QueuedResponse | MatchedResponse;

interface PersistedState {
  tickets: Record<string, Ticket>;
  results: Record<string, MatchResult>;
}

interface LegacyTicket extends MatchRequest {
  ticketId: string;
  createdAt: number;
  lastSeenAt?: number;
  status: "queued" | "matching" | "matched" | "cancelled";
}

interface GameRoomStub {
  createGame(
    gameId: string,
    creatorPlayerId: string,
    playerCount: number,
    gameType: GameType
  ): Promise<unknown>;
  addPlayer(playerId: string): Promise<unknown>;
  syncMatchSnapshot(): Promise<void>;
  clearGame(): Promise<void>;
}

export interface Env {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  GAME_ROOM: DurableObjectNamespace;
  MATCH_DB: D1Database;
  GAME_SERVER_URL: string;
  CORS_ORIGIN?: string;
}

const MATCHMAKER_NAME = "global";
const POLL_AFTER_MS = 1_000;
const QUEUED_TICKET_TTL_MS = 30_000;
const MATCH_RESULT_TTL_MS = 10 * 60_000;
const STATE_KEY = "state";
const LEGACY_TICKETS_KEY = "tickets";

export class Matchmaker extends DurableObject<Env> {
  private tickets = new Map<string, Ticket>();
  private results = new Map<string, MatchResult>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      let shouldSave = false;
      const stored = await ctx.storage.get<PersistedState>(STATE_KEY);

      if (stored) {
        this.tickets = new Map(Object.entries(stored.tickets ?? {}));
        this.results = new Map(Object.entries(stored.results ?? {}));
      } else {
        const legacy = await ctx.storage.get<Record<string, LegacyTicket>>(LEGACY_TICKETS_KEY);
        if (legacy) {
          for (const [ticketId, ticket] of Object.entries(legacy)) {
            if (ticket.status === "queued" || ticket.status === "matching") {
              this.tickets.set(ticketId, {
                ticketId,
                playerId: ticket.playerId,
                gameType: ticket.gameType,
                playerCount: ticket.playerCount,
                createdAt: ticket.createdAt,
                lastSeenAt: ticket.lastSeenAt ?? ticket.createdAt,
                status: ticket.status === "matching" ? "matching" : "queued"
              });
            }
          }
          shouldSave = true;
        }
      }

      for (const ticket of this.tickets.values()) {
        if (!Number.isFinite(ticket.lastSeenAt)) {
          ticket.lastSeenAt = ticket.createdAt;
          shouldSave = true;
        }

        if (ticket.status === "matching") {
          ticket.status = "queued";
          shouldSave = true;
        }
      }

      const now = Date.now();
      if (this.removeExpiredTickets(now)) {
        shouldSave = true;
      }
      if (this.removeExpiredResults(now)) {
        shouldSave = true;
      }

      if (shouldSave) {
        await this.saveState();
        await ctx.storage.delete(LEGACY_TICKETS_KEY);
      }

      await this.scheduleCleanupAlarm();
    });
  }

  async enqueue(request: MatchRequest): Promise<MatchResponse> {
    validateRequest(request);

    const now = Date.now();
    const changed = this.removeExpiredTickets(now) || this.removeExpiredResults(now);
    if (changed) {
      await this.saveState();
    }

    const existing = this.findActiveTicketForPlayer(request.playerId);
    if (existing) {
      if (
        existing.gameType === request.gameType &&
        existing.playerCount === request.playerCount
      ) {
        existing.lastSeenAt = now;
        await this.saveState();
        await this.scheduleCleanupAlarm();

        if (existing.status === "queued") {
          await this.tryCreateMatch(existing);
          const existingResult = this.results.get(existing.ticketId);
          if (existingResult) {
            return this.toMatchedResponse(existingResult);
          }
        }
        return this.toQueuedResponse(existing);
      }

      if (existing.status === "matching") {
        return this.toQueuedResponse(existing);
      }

      this.tickets.delete(existing.ticketId);
    }

    const ticket: Ticket = {
      ...request,
      ticketId: crypto.randomUUID(),
      createdAt: now,
      lastSeenAt: now,
      status: "queued"
    };

    this.tickets.set(ticket.ticketId, ticket);
    await this.saveState();
    await this.scheduleCleanupAlarm();

    await this.tryCreateMatch(ticket);

    const result = this.results.get(ticket.ticketId);
    if (result) {
      return this.toMatchedResponse(result);
    }

    const queuedTicket = this.tickets.get(ticket.ticketId);
    if (!queuedTicket) {
      throw new Error("Matchmaking ticket disappeared before a result was created");
    }

    return this.toQueuedResponse(queuedTicket);
  }

  async getStatus(ticketId: string): Promise<MatchResponse | null> {
    const now = Date.now();
    const changed = this.removeExpiredTickets(now) || this.removeExpiredResults(now);
    if (changed) {
      await this.saveState();
    }

    const result = this.results.get(ticketId);
    if (result) {
      await this.scheduleCleanupAlarm();
      return this.toMatchedResponse(result);
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      await this.scheduleCleanupAlarm();
      return null;
    }

    ticket.lastSeenAt = now;
    await this.saveState();
    await this.scheduleCleanupAlarm();

    if (ticket.status === "queued") {
      await this.tryCreateMatch(ticket);
      const matched = this.results.get(ticketId);
      if (matched) {
        return this.toMatchedResponse(matched);
      }
    }

    return this.toQueuedResponse(ticket);
  }

  async getPlayerMatches(playerId: string): Promise<PlayerMatchSummary[]> {
    if (!playerId.trim()) {
      throw new HttpError(400, "playerId is required");
    }

    const tracked = await listActiveMatchesForPlayer(
      this.env.MATCH_DB,
      playerId
    );

    return tracked.map(record => {
      const localPlayer = record.players.find(player => player.id === playerId);

      return {
        gameId: record.gameId,
        gameType: record.gameType as GameType,
        status: record.status,
        playerCount: record.playerCount,
        players: record.players,
        currentTurnSeat: record.currentTurnSeat,
        turnEndsAt: record.turnEndsAt,
        isYourTurn:
          localPlayer !== undefined &&
          localPlayer.seat === record.currentTurnSeat,
        websocketUrl: buildGameWebSocketUrl(
          this.env.GAME_SERVER_URL,
          record.gameId,
          playerId
        ),
        matchedAt: record.matchedAt,
        updatedAt: record.updatedAt,
        boardPreview: record.boardPreview
      };
    });
  }

  async getPlayerMatchHistory(playerId: string, limit: number) {
    if (!playerId.trim()) {
      throw new HttpError(400, "playerId is required");
    }

    return listMatchHistoryForPlayer(
      this.env.MATCH_DB,
      playerId,
      limit
    );
  }

  async cancel(ticketId: string, playerId: string): Promise<"cancelled" | "matched" | "not-found"> {
    const result = this.results.get(ticketId);
    if (result) {
      return result.playerId === playerId ? "matched" : "not-found";
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.playerId !== playerId) {
      return "not-found";
    }

    if (ticket.status === "matching") {
      return "matched";
    }

    this.tickets.delete(ticketId);
    await this.saveState();
    await this.scheduleCleanupAlarm();
    return "cancelled";
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const changed = this.removeExpiredTickets(now) || this.removeExpiredResults(now);

    if (changed) {
      await this.saveState();
    }

    await this.scheduleCleanupAlarm();
  }

  private async tryCreateMatch(newTicket: Ticket): Promise<void> {
    const now = Date.now();
    if (this.removeExpiredTickets(now)) {
      await this.saveState();
    }

    const candidates = [...this.tickets.values()]
      .filter(ticket =>
        ticket.status === "queued" &&
        ticket.gameType === newTicket.gameType &&
        ticket.playerCount === newTicket.playerCount &&
        now - ticket.lastSeenAt < QUEUED_TICKET_TTL_MS
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    if (candidates.length < newTicket.playerCount) {
      await this.scheduleCleanupAlarm();
      return;
    }

    const matched = candidates.slice(0, newTicket.playerCount);
    for (const ticket of matched) {
      ticket.status = "matching";
    }
    await this.saveState();

    const gameId = crypto.randomUUID();
    const players = matched.map(ticket => ticket.playerId);
    const room = this.env.GAME_ROOM.getByName(gameId) as unknown as GameRoomStub;

    try {
      await room.createGame(gameId, players[0], newTicket.playerCount, newTicket.gameType);

      for (const playerId of players.slice(1)) {
        await room.addPlayer(playerId);
      }

      const matchedAt = Date.now();

      await createActiveMatch(this.env.MATCH_DB, {
        gameId,
        gameType: newTicket.gameType,
        playerCount: newTicket.playerCount,
        players,
        matchedAt
      });

      await room.syncMatchSnapshot();

      for (const ticket of matched) {
        this.tickets.delete(ticket.ticketId);
        this.results.set(ticket.ticketId, {
          ticketId: ticket.ticketId,
          playerId: ticket.playerId,
          status: "matched",
          gameId,
          players,
          websocketUrl: buildGameWebSocketUrl(this.env.GAME_SERVER_URL, gameId, ticket.playerId),
          matchedAt,
          expiresAt: matchedAt + MATCH_RESULT_TTL_MS
        });
      }

      await this.saveState();
      await this.scheduleCleanupAlarm();
    } catch (error) {
      try {
        await removeActiveMatch(this.env.MATCH_DB, gameId);
      } catch (databaseCleanupError) {
        console.error("Failed to clean active match row", databaseCleanupError);
      }

      const retryAt = Date.now();
      for (const ticket of matched) {
        ticket.status = "queued";
        ticket.lastSeenAt = retryAt;
        this.tickets.set(ticket.ticketId, ticket);
      }
      await this.saveState();
      await this.scheduleCleanupAlarm();

      try {
        await room.clearGame();
      } catch (cleanupError) {
        console.error("Failed to clear partially created game", cleanupError);
      }

      throw error;
    }
  }

  private findActiveTicketForPlayer(playerId: string): Ticket | undefined {
    return [...this.tickets.values()].find(ticket => ticket.playerId === playerId);
  }

  private toQueuedResponse(ticket: Ticket): QueuedResponse {
    return {
      ticketId: ticket.ticketId,
      status: "queued",
      pollAfterMs: POLL_AFTER_MS
    };
  }

  private toMatchedResponse(result: MatchResult): MatchedResponse {
    return {
      ticketId: result.ticketId,
      status: result.status,
      gameId: result.gameId,
      players: result.players,
      websocketUrl: result.websocketUrl
    };
  }

  private removeExpiredTickets(now: number): boolean {
    let removed = false;

    for (const [ticketId, ticket] of this.tickets) {
      if (
        ticket.status === "queued" &&
        now - ticket.lastSeenAt >= QUEUED_TICKET_TTL_MS
      ) {
        this.tickets.delete(ticketId);
        removed = true;
      }
    }

    return removed;
  }

  private removeExpiredResults(now: number): boolean {
    let removed = false;
    for (const [ticketId, result] of this.results) {
      if (result.expiresAt <= now) {
        this.results.delete(ticketId);
        removed = true;
      }
    }
    return removed;
  }

  private async scheduleCleanupAlarm(): Promise<void> {
    let nextDeadline: number | undefined;

    for (const ticket of this.tickets.values()) {
      if (ticket.status !== "queued") {
        continue;
      }

      const expiresAt = ticket.lastSeenAt + QUEUED_TICKET_TTL_MS;
      if (nextDeadline === undefined || expiresAt < nextDeadline) {
        nextDeadline = expiresAt;
      }
    }

    for (const result of this.results.values()) {
      if (nextDeadline === undefined || result.expiresAt < nextDeadline) {
        nextDeadline = result.expiresAt;
      }
    }

    if (nextDeadline === undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(nextDeadline);
  }

  private async saveState(): Promise<void> {
    const state: PersistedState = {
      tickets: Object.fromEntries(this.tickets),
      results: Object.fromEntries(this.results)
    };
    await this.ctx.storage.put(STATE_KEY, state);
  }
}

function validateRequest(request: MatchRequest): void {
  if (!request || typeof request !== "object") {
    throw new HttpError(400, "JSON body is required");
  }
  if (!request.playerId?.trim()) {
    throw new HttpError(400, "playerId is required");
  }
  if (request.gameType !== GameType.Live && request.gameType !== GameType.Persistent) {
    throw new HttpError(400, "gameType must be 0 (Live) or 1 (Persistent)");
  }
  if (!Number.isInteger(request.playerCount) || request.playerCount < 2 || request.playerCount > 4) {
    throw new HttpError(400, "playerCount must be between 2 and 4");
  }
}

function buildGameWebSocketUrl(baseUrl: string, gameId: string, playerId: string): string {
  if (!baseUrl?.trim()) {
    throw new Error("GAME_SERVER_URL is not configured");
  }

  const url = new URL("/ws", baseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("GAME_SERVER_URL must use http, https, ws, or wss");
  }

  url.searchParams.set("gameId", gameId);
  url.searchParams.set("playerId", playerId);
  return url.toString();
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "access-control-allow-origin": env.CORS_ORIGIN?.trim() || "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store"
  };
}

function json(data: unknown, env: Env, status = 200): Response {
  return Response.json(data, {
    status,
    headers: corsHeaders(env)
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env)
      });
    }

    const matchmaker = env.MATCHMAKER.getByName(MATCHMAKER_NAME);

    try {
      if (request.method === "POST" && url.pathname === "/matchmake") {
        let body: MatchRequest;
        try {
          body = await request.json() as MatchRequest;
        } catch {
          throw new HttpError(400, "Request body must be valid JSON");
        }

        const result = await matchmaker.enqueue(body);
        return json(result, env, result.status === "matched" ? 200 : 202);
      }

      if (request.method === "GET" && url.pathname === "/matchmake/status") {
        const ticketId = url.searchParams.get("ticketId");
        if (!ticketId) {
          throw new HttpError(400, "ticketId is required");
        }

        const result = await matchmaker.getStatus(ticketId);
        return result ? json(result, env) : json({ error: "Ticket not found or expired" }, env, 404);
      }

      if (request.method === "GET" && url.pathname === "/matches") {
        const playerId = url.searchParams.get("playerId")?.trim();
        if (!playerId) {
          throw new HttpError(400, "playerId is required");
        }

        const matches = await matchmaker.getPlayerMatches(playerId);
        return json({
          playerId,
          matches,
          count: matches.length
        }, env);
      }

      if (request.method === "GET" && url.pathname === "/match-history") {
        const playerId = url.searchParams.get("playerId")?.trim();
        if (!playerId) {
          throw new HttpError(400, "playerId is required");
        }

        const rawLimit = url.searchParams.get("limit");
        const parsedLimit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
          throw new HttpError(400, "limit must be an integer between 1 and 100");
        }

        const matches = await matchmaker.getPlayerMatchHistory(
          playerId,
          parsedLimit
        );
        return json({
          playerId,
          matches,
          count: matches.length
        }, env);
      }

      if (request.method === "DELETE" && url.pathname === "/matchmake") {
        const ticketId = url.searchParams.get("ticketId");
        const playerId = url.searchParams.get("playerId");
        if (!ticketId || !playerId) {
          throw new HttpError(400, "ticketId and playerId are required");
        }

        const result = await matchmaker.cancel(ticketId, playerId);
        if (result === "cancelled") {
          return json({ ticketId, status: "cancelled" }, env);
        }
        if (result === "matched") {
          return json({ error: "Ticket is already being matched or has matched" }, env, 409);
        }
        return json({ error: "Queued ticket not found" }, env, 404);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok" }, env);
      }

      return json({ error: "Not found" }, env, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, env, error.status);
      }

      console.error("Matchmaking request failed", error);
      return json({ error: "Matchmaking service failed" }, env, 500);
    }
  }
} satisfies ExportedHandler<Env>;

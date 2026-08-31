import { DurableObject } from "cloudflare:workers";

export enum GameType {
  Live = 0,
  Persistent = 1
}

interface MatchRequest {
  playerId: string;
  rank: number;
  gameType: GameType;
  playerCount: number;
}

interface Ticket extends MatchRequest {
  ticketId: string;
  createdAt: number;
  status: "queued" | "matched" | "cancelled";
  gameId?: string;
  players?: string[];
}

interface MatchResponse {
  ticketId: string;
  status: Ticket["status"];
  gameId?: string;
  players?: string[];
  websocketUrl?: string;
}

interface GameRoomStub {
  createGame(gameId: string, creatorPlayerId: string, playerCount: number, gameType: GameType): Promise<unknown>;
  addPlayer(playerId: string): Promise<unknown>;
  clearGame(): Promise<void>;
}

export interface Env {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  GAME_ROOM: DurableObjectNamespace;
}

const MATCHMAKER_NAME = "global";
const MAX_RANK_DIFFERENCE = 200;

export class Matchmaker extends DurableObject<Env> {
  private tickets = new Map<string, Ticket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<Record<string, Ticket>>("tickets");
      if (stored) {
        this.tickets = new Map(Object.entries(stored));
      }
    });
  }

  async enqueue(request: MatchRequest): Promise<MatchResponse> {
    validateRequest(request);

    const existing = [...this.tickets.values()].find(
      ticket => ticket.playerId === request.playerId && ticket.status === "queued"
    );

    if (existing) {
      return this.toResponse(existing);
    }

    const ticket: Ticket = {
      ...request,
      ticketId: crypto.randomUUID(),
      createdAt: Date.now(),
      status: "queued"
    };

    this.tickets.set(ticket.ticketId, ticket);
    await this.tryCreateMatch(ticket);
    await this.save();

    return this.toResponse(this.tickets.get(ticket.ticketId)!);
  }

  async getStatus(ticketId: string): Promise<MatchResponse | null> {
    const ticket = this.tickets.get(ticketId);
    return ticket ? this.toResponse(ticket) : null;
  }

  async cancel(ticketId: string, playerId: string): Promise<boolean> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.playerId !== playerId || ticket.status !== "queued") {
      return false;
    }

    ticket.status = "cancelled";
    await this.save();
    return true;
  }

  private async tryCreateMatch(newTicket: Ticket): Promise<void> {
    const candidates = [...this.tickets.values()]
      .filter(ticket =>
        ticket.status === "queued" &&
        ticket.gameType === newTicket.gameType &&
        ticket.playerCount === newTicket.playerCount &&
        Math.abs(ticket.rank - newTicket.rank) <= MAX_RANK_DIFFERENCE
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    if (candidates.length < newTicket.playerCount) {
      return;
    }

    const matched = candidates.slice(0, newTicket.playerCount);
    const gameId = crypto.randomUUID();
    const players = matched.map(ticket => ticket.playerId);

    const room = this.env.GAME_ROOM.getByName(gameId) as unknown as GameRoomStub;
    await room.createGame(gameId, players[0], newTicket.playerCount, newTicket.gameType);

    for (const playerId of players.slice(1)) {
      await room.addPlayer(playerId);
    }

    for (const ticket of matched) {
      ticket.status = "matched";
      ticket.gameId = gameId;
      ticket.players = players;
    }
  }

  private toResponse(ticket: Ticket): MatchResponse {
    return {
      ticketId: ticket.ticketId,
      status: ticket.status,
      gameId: ticket.gameId,
      players: ticket.players,
      websocketUrl: ticket.gameId
        ? `/ws?gameId=${encodeURIComponent(ticket.gameId)}&playerId=${encodeURIComponent(ticket.playerId)}`
        : undefined
    };
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("tickets", Object.fromEntries(this.tickets));
  }
}

function validateRequest(request: MatchRequest): void {
  if (!request.playerId?.trim()) throw new Error("playerId is required");
  if (!Number.isFinite(request.rank)) throw new Error("rank must be a number");
  if (request.gameType !== GameType.Live && request.gameType !== GameType.Persistent) {
    throw new Error("gameType must be 0 (Live) or 1 (Persistent)");
  }
  if (!Number.isInteger(request.playerCount) || request.playerCount < 2 || request.playerCount > 4) {
    throw new Error("playerCount must be between 2 and 4");
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const matchmaker = env.MATCHMAKER.getByName(MATCHMAKER_NAME);

    try {
      if (request.method === "POST" && url.pathname === "/matchmake") {
        const body = await request.json<MatchRequest>();
        const result = await matchmaker.enqueue(body);
        return json(result, result.status === "matched" ? 200 : 202);
      }

      if (request.method === "GET" && url.pathname === "/matchmake/status") {
        const ticketId = url.searchParams.get("ticketId");
        if (!ticketId) return json({ error: "ticketId is required" }, 400);

        const result = await matchmaker.getStatus(ticketId);
        return result ? json(result) : json({ error: "Ticket not found" }, 404);
      }

      if (request.method === "DELETE" && url.pathname === "/matchmake") {
        const ticketId = url.searchParams.get("ticketId");
        const playerId = url.searchParams.get("playerId");
        if (!ticketId || !playerId) {
          return json({ error: "ticketId and playerId are required" }, 400);
        }

        const cancelled = await matchmaker.cancel(ticketId, playerId);
        return cancelled ? json({ status: "cancelled" }) : json({ error: "Queued ticket not found" }, 404);
      }

      if (request.method === "POST" && url.pathname.startsWith("/games/") && url.pathname.endsWith("/close")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const gameId = parts[1];
        if (!gameId) return json({ error: "gameId is required" }, 400);

        const room = env.GAME_ROOM.getByName(gameId) as unknown as GameRoomStub;
        await room.clearGame();
        return json({ gameId, status: "closed" });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok" });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
    }
  }
} satisfies ExportedHandler<Env>;

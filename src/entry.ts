import handler, { Env, Matchmaker } from "./index";
import { listMatchHistoryForPlayer } from "./match-history-store";

export { Matchmaker };

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

    if (request.method === "GET" && url.pathname === "/match-history") {
      const playerId = url.searchParams.get("playerId")?.trim();
      if (!playerId) {
        return json({ error: "playerId is required" }, env, 400);
      }

      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return json(
          { error: "limit must be an integer between 1 and 100" },
          env,
          400
        );
      }

      const cursor = url.searchParams.get("cursor");

      try {
        const page = await listMatchHistoryForPlayer(
          env.MATCH_DB,
          playerId,
          limit,
          cursor
        );

        return json({
          playerId,
          matches: page.matches,
          count: page.matches.length,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor
        }, env);
      }
      catch (error) {
        if (error instanceof Error && error.message === "Invalid history cursor") {
          return json({ error: error.message }, env, 400);
        }

        console.error("Match history request failed", error);
        return json({ error: "Match history request failed" }, env, 500);
      }
    }

    return handler.fetch(request, env);
  }
} satisfies ExportedHandler<Env>;

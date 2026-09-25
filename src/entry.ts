import handler, { Env, Matchmaker } from "./index";
import { listMatchHistoryForPlayer } from "./match-history-store";
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  declineInvite,
  getInvite,
  listInvitesForPlayer,
  markInviteStarted,
  registerPushDevice,
  revertInviteStarting,
  unregisterPushDevice
} from "./invite-store";
import { AuthenticationError, requirePlayerId } from "./playfab-auth";
import { createMatchForInvite } from "./invite-service";
import { sendPushToPlayer } from "./push";

export { Matchmaker };

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface CreateInviteBody {
  inviteePlayerIds?: string[];
  gameType?: number;
  playerCount?: number;
  expiresInSeconds?: number;
}

interface RegisterDeviceBody {
  installationId?: string;
  platform?: string;
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "access-control-allow-origin": env.CORS_ORIGIN?.trim() || "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "cache-control": "no-store"
  };
}

function json(data: unknown, env: Env, status = 200): Response {
  return Response.json(data, {
    status,
    headers: corsHeaders(env)
  });
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function validateCreateInvite(
  playerId: string,
  body: CreateInviteBody
): {
  inviteePlayerIds: string[];
  gameType: number;
  playerCount: number;
  expiresAt: number;
} {
  const invitees = (body.inviteePlayerIds ?? [])
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));

  if (body.gameType !== 0 && body.gameType !== 1) {
    throw new HttpError(400, "gameType must be 0 (Live) or 1 (Persistent)");
  }

  if (
    !Number.isInteger(body.playerCount) ||
    (body.playerCount ?? 0) < 2 ||
    (body.playerCount ?? 0) > 4
  ) {
    throw new HttpError(400, "playerCount must be between 2 and 4");
  }

  const playerCount = body.playerCount as number;
  if (invitees.length !== playerCount - 1) {
    throw new HttpError(
      400,
      `inviteePlayerIds must contain exactly ${playerCount - 1} players`
    );
  }

  if (new Set(invitees).size !== invitees.length) {
    throw new HttpError(400, "inviteePlayerIds must be unique");
  }

  if (invitees.includes(playerId)) {
    throw new HttpError(400, "You cannot invite yourself");
  }

  const expiresInSeconds = body.expiresInSeconds ?? 300;
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 30 ||
    expiresInSeconds > 3600
  ) {
    throw new HttpError(
      400,
      "expiresInSeconds must be an integer between 30 and 3600"
    );
  }

  return {
    inviteePlayerIds: invitees,
    gameType: body.gameType,
    playerCount,
    expiresAt: Date.now() + expiresInSeconds * 1000
  };
}

function ensureInviteMember(
  invite: Awaited<ReturnType<typeof getInvite>>,
  playerId: string
): void {
  if (!invite || !invite.members.some(member => member.playerId === playerId)) {
    throw new HttpError(404, "Invite not found");
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env)
      });
    }

    try {
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

      if (request.method === "POST" && url.pathname === "/devices/register") {
        const playerId = await requirePlayerId(request, env);
        const body = await parseJson<RegisterDeviceBody>(request);
        const installationId = body.installationId?.trim();
        const platform = body.platform?.trim().toLowerCase();

        if (!installationId) {
          throw new HttpError(400, "installationId is required");
        }

        if (!platform || !["android", "ios"].includes(platform)) {
          throw new HttpError(400, "platform must be android or ios");
        }

        await registerPushDevice(
          env.MATCH_DB,
          playerId,
          installationId,
          platform
        );

        return json({ status: "registered", installationId }, env);
      }

      if (request.method === "DELETE" && url.pathname === "/devices") {
        const playerId = await requirePlayerId(request, env);
        const installationId = url.searchParams.get("installationId")?.trim();
        if (!installationId) {
          throw new HttpError(400, "installationId is required");
        }

        await unregisterPushDevice(env.MATCH_DB, playerId, installationId);
        return json({ status: "unregistered", installationId }, env);
      }

      if (request.method === "POST" && url.pathname === "/invites") {
        const playerId = await requirePlayerId(request, env);
        const body = validateCreateInvite(
          playerId,
          await parseJson<CreateInviteBody>(request)
        );

        const invite = await createInvite(env.MATCH_DB, {
          hostPlayerId: playerId,
          ...body
        });

        for (const inviteePlayerId of body.inviteePlayerIds) {
          ctx.waitUntil(
            sendPushToPlayer(
              env.MATCH_DB,
              env,
              inviteePlayerId,
              "Cross Rummy",
              "You received a game invite.",
              {
                type: "game_invite",
                inviteId: invite.inviteId,
                hostPlayerId: playerId
              }
            )
          );
        }

        return json({ invite }, env, 201);
      }

      if (request.method === "GET" && url.pathname === "/invites") {
        const playerId = await requirePlayerId(request, env);
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 50 : Number(rawLimit);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(400, "limit must be an integer between 1 and 100");
        }

        const invites = await listInvitesForPlayer(
          env.MATCH_DB,
          playerId,
          limit
        );

        return json({
          playerId,
          invites,
          count: invites.length
        }, env);
      }

      const inviteMatch = url.pathname.match(/^\/invites\/([^/]+)$/);
      if (request.method === "GET" && inviteMatch) {
        const playerId = await requirePlayerId(request, env);
        const invite = await getInvite(
          env.MATCH_DB,
          decodeURIComponent(inviteMatch[1])
        );
        ensureInviteMember(invite, playerId);
        return json({ invite }, env);
      }

      const actionMatch = url.pathname.match(
        /^\/invites\/([^/]+)\/(accept|decline|cancel)$/
      );

      if (request.method === "POST" && actionMatch) {
        const playerId = await requirePlayerId(request, env);
        const inviteId = decodeURIComponent(actionMatch[1]);
        const action = actionMatch[2];

        if (action === "accept") {
          const result = await acceptInvite(
            env.MATCH_DB,
            inviteId,
            playerId
          );

          if (!result) {
            throw new HttpError(404, "Invite not found");
          }

          if (
            result.invite.status !== "pending" &&
            result.invite.status !== "starting" &&
            result.invite.status !== "started"
          ) {
            throw new HttpError(
              409,
              `Invite is already ${result.invite.status}`
            );
          }

          if (result.becameReady) {
            try {
              const match = await createMatchForInvite(env, result.invite);
              const invite = await markInviteStarted(
                env.MATCH_DB,
                inviteId,
                match.gameId
              );

              for (const matchPlayerId of match.players) {
                ctx.waitUntil(
                  sendPushToPlayer(
                    env.MATCH_DB,
                    env,
                    matchPlayerId,
                    "Cross Rummy",
                    "Your invited match is ready.",
                    {
                      type: "invite_match_started",
                      inviteId,
                      gameId: match.gameId,
                      websocketUrl: match.websocketUrls[matchPlayerId]
                    }
                  )
                );
              }

              return json({
                invite,
                match: {
                  gameId: match.gameId,
                  players: match.players,
                  websocketUrl: match.websocketUrls[playerId]
                }
              }, env);
            } catch (error) {
              await revertInviteStarting(env.MATCH_DB, inviteId);
              throw error;
            }
          }

          ctx.waitUntil(
            sendPushToPlayer(
              env.MATCH_DB,
              env,
              result.invite.hostPlayerId,
              "Cross Rummy",
              "A player accepted your game invite.",
              {
                type: "invite_accepted",
                inviteId,
                playerId
              }
            )
          );

          return json({ invite: result.invite }, env);
        }

        if (action === "decline") {
          const invite = await declineInvite(
            env.MATCH_DB,
            inviteId,
            playerId
          );
          if (!invite) {
            throw new HttpError(404, "Invite not found");
          }

          ctx.waitUntil(
            sendPushToPlayer(
              env.MATCH_DB,
              env,
              invite.hostPlayerId,
              "Cross Rummy",
              "A player declined your game invite.",
              {
                type: "invite_declined",
                inviteId,
                playerId
              }
            )
          );

          return json({ invite }, env);
        }

        const invite = await cancelInvite(
          env.MATCH_DB,
          inviteId,
          playerId
        );
        if (!invite) {
          throw new HttpError(404, "Invite not found");
        }

        for (const member of invite.members) {
          if (member.role !== "invitee") {
            continue;
          }

          ctx.waitUntil(
            sendPushToPlayer(
              env.MATCH_DB,
              env,
              member.playerId,
              "Cross Rummy",
              "A game invite was cancelled.",
              {
                type: "invite_cancelled",
                inviteId
              }
            )
          );
        }

        return json({ invite }, env);
      }

      return handler.fetch(request, env);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return json({ error: error.message }, env, error.status);
      }

      if (error instanceof HttpError) {
        return json({ error: error.message }, env, error.status);
      }

      console.error("Invite API request failed", error);
      return json({ error: "Invite service failed" }, env, 500);
    }
  }
} satisfies ExportedHandler<Env>;

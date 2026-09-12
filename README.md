# CrossRummyMatchMaking

Cloudflare Worker + Durable Object matchmaking service for Cross Rummy.

## What it does

The client sends:

- `playerId`
- `gameType` (`0 = Live`, `1 = Persistent`)
- `playerCount` (`2` to `4`)

Before creating or reusing a matchmaking ticket, the service checks the `board-game-server` game registry. If that player already belongs to a game whose status is still `Waiting` or `Playing`, matchmaking does **not** create a new match. Instead it returns the existing `gameId` and a fresh WebSocket URL for that same player so the client can reconnect.

Players who do not already have a running game are matched only with other queued players that requested the **same `gameType` and the same `playerCount`**.

When enough players are available:

1. The matchmaker reserves those tickets so another request cannot reuse them.
2. It generates a new `gameId`.
3. It addresses `GAME_ROOM.getByName(gameId)` in the `board-game-server` Worker.
4. The first RPC to `createGame(...)` causes Cloudflare to create/lazily instantiate that `GameRoom` Durable Object.
5. The remaining matched players are added to the room.
6. The matchmaking queue tickets are deleted.
7. A short-lived match-result record is kept for 10 minutes so every waiting client can poll and receive the same `gameId` and its own WebSocket URL.
8. The client connects directly to `board-game-server` using the returned `websocketUrl`.

Queued tickets use a **30-second lease**. Calling the status endpoint refreshes the lease. If a player closes the app, loses connection, or otherwise stops polling, the ticket expires automatically and is removed from matchmaking, so an abandoned player cannot be matched later.

The `board-game-server` binding is configured as a cross-Worker Durable Object binding in `wrangler.jsonc`.

## API

Use your deployed matchmaking Worker URL as `MATCHMAKING_URL`, for example:

```text
https://cross-rummy-matchmaking.<your-workers-subdomain>.workers.dev
```

### 1. Join matchmaking or resume an existing game

```http
POST /matchmake
Content-Type: application/json
```

Body:

```json
{
  "playerId": "player-123",
  "gameType": 0,
  "playerCount": 2
}
```

The server first checks whether `player-123` already belongs to a non-finished GameRoom. If so it immediately returns HTTP `200` with that existing match:

```json
{
  "ticketId": "new-delivery-id",
  "status": "matched",
  "gameId": "existing-game-id",
  "players": ["player-123", "player-456"],
  "websocketUrl": "wss://board-game-server.g-saikirangoud99740.workers.dev/ws?gameId=existing-game-id&playerId=player-123"
}
```

This reconnect check takes priority over the requested `gameType` and `playerCount`: a player cannot enter matchmaking for another game while their previous game still exists.

If the player has no existing game and is waiting, the Worker returns HTTP `202`:

```json
{
  "ticketId": "8c7b...",
  "status": "queued",
  "pollAfterMs": 1000
}
```

If this request completes a new match, the Worker returns HTTP `200`:

```json
{
  "ticketId": "8c7b...",
  "status": "matched",
  "gameId": "1d21...",
  "players": ["player-123", "player-456"],
  "websocketUrl": "wss://board-game-server.g-saikirangoud99740.workers.dev/ws?gameId=1d21...&playerId=player-123"
}
```

Calling `POST /matchmake` again for the same player and the same settings reuses the current queued ticket instead of creating duplicate queue entries.

If a queued player changes `gameType` or `playerCount`, the old queued ticket is replaced by the new request.

### 2. Poll ticket status

A queued client should poll using the `pollAfterMs` value returned by the server.

```http
GET /matchmake/status?ticketId=<ticketId>
```

Each successful queued status poll refreshes the ticket's 30-second lease.

Queued response:

```json
{
  "ticketId": "8c7b...",
  "status": "queued",
  "pollAfterMs": 1000
}
```

Matched response:

```json
{
  "ticketId": "8c7b...",
  "status": "matched",
  "gameId": "1d21...",
  "players": ["player-123", "player-456"],
  "websocketUrl": "wss://board-game-server.g-saikirangoud99740.workers.dev/ws?gameId=1d21...&playerId=player-123"
}
```

If the client stops polling for 30 seconds while still queued, the ticket expires. A later status request returns `404` and the client should call `POST /matchmake` again. That new request will first resume any still-running game for the player before creating another matchmaking ticket.

After a match is created, the queue ticket itself is already removed. The status endpoint reads the temporary delivery record, which expires automatically after 10 minutes. Even after that delivery record expires, calling `POST /matchmake` again can recover the existing game from the backend game registry as long as the GameRoom has not been cleared or finished.

### 3. Cancel matchmaking

```http
DELETE /matchmake?ticketId=<ticketId>&playerId=<playerId>
```

Success:

```json
{
  "ticketId": "8c7b...",
  "status": "cancelled"
}
```

A ticket that is already being converted into a game cannot be cancelled and returns HTTP `409`.

### 4. Health check

```http
GET /health
```

```json
{
  "status": "ok"
}
```

## Unity client behavior

The client does not need a separate resume API. On startup, reconnect, or when the player presses Find Match, call the same `POST /matchmake` endpoint with the player's stable `playerId`.

If the server returns `status = "matched"`, connect directly to the returned `websocketUrl`. This may be either a newly created game or the player's already-running game.

If it returns `status = "queued"`, start polling `/matchmake/status` using `pollAfterMs`.

If a queued poll later returns `404`, the lease expired. If the user is still searching, call `POST /matchmake` again rather than assuming there is no active game; the POST performs the authoritative running-game lookup first.

### NativeWebSocket handoff

Do not rebuild the game URL on the client. Use the `websocketUrl` returned by matchmaking:

```csharp
var websocket = new NativeWebSocket.WebSocket(matchResponse.websocketUrl);
await websocket.Connect();
```

That URL already contains the `gameId` and the correct `playerId`.

## Quick manual test

Start the Worker locally:

```bash
npm install
npm run dev
```

Queue player 1:

```bash
curl -X POST http://localhost:8787/matchmake \
  -H "Content-Type: application/json" \
  -d '{"playerId":"p1","gameType":0,"playerCount":2}'
```

Queue player 2 with the same mode/count:

```bash
curl -X POST http://localhost:8787/matchmake \
  -H "Content-Type: application/json" \
  -d '{"playerId":"p2","gameType":0,"playerCount":2}'
```

The second request should return `matched`. Poll player 1's ticket and it should return the same `gameId`.

Then disconnect `p1` from the game but leave the GameRoom alive. Call `POST /matchmake` for `p1` again. It should return HTTP `200` with the **same existing `gameId`**, not queue the player for another match.

To test abandoned-ticket cleanup, queue a player and then stop polling. After more than 30 seconds, `GET /matchmake/status?ticketId=...` should return `404`.

A request with `gameType: 1` or a different `playerCount` must not join an unrelated queued match.

> Local cross-Worker Durable Object RPC requires the `board-game-server` Worker to be available/configured. For the simplest end-to-end check, deploy both Workers and test their `workers.dev` URLs.

## Deploy

The game server must be deployed with:

- Worker name: `board-game-server`
- exported Durable Object class: `GameRoom`
- its game registry methods (`listRegisteredGameIds`, `getGameState`, `unregisterGameId`)
- public WebSocket route: `/ws?gameId=...&playerId=...`

This repository already binds to it using:

```jsonc
{
  "name": "GAME_ROOM",
  "class_name": "GameRoom",
  "script_name": "board-game-server"
}
```

The public game server URL is configured in `wrangler.jsonc`:

```jsonc
"GAME_SERVER_URL": "https://board-game-server.g-saikirangoud99740.workers.dev"
```

Then run:

```bash
npm install
npm run typecheck
npm run deploy
```

After deploy, set the Unity `matchmakingUrl` field to the deployed `cross-rummy-matchmaking` Worker URL.

## Production notes

- `CORS_ORIGIN` is currently `*` so the Unity WebGL client can call matchmaking during development. Before production, set it to the actual game/site origin if possible.
- `playerId` is currently trusted from the client. Add your PlayFab/auth token validation before launch so one user cannot resume, queue, or cancel as another player.
- The current reconnect lookup scans registered games. That is fine for the present scale, but if active concurrent games grow significantly, replace it with a dedicated `playerId -> gameId` index in a registry Durable Object so reconnect lookup stays O(1).
- The current matchmaker uses one global Durable Object, which is a good simple starting point. If concurrency becomes very large, shard queues by `(gameType, playerCount, region)` while keeping the same public API.

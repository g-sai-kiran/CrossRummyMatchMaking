# CrossRummyMatchMaking

Cloudflare Worker + Durable Object matchmaking service for Cross Rummy.

## Responsibility

This repo owns:

- matchmaking queue
- matching players by `gameType` and `playerCount`
- creating GameRoom Durable Objects in `board-game-server`
- storing active-match indexes in D1
- serving the `GET /matches?playerId=...` API

This repo does **not** own gameplay rules, scoring, turn progression, match completion, or PlayFab rank updates. Those belong to `CrossRummyBackend`.

## Architecture

```text
Unity
  |
  | POST /matchmake
  v
CrossRummyMatchMaking
  |
  | remote Durable Object RPC
  v
board-game-server / GameRoom
  |
  +--> authoritative gameplay state
  +--> updates D1 turn + score snapshots
  +--> removes D1 row when game finishes
  +--> updates PlayFab rank/results

Unity
  |
  | GET /matches?playerId=...
  v
CrossRummyMatchMaking
  |
  v
D1 active-match snapshot
```

## Matchmaking flow

Client request:

```json
{
  "playerId": "PLAYFAB_ID",
  "gameType": 0,
  "playerCount": 2
}
```

- `gameType = 0` -> Live
- `gameType = 1` -> Persistent
- `playerCount = 2..4`

Players are matched only when `gameType` and `playerCount` are the same.

A player may have multiple active games, but only one active matchmaking ticket at a time.

Queued tickets expire after 30 seconds unless the client keeps polling.

When enough players are available:

1. Tickets are reserved.
2. A new `gameId` is created.
3. Matchmaking calls `GameRoom.createGame(...)`.
4. Remaining players are added using `GameRoom.addPlayer(...)`.
5. Initial match/player rows are inserted into D1.
6. Matchmaking calls `GameRoom.syncMatchSnapshot()` so D1 immediately gets the authoritative first turn and scores.
7. Queue tickets are removed.
8. A temporary matched result is kept for 10 minutes for polling clients.

If creation fails, the partial D1 row and GameRoom are cleaned up and players are returned to the queue.

## D1 active-match data

Database:

```text
cross-rummy-matches
```

### active_matches

```text
game_id
game_type
status
player_count
current_turn_seat
turn_ends_at
matched_at
updated_at
```

### active_match_players

```text
game_id
player_id
seat
score
```

Matchmaking creates the initial rows. The game server updates turn and score information while the match is running.

The GameRoom Durable Object is still the source of truth. D1 is the searchable summary used by menus and reconnect UI.

## API

### Start or join matchmaking

```http
POST /matchmake
```

Queued:

```json
{
  "ticketId": "ticket-id",
  "status": "queued",
  "pollAfterMs": 1000
}
```

Matched:

```json
{
  "ticketId": "ticket-id",
  "status": "matched",
  "gameId": "game-id",
  "players": ["player-a", "player-b"],
  "websocketUrl": "wss://board-game-server.../ws?gameId=game-id&playerId=player-a"
}
```

### Poll queued ticket

```http
GET /matchmake/status?ticketId=<ticketId>
```

### Cancel queued ticket

```http
DELETE /matchmake?ticketId=<ticketId>&playerId=<playerId>
```

### Get player's active matches

```http
GET /matches?playerId=<PLAYFAB_ID>
```

This now reads from D1 instead of querying every GameRoom.

Example fields returned per match:

```text
gameId
gameType
status
playerCount
players[id, seat, score]
currentTurnSeat
turnEndsAt
isYourTurn
matchedAt
updatedAt
websocketUrl
```

### Health

```http
GET /health
```

## Cloudflare bindings

```text
MATCHMAKER -> local Matchmaker Durable Object
GAME_ROOM  -> remote GameRoom Durable Object in board-game-server
MATCH_DB   -> D1 database cross-rummy-matches
```

## Migrations

Current migrations:

```text
0001_active_matches.sql
0002_match_snapshots.sql
```

Apply migrations before deploying code that expects the new columns:

```bash
npx wrangler d1 migrations apply cross-rummy-matches --remote
```

If migration `0002` is missing, match creation can fail when inserting the D1 row and players will be requeued.

## Deploy order

When GameRoom RPCs or D1 schema changes:

```text
1. Apply D1 migrations
2. Deploy CrossRummyBackend / board-game-server
3. Deploy CrossRummyMatchMaking
```

Then deploy matchmaking:

```bash
npm install
npm run typecheck
npx wrangler deploy
```

## Unity flow

```text
PlayFab login
  -> PlayFabId
  -> POST /matchmake
  -> queued: poll status
  -> matched: connect using returned websocketUrl
```

For My Matches:

```text
GET /matches?playerId=<PlayFabId>
```

Use the returned `websocketUrl` directly in Unity.

## Scaling notes

- D1 handles the active-match index and removes the need to scan every GameRoom.
- The queue itself still uses one global Matchmaker Durable Object.
- If queue traffic becomes large, shard matchmaking by game type, player count, region, or rank bucket.
- Player identity should eventually be validated server-side instead of trusting the client-supplied ID.

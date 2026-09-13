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

### Active-match example

```text
active_matches
------------------------------------------------------------
game-123 | gameType 1 | Playing | players 2 | turn seat 1
```

```text
active_match_players
------------------------------------------------------------
game-123 | PLAYFAB_A | seat 0 | score 35
game-123 | PLAYFAB_B | seat 1 | score 48
```

For `PLAYFAB_A`, `/matches` can return:

```json
{
  "gameId": "game-123",
  "gameType": 1,
  "status": 1,
  "playerCount": 2,
  "currentTurnSeat": 1,
  "isYourTurn": false,
  "players": [
    { "id": "PLAYFAB_A", "seat": 0, "score": 35 },
    { "id": "PLAYFAB_B", "seat": 1, "score": 48 }
  ]
}
```

## Rank ownership

Matchmaking does not calculate rank.

When the GameRoom finishes, `CrossRummyBackend` updates PlayFab using these rules:

```text
Unique winner: RankRating +30, Wins +1, MatchesPlayed +1
Loser:        RankRating -30, Losses +1, MatchesPlayed +1
Draw:         RankRating unchanged, MatchesPlayed +1
```

Example:

```text
Final score
PLAYFAB_A = 84
PLAYFAB_B = 61

Result
PLAYFAB_A -> +30 rating, +1 win, +1 match
PLAYFAB_B -> -30 rating, +1 loss, +1 match
```

See the `CrossRummyBackend` README for the full 2-player, 4-player, and draw examples.

## Match history

Important distinction:

```text
active_matches = games still in progress
match history  = completed games
```

Completed match history is **not implemented yet**.

Currently, when a match finishes, the game server removes its rows from `active_matches` and `active_match_players`. Therefore `/matches` is an active-games API, not a completed-history API.

Recommended future D1 schema:

```text
match_history
------------------------------------------------------------
game_id
game_type
started_at
finished_at
winner_player_id
is_draw
player_count

match_history_players
------------------------------------------------------------
game_id
player_id
seat
final_score
result
rank_delta
```

Example completed match:

```json
{
  "gameId": "game-123",
  "gameType": 0,
  "winnerPlayerId": "PLAYFAB_A",
  "isDraw": false,
  "players": [
    {
      "playerId": "PLAYFAB_A",
      "seat": 0,
      "finalScore": 84,
      "result": "win",
      "rankDelta": 30
    },
    {
      "playerId": "PLAYFAB_B",
      "seat": 1,
      "finalScore": 61,
      "result": "loss",
      "rankDelta": -30
    }
  ]
}
```

A future API could be:

```http
GET /match-history?playerId=<PLAYFAB_ID>
```

That should query permanent history tables, not the active-match tables.

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

This reads from D1 instead of querying every GameRoom.

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

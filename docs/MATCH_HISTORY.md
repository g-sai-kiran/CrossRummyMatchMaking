# Match History

Completed Cross Rummy matches are stored permanently in the shared D1 database `cross-rummy-matches`.

## Ownership

- `CrossRummyBackend` decides when a game is finished and writes the final authoritative state.
- `CrossRummyMatchMaking` owns the D1 migration and exposes the history read API.
- The GameRoom Durable Object is not queried when reading history, so opening the history screen does not wake old rooms.

## Storage flow

```text
Match created
  -> active_matches + active_match_players

Game running
  -> GameRoom updates active D1 snapshot

GameState becomes Finished
  -> GameRoom builds final board preview
  -> inserts match_history
  -> inserts match_history_players using authoritative final scores
  -> deletes active_match_players
  -> deletes active_matches
```

The archive is keyed by `game_id`. Retrying the finish path does not create duplicate history rows.

## D1 tables

### match_history

```text
game_id        TEXT primary key
game_type      INTEGER
status         INTEGER
player_count   INTEGER
matched_at     INTEGER (Unix milliseconds)
finished_at    INTEGER (Unix milliseconds)
board_preview  TEXT JSON
```

### match_history_players

```text
game_id    TEXT
player_id  TEXT
seat       INTEGER
score      INTEGER
```

The final board preview uses the same compact shape as the active-match preview:

```json
{
  "width": 15,
  "height": 9,
  "revision": 42,
  "coins": [
    {
      "x": 7,
      "y": 4,
      "type": 0,
      "color": 2,
      "number": 5,
      "ownerSeat": 0
    }
  ]
}
```

This is a final-state snapshot, not a move-by-move replay log.

## API

```http
GET /match-history?playerId=<PLAYFAB_ID>&limit=50
```

`playerId` is required.

`limit` is optional, defaults to `50`, and must be between `1` and `100`.

Example:

```bash
curl "https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/match-history?playerId=PLAYFAB_ID&limit=20"
```

Response:

```json
{
  "playerId": "PLAYFAB_ID",
  "count": 1,
  "matches": [
    {
      "gameId": "game-123",
      "gameType": 0,
      "status": 2,
      "playerCount": 2,
      "matchedAt": 1789580000000,
      "finishedAt": 1789581200000,
      "boardPreview": {
        "width": 15,
        "height": 9,
        "revision": 42,
        "coins": []
      },
      "players": [
        { "id": "PLAYFAB_A", "seat": 0, "score": 84 },
        { "id": "PLAYFAB_B", "seat": 1, "score": 61 }
      ]
    }
  ]
}
```

Matches are returned newest first by `finishedAt`.

## Deployment

Apply the D1 migration before deploying either Worker:

```bash
npx wrangler d1 migrations apply cross-rummy-matches --remote
```

Migration added by this feature:

```text
0004_match_history.sql
```

Recommended order:

```text
1. Apply D1 migration 0004
2. Deploy CrossRummyBackend / board-game-server
3. Deploy CrossRummyMatchMaking
```

## Unity usage

Use the PlayFab player ID already used for matchmaking:

```text
GET /match-history?playerId=<PlayFabId>
```

The response is menu data only. There is no WebSocket URL because completed matches cannot be resumed.

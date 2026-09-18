# Match History

Completed Cross Rummy matches are stored in the shared D1 database `cross-rummy-matches`.

## Ownership

- `CrossRummyBackend` decides when a game is finished and writes the final authoritative state.
- `CrossRummyMatchMaking` owns the D1 migrations and exposes the history read API.
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
  -> inserts per-player match_history_access rows
  -> deletes active_match_players
  -> deletes active_matches
  -> prunes each player's history to their newest 500 matches
  -> deletes shared match data only when no player still retains that match
```

The archive is keyed by `game_id`. Retrying the finish path does not create duplicate history rows.

## Retention

Each player keeps at most **500 completed matches**.

When a player's 501st completed match is archived, their oldest `match_history_access` row is deleted automatically.

A multiplayer match is shared by all participants. Removing it from one player's retained 500 must not remove it from another player's history, so the full `match_history` and `match_history_players` rows are deleted only when no `match_history_access` row references that game anymore.

This keeps storage bounded per player without corrupting another participant's history.

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

### match_history_access

```text
game_id      TEXT
player_id    TEXT
finished_at  INTEGER
```

Primary key:

```text
(player_id, game_id)
```

This table is the per-player retained-history index and is ordered by `finished_at DESC, game_id DESC`.

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

The storage layer supports cursor-based pagination using `finishedAt + gameId`, allowing older batches to be loaded without large SQL offsets.

Example:

```bash
curl "https://cross-rummy-matchmaking.g-saikirangoud99740.workers.dev/match-history?playerId=PLAYFAB_ID&limit=20"
```

Matches are returned newest first.

## Deployment

Apply all D1 migrations before deploying either Worker:

```bash
npx wrangler d1 migrations apply cross-rummy-matches --remote
```

Migrations added by this feature:

```text
0004_match_history.sql
0005_match_history_retention.sql
```

`0005_match_history_retention.sql` also backfills `match_history_access` for existing history rows and immediately trims any player already above 500 retained matches.

Recommended order:

```text
1. Apply D1 migrations 0004 and 0005
2. Deploy CrossRummyBackend / board-game-server
3. Deploy CrossRummyMatchMaking
```

## Unity usage

Use the PlayFab player ID already used for matchmaking:

```text
GET /match-history?playerId=<PlayFabId>
```

Load small batches for the UI rather than requesting the entire retained history. The response is menu data only; completed matches cannot be resumed.

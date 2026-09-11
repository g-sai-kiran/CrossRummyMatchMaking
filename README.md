# CrossRummyMatchMaking

Cloudflare Worker + Durable Object matchmaking service for Cross Rummy.

## What it does

The client sends:

- `playerId`
- `gameType` (`0 = Live`, `1 = Persistent`)
- `playerCount` (`2` to `4`)

Players are matched only with other queued players that requested the **same `gameType` and the same `playerCount`**.

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

### 1. Join matchmaking

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

If the player is waiting, the Worker returns HTTP `202`:

```json
{
  "ticketId": "8c7b...",
  "status": "queued",
  "pollAfterMs": 1000
}
```

If this request completes a match, the Worker returns HTTP `200`:

```json
{
  "ticketId": "8c7b...",
  "status": "matched",
  "gameId": "1d21...",
  "players": ["player-123", "player-456"],
  "websocketUrl": "wss://board-game-server.g-saikirangoud99740.workers.dev/ws?gameId=1d21...&playerId=player-123"
}
```

Calling `POST /matchmake` again for the same player and the same settings reuses the current ticket instead of creating duplicate queue entries.

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

If the client stops polling for 30 seconds while still queued, the ticket expires. A later status request returns `404` and the client should create a new matchmaking request.

After a match is created, the queue ticket itself is already removed. The status endpoint reads the temporary delivery record, which expires automatically after 10 minutes.

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

## Unity client example

This sample uses `UnityWebRequest`, so the matchmaking HTTP calls work in Editor, standalone builds, mobile, and WebGL. After `status == "matched"`, pass the returned `websocketUrl` to your NativeWebSocket connection code.

```csharp
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public enum GameType
{
    Live = 0,
    Persistent = 1
}

[Serializable]
public class MatchmakeRequest
{
    public string playerId;
    public GameType gameType;
    public int playerCount;
}

[Serializable]
public class MatchmakeResponse
{
    public string ticketId;
    public string status;
    public int pollAfterMs;
    public string gameId;
    public string[] players;
    public string websocketUrl;
}

public class MatchmakingClient : MonoBehaviour
{
    [SerializeField]
    private string matchmakingUrl =
        "https://cross-rummy-matchmaking.<your-workers-subdomain>.workers.dev";

    private Coroutine pollingRoutine;
    private string currentTicketId;
    private string currentPlayerId;

    public void FindMatch(
        string playerId,
        GameType gameType,
        int playerCount)
    {
        CancelLocalPolling();
        currentPlayerId = playerId;
        StartCoroutine(CreateTicket(playerId, gameType, playerCount));
    }

    public void CancelMatchmaking()
    {
        if (string.IsNullOrEmpty(currentTicketId))
        {
            CancelLocalPolling();
            return;
        }

        StartCoroutine(CancelTicket(currentTicketId, currentPlayerId));
    }

    private IEnumerator CreateTicket(
        string playerId,
        GameType gameType,
        int playerCount)
    {
        var payload = new MatchmakeRequest
        {
            playerId = playerId,
            gameType = gameType,
            playerCount = playerCount
        };

        string json = JsonUtility.ToJson(payload);
        using var request = new UnityWebRequest(
            $"{matchmakingUrl}/matchmake",
            UnityWebRequest.kHttpVerbPOST);

        request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError($"Matchmaking failed: {request.responseCode} {request.downloadHandler.text}");
            yield break;
        }

        var response = JsonUtility.FromJson<MatchmakeResponse>(
            request.downloadHandler.text);

        currentTicketId = response.ticketId;
        HandleResponse(response);
    }

    private void HandleResponse(MatchmakeResponse response)
    {
        if (response.status == "matched")
        {
            CancelLocalPolling();
            currentTicketId = null;

            Debug.Log($"Match found: {response.gameId}");
            Debug.Log($"Connect to: {response.websocketUrl}");

            // Example:
            // NexusSeven.Interface
            //     .GetSystem<GameSocketClient>()
            //     .Connect(response.websocketUrl);

            return;
        }

        if (response.status == "queued" && pollingRoutine == null)
        {
            float pollSeconds = Mathf.Max(0.5f, response.pollAfterMs / 1000f);
            pollingRoutine = StartCoroutine(PollTicket(pollSeconds));
        }
    }

    private IEnumerator PollTicket(float pollSeconds)
    {
        while (!string.IsNullOrEmpty(currentTicketId))
        {
            yield return new WaitForSecondsRealtime(pollSeconds);

            string url =
                $"{matchmakingUrl}/matchmake/status?ticketId={UnityWebRequest.EscapeURL(currentTicketId)}";

            using var request = UnityWebRequest.Get(url);
            yield return request.SendWebRequest();

            if (request.responseCode == 404)
            {
                // The queued ticket lease expired. Stop polling and create a
                // fresh matchmaking request if the user is still searching.
                currentTicketId = null;
                pollingRoutine = null;
                yield break;
            }

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"Match status failed: {request.responseCode} {request.downloadHandler.text}");
                continue;
            }

            var response = JsonUtility.FromJson<MatchmakeResponse>(
                request.downloadHandler.text);

            if (response.status == "matched")
            {
                pollingRoutine = null;
                HandleResponse(response);
                yield break;
            }

            if (response.pollAfterMs > 0)
            {
                pollSeconds = Mathf.Max(0.5f, response.pollAfterMs / 1000f);
            }
        }

        pollingRoutine = null;
    }

    private IEnumerator CancelTicket(string ticketId, string playerId)
    {
        string url =
            $"{matchmakingUrl}/matchmake" +
            $"?ticketId={UnityWebRequest.EscapeURL(ticketId)}" +
            $"&playerId={UnityWebRequest.EscapeURL(playerId)}";

        using var request = UnityWebRequest.Delete(url);
        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success &&
            request.responseCode != 404)
        {
            Debug.LogWarning($"Cancel matchmaking failed: {request.responseCode} {request.downloadHandler.text}");
        }

        currentTicketId = null;
        CancelLocalPolling();
    }

    private void CancelLocalPolling()
    {
        if (pollingRoutine != null)
        {
            StopCoroutine(pollingRoutine);
            pollingRoutine = null;
        }
    }
}
```

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

To test abandoned-ticket cleanup, queue a player and then stop polling. After more than 30 seconds, `GET /matchmake/status?ticketId=...` should return `404`.

A request with `gameType: 1` or a different `playerCount` must not join that match.

> Local cross-Worker Durable Object RPC requires the `board-game-server` Worker to be available/configured. For the simplest end-to-end check, deploy both Workers and test their `workers.dev` URLs.

## Deploy

The game server must be deployed with:

- Worker name: `board-game-server`
- exported Durable Object class: `GameRoom`
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
- `playerId` is currently trusted from the client. Add your PlayFab/auth token validation before launch so one user cannot queue or cancel as another player.
- The current matchmaker uses one global Durable Object, which is a good simple starting point. If concurrency becomes very large, shard queues by `(gameType, playerCount, region)` while keeping the same public API.

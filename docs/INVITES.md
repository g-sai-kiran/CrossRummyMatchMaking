# Cross Rummy game invites, join codes, and push notifications

Cross Rummy stores invite lobbies in the existing `cross-rummy-matches` D1 database. Direct invites can notify known PlayFab players with Firebase Cloud Messaging, while open invites can be joined using a short code that can later be encoded into a QR/deep link.

D1 is the source of truth. Push notifications are best effort only. While an invite lobby is visible, clients should poll the invite every 2 seconds so Steam, WebGL, Android, and iOS all observe joins reliably.

## Lifecycle

The GameRoom is **not** created when an invite code is generated.

```text
create invite/code
      |
      v
pending lobby in D1 only
      |
players join / accept
      |
last required player arrives
      |
      v
pending -> starting
      |
create GameRoom + active match
      |
      v
started
```

The atomic `pending -> starting` update ensures only one request creates the GameRoom even if multiple players join at nearly the same time. If GameRoom creation fails, the invite returns to `pending` and can be retried safely.

Invite states:

```text
pending -> starting -> started
   |          |
   |          +-> pending  (GameRoom creation failed; safe retry)
   +-> declined
   +-> cancelled
   +-> expired
```

## Data model

Migration `0007_invites_push.sql` adds:

- `game_invites`: one row per invite.
- `game_invite_members`: host/invitees, seat order and response state.
- `player_push_devices`: PlayFab player -> Firebase Installation ID registrations.

Migration `0008_joinable_invites.sql` adds:

- `game_invites.join_code`: optional unique 6-character code for open invites.
- a unique index on `join_code`.
- a unique `(invite_id, seat)` index so concurrent joins cannot claim the same seat.

The host is stored as seat 0 and is already accepted. Open-invite players are added to the next free seat as already accepted.

## Authentication

Invite/device endpoints do not trust a `playerId` supplied by Unity.

Unity sends the current PlayFab session ticket:

```http
Authorization: Bearer <PLAYFAB_SESSION_TICKET>
```

The Worker validates it with PlayFab `Server/AuthenticateSessionTicket` and derives the PlayFab ID from the response.

## Apply database migrations

Before deploying the Worker:

```bash
npx wrangler d1 migrations apply cross-rummy-matches --remote
```

Verify that both `0007_invites_push.sql` and `0008_joinable_invites.sql` are applied.

## Direct invite API

All endpoints require the PlayFab bearer token.

### Create a direct invite

```http
POST /invites
Content-Type: application/json
Authorization: Bearer <session-ticket>

{
  "inviteePlayerIds": ["PLAYFAB_B"],
  "gameType": 0,
  "playerCount": 2,
  "expiresInSeconds": 300
}
```

For 2-4 player matches, `inviteePlayerIds.length` must equal `playerCount - 1`.

### Accept

```http
POST /invites/<inviteId>/accept
Authorization: Bearer <session-ticket>
```

When the last required invitee accepts, the Worker moves the invite to `starting`, creates the GameRoom, inserts the active-match rows, syncs the first authoritative snapshot, and marks the invite `started`.

### Decline

```http
POST /invites/<inviteId>/decline
Authorization: Bearer <session-ticket>
```

### Cancel

```http
POST /invites/<inviteId>/cancel
Authorization: Bearer <session-ticket>
```

Only the host can cancel a pending invite.

## Open invite / join-code API

### Create an open invite

```http
POST /invites/open
Content-Type: application/json
Authorization: Bearer <session-ticket>

{
  "gameType": 0,
  "playerCount": 4,
  "expiresInSeconds": 600
}
```

Example response:

```json
{
  "invite": {
    "inviteId": "9c1c...",
    "hostPlayerId": "PLAYFAB_HOST",
    "playerCount": 4,
    "status": "pending",
    "gameId": null,
    "joinCode": "K7PX4Q",
    "members": [
      {
        "playerId": "PLAYFAB_HOST",
        "seat": 0,
        "role": "host",
        "status": "accepted"
      }
    ]
  },
  "joinCode": "K7PX4Q",
  "pollAfterMs": 2000
}
```

No GameRoom is created at this point. The open lobby exists only as D1 rows.

The join code alphabet intentionally excludes ambiguous characters such as `0`, `1`, `I`, and `O`.

### Join with a code

```http
POST /invites/join/K7PX4Q
Authorization: Bearer <session-ticket>
```

The Worker:

1. authenticates the PlayFab player;
2. validates that the invite is pending and not expired;
3. assigns the next free seat;
4. stores the player as accepted;
5. atomically checks whether accepted members now equal `playerCount`;
6. if full, changes `pending -> starting` and creates the GameRoom.

If the lobby is not full yet:

```json
{
  "invite": {
    "status": "pending",
    "joinCode": "K7PX4Q",
    "members": []
  },
  "pollAfterMs": 2000
}
```

If this join fills the lobby, the response also contains the joining player's WebSocket URL:

```json
{
  "invite": {
    "status": "started",
    "gameId": "..."
  },
  "match": {
    "gameId": "...",
    "players": ["...", "..."],
    "websocketUrl": "wss://..."
  },
  "pollAfterMs": 2000
}
```

A full lobby returns HTTP 409 for an additional player.

## Polling the invite lobby

### Get one invite

```http
GET /invites/<inviteId>
Authorization: Bearer <session-ticket>
```

Only invite members can read it.

When the invite has started, this endpoint also returns the current player's match connection data:

```json
{
  "invite": {
    "status": "started",
    "gameId": "..."
  },
  "match": {
    "gameId": "...",
    "players": ["...", "..."],
    "websocketUrl": "wss://..."
  }
}
```

That makes polling sufficient to enter a match on Steam/WebGL even if no push notification is available.

While the lobby UI is open, poll every **2 seconds**:

```text
Host creates code
      |
GET /invites/<inviteId> every 2 seconds
      |
Player B joins with code
      |
next poll shows Player B
      |
Player C joins
      |
next poll shows Player C
      |
final player joins
      |
invite becomes started
      |
client connects using match/WebSocket information
```

Polling is the cross-platform reliable mechanism. Push is only an optimization.

## Push events

Current events:

```text
game_invite
invite_accepted
invite_declined
invite_cancelled
invite_joined
invite_match_started
```

For `invite_joined`, the host receives:

```json
{
  "type": "invite_joined",
  "inviteId": "...",
  "playerId": "PLAYFAB_B"
}
```

The client should then fetch `GET /invites/<inviteId>` rather than trusting push payload state.

When the match starts, every player can receive:

```text
invite_match_started
inviteId
gameId
player-specific websocketUrl
```

## QR/deep-link flow

The backend does not need a separate QR API. QR generation should happen on the client from a URL containing the code, for example:

```text
https://crossrummy.com/join/K7PX4Q
```

The web/app deep-link handler extracts `K7PX4Q` and calls:

```http
POST /invites/join/K7PX4Q
```

The Worker is deployed when this feature changes. It is **not deployed per generated code**.

## List invites

```http
GET /invites?limit=50
Authorization: Bearer <session-ticket>
```

## Firebase Cloud Messaging setup

Create a Firebase service account that can send Cloud Messaging messages, then configure:

```bash
npx wrangler secret put FCM_PROJECT_ID
npx wrangler secret put FCM_CLIENT_EMAIL
npx wrangler secret put FCM_PRIVATE_KEY
```

If Firebase is not configured, invite creation/joining still succeeds. The invite remains in D1 and polling continues to work.

## Recommended Unity flow

```text
PlayFab login
   |
Host: POST /invites/open
   |
show join code + QR
   |
poll GET /invites/<inviteId> every 2 seconds
   |
other player scans/enters code
   |
POST /invites/join/<code>
   |
lobby fills
   |
Worker creates GameRoom
   |
invite_match_started or polling sees started
   |
connect to websocketUrl
```

For direct invites, continue using `POST /invites` and `POST /invites/<inviteId>/accept`.

## Failure behavior

- Push delivery failure never deletes or rolls back an invite.
- Expired pending invites are marked `expired` when invite APIs are read or mutated.
- If GameRoom creation fails after the lobby fills, the invite returns to `pending`.
- Duplicate join attempts by the same PlayFab player are idempotent.
- A unique seat index prevents two concurrent players from taking the same seat.
- Device registration uses an upsert, so repeated Firebase installation registration does not create duplicates.

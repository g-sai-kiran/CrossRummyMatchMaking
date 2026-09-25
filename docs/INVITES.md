# Cross Rummy game invites and push notifications

Cross Rummy stores game invites in the existing `cross-rummy-matches` D1 database and sends best-effort Firebase Cloud Messaging pushes to registered app installations.

The D1 invite is the source of truth. Push payloads only tell the app that something changed; the client should always fetch the invite again before showing or accepting it.

## Data model

Migration `0007_invites_push.sql` adds:

- `game_invites`: one row per invite.
- `game_invite_members`: host/invitees, seat order and response state.
- `player_push_devices`: PlayFab player -> Firebase Installation ID registrations.

Invite states:

```text
pending -> starting -> started
   |          |
   |          +-> pending  (GameRoom creation failed; safe retry)
   +-> declined
   +-> cancelled
   +-> expired
```

The host is stored as seat 0 and is already accepted. Invitees are seats 1..N.

## Authentication

Invite/device endpoints do not trust a `playerId` supplied by Unity.

Unity sends the current PlayFab session ticket:

```http
Authorization: Bearer <PLAYFAB_SESSION_TICKET>
```

The Worker validates it with PlayFab `Server/AuthenticateSessionTicket` and derives the PlayFab ID from the response.

The existing Cloudflare bindings are used:

```text
CR_TITLEID
CR_PLAYFAB_SECRET
```

## Apply the database migration

```bash
npx wrangler d1 migrations apply cross-rummy-matches --remote
```

Verify that `0007_invites_push.sql` is listed as applied before deploying the Worker.

## Firebase Cloud Messaging setup

Create a Firebase service account that can send Cloud Messaging messages, then add these Worker secrets:

```bash
npx wrangler secret put FCM_PROJECT_ID
npx wrangler secret put FCM_CLIENT_EMAIL
npx wrangler secret put FCM_PRIVATE_KEY
```

For `FCM_PRIVATE_KEY`, paste the service account private key including the BEGIN/END lines. Both literal newlines and escaped `\n` values are accepted by the Worker.

The Worker uses the FCM HTTP v1 API and targets Firebase Installation IDs (FIDs).

If Firebase is not configured, invite creation/acceptance still succeeds. The invite remains in D1 and the Worker logs that the push was skipped.

## API

All endpoints below require the PlayFab bearer token.

### Register a device

```http
POST /devices/register
Content-Type: application/json
Authorization: Bearer <session-ticket>

{
  "installationId": "firebase-installation-id",
  "platform": "android"
}
```

`platform` is `android` or `ios`.

### Unregister a device

```http
DELETE /devices?installationId=<FID>
Authorization: Bearer <session-ticket>
```

### Create an invite

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

### List invites for the current player

```http
GET /invites?limit=50
Authorization: Bearer <session-ticket>
```

### Get one invite

```http
GET /invites/<inviteId>
Authorization: Bearer <session-ticket>
```

The caller must be a member of the invite.

### Accept

```http
POST /invites/<inviteId>/accept
Authorization: Bearer <session-ticket>
```

When the last required invitee accepts, the Worker moves the invite to `starting`, creates a GameRoom, inserts the normal active-match D1 rows, syncs the first authoritative snapshot, and then marks the invite `started`.

The accepting player receives a normal match response when their accept starts the game. Other players receive an `invite_match_started` push containing `inviteId`, `gameId` and their player-specific websocket URL.

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

## Push event payloads

```text
game_invite
invite_accepted
invite_declined
invite_cancelled
invite_match_started
```

Always use `inviteId` to refresh the authoritative state from `GET /invites/<inviteId>`.

## Recommended Unity flow

```text
PlayFab login
   |
   +-> store SessionTicket
   |
Firebase RegistrationReceived
   |
   +-> POST /devices/register
   |
Invite push / foreground message
   |
   +-> GET /invites/<inviteId>
   |
Accept
   |
   +-> POST /invites/<inviteId>/accept
   |
invite_match_started
   |
   +-> connect to websocketUrl
```

## Failure behavior

- Push delivery failure never deletes or rolls back an invite.
- Expired pending invites are marked `expired` when invite APIs are read or mutated.
- If GameRoom creation fails after all players accept, the invite returns to `pending` so acceptance can safely be retried.
- Device registration uses an upsert, so Firebase can report the same FID repeatedly without creating duplicates.

export type InviteStatus =
  | "pending"
  | "starting"
  | "started"
  | "declined"
  | "cancelled"
  | "expired";

export type InviteMemberStatus = "pending" | "accepted" | "declined";

export interface InviteMember {
  playerId: string;
  seat: number;
  role: "host" | "invitee";
  status: InviteMemberStatus;
  respondedAt: number | null;
}

export interface GameInvite {
  inviteId: string;
  hostPlayerId: string;
  gameType: number;
  playerCount: number;
  status: InviteStatus;
  gameId: string | null;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  members: InviteMember[];
}

interface InviteRow {
  invite_id: string;
  host_player_id: string;
  game_type: number;
  player_count: number;
  status: InviteStatus;
  game_id: string | null;
  created_at: number;
  expires_at: number;
  updated_at: number;
}

interface InviteMemberRow {
  player_id: string;
  seat: number;
  role: "host" | "invitee";
  status: InviteMemberStatus;
  responded_at: number | null;
}

export interface CreateInviteInput {
  hostPlayerId: string;
  inviteePlayerIds: string[];
  gameType: number;
  playerCount: number;
  expiresAt: number;
}

export interface InviteResponseResult {
  invite: GameInvite;
  becameReady: boolean;
}

export async function expireOldInvites(
  db: D1Database,
  now = Date.now()
): Promise<void> {
  await db.prepare(
    `UPDATE game_invites
     SET status = 'expired', updated_at = ?
     WHERE status = 'pending' AND expires_at <= ?`
  ).bind(now, now).run();
}

export async function createInvite(
  db: D1Database,
  input: CreateInviteInput
): Promise<GameInvite> {
  const now = Date.now();
  const inviteId = crypto.randomUUID();

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO game_invites (
        invite_id,
        host_player_id,
        game_type,
        player_count,
        status,
        created_at,
        expires_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(
      inviteId,
      input.hostPlayerId,
      input.gameType,
      input.playerCount,
      now,
      input.expiresAt,
      now
    ),
    db.prepare(
      `INSERT INTO game_invite_members (
        invite_id, player_id, seat, role, status, responded_at
      ) VALUES (?, ?, 0, 'host', 'accepted', ?)`
    ).bind(inviteId, input.hostPlayerId, now)
  ];

  input.inviteePlayerIds.forEach((playerId, index) => {
    statements.push(
      db.prepare(
        `INSERT INTO game_invite_members (
          invite_id, player_id, seat, role, status
        ) VALUES (?, ?, ?, 'invitee', 'pending')`
      ).bind(inviteId, playerId, index + 1)
    );
  });

  await db.batch(statements);

  const invite = await getInvite(db, inviteId);
  if (!invite) {
    throw new Error("Invite was created but could not be loaded");
  }
  return invite;
}

export async function getInvite(
  db: D1Database,
  inviteId: string
): Promise<GameInvite | null> {
  await expireOldInvites(db);

  const row = await db.prepare(
    `SELECT
      invite_id,
      host_player_id,
      game_type,
      player_count,
      status,
      game_id,
      created_at,
      expires_at,
      updated_at
     FROM game_invites
     WHERE invite_id = ?`
  ).bind(inviteId).first<InviteRow>();

  if (!row) {
    return null;
  }

  const memberRows = await db.prepare(
    `SELECT player_id, seat, role, status, responded_at
     FROM game_invite_members
     WHERE invite_id = ?
     ORDER BY seat ASC`
  ).bind(inviteId).all<InviteMemberRow>();

  return {
    inviteId: row.invite_id,
    hostPlayerId: row.host_player_id,
    gameType: row.game_type,
    playerCount: row.player_count,
    status: row.status,
    gameId: row.game_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    members: memberRows.results.map(member => ({
      playerId: member.player_id,
      seat: member.seat,
      role: member.role,
      status: member.status,
      respondedAt: member.responded_at
    }))
  };
}

export async function listInvitesForPlayer(
  db: D1Database,
  playerId: string,
  limit: number
): Promise<GameInvite[]> {
  await expireOldInvites(db);

  const rows = await db.prepare(
    `SELECT i.invite_id
     FROM game_invites i
     INNER JOIN game_invite_members m
       ON m.invite_id = i.invite_id
     WHERE m.player_id = ?
     ORDER BY i.created_at DESC
     LIMIT ?`
  ).bind(playerId, limit).all<{ invite_id: string }>();

  const invites: GameInvite[] = [];
  for (const row of rows.results) {
    const invite = await getInvite(db, row.invite_id);
    if (invite) {
      invites.push(invite);
    }
  }
  return invites;
}

export async function acceptInvite(
  db: D1Database,
  inviteId: string,
  playerId: string
): Promise<InviteResponseResult | null> {
  const invite = await getInvite(db, inviteId);
  if (!invite) {
    return null;
  }

  const member = invite.members.find(item => item.playerId === playerId);
  if (!member || member.role !== "invitee") {
    return null;
  }

  if (invite.status === "started" || invite.status === "starting") {
    return { invite, becameReady: false };
  }

  if (invite.status !== "pending") {
    return { invite, becameReady: false };
  }

  const now = Date.now();
  if (member.status === "pending") {
    await db.prepare(
      `UPDATE game_invite_members
       SET status = 'accepted', responded_at = ?
       WHERE invite_id = ? AND player_id = ? AND status = 'pending'`
    ).bind(now, inviteId, playerId).run();
  }

  const readyUpdate = await db.prepare(
    `UPDATE game_invites
     SET status = 'starting', updated_at = ?
     WHERE invite_id = ?
       AND status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM game_invite_members
         WHERE invite_id = ?
           AND status <> 'accepted'
       )`
  ).bind(now, inviteId, inviteId).run();

  const refreshed = await getInvite(db, inviteId);
  if (!refreshed) {
    return null;
  }

  return {
    invite: refreshed,
    becameReady: (readyUpdate.meta.changes ?? 0) > 0
  };
}

export async function declineInvite(
  db: D1Database,
  inviteId: string,
  playerId: string
): Promise<GameInvite | null> {
  const invite = await getInvite(db, inviteId);
  if (!invite) {
    return null;
  }

  const member = invite.members.find(item => item.playerId === playerId);
  if (!member || member.role !== "invitee") {
    return null;
  }

  if (invite.status !== "pending") {
    return invite;
  }

  const now = Date.now();
  await db.batch([
    db.prepare(
      `UPDATE game_invite_members
       SET status = 'declined', responded_at = ?
       WHERE invite_id = ? AND player_id = ? AND status = 'pending'`
    ).bind(now, inviteId, playerId),
    db.prepare(
      `UPDATE game_invites
       SET status = 'declined', updated_at = ?
       WHERE invite_id = ? AND status = 'pending'`
    ).bind(now, inviteId)
  ]);

  return getInvite(db, inviteId);
}

export async function cancelInvite(
  db: D1Database,
  inviteId: string,
  hostPlayerId: string
): Promise<GameInvite | null> {
  const invite = await getInvite(db, inviteId);
  if (!invite || invite.hostPlayerId !== hostPlayerId) {
    return null;
  }

  if (invite.status !== "pending") {
    return invite;
  }

  const now = Date.now();
  await db.prepare(
    `UPDATE game_invites
     SET status = 'cancelled', updated_at = ?
     WHERE invite_id = ? AND host_player_id = ? AND status = 'pending'`
  ).bind(now, inviteId, hostPlayerId).run();

  return getInvite(db, inviteId);
}

export async function markInviteStarted(
  db: D1Database,
  inviteId: string,
  gameId: string
): Promise<GameInvite | null> {
  const now = Date.now();
  await db.prepare(
    `UPDATE game_invites
     SET status = 'started', game_id = ?, updated_at = ?
     WHERE invite_id = ? AND status = 'starting'`
  ).bind(gameId, now, inviteId).run();

  return getInvite(db, inviteId);
}

export async function revertInviteStarting(
  db: D1Database,
  inviteId: string
): Promise<void> {
  await db.prepare(
    `UPDATE game_invites
     SET status = 'pending', updated_at = ?
     WHERE invite_id = ? AND status = 'starting'`
  ).bind(Date.now(), inviteId).run();
}

export async function registerPushDevice(
  db: D1Database,
  playerId: string,
  installationId: string,
  platform: string
): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO player_push_devices (
      player_id,
      installation_id,
      platform,
      enabled,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(player_id, installation_id)
    DO UPDATE SET
      platform = excluded.platform,
      enabled = 1,
      updated_at = excluded.updated_at`
  ).bind(playerId, installationId, platform, now, now).run();
}

export async function unregisterPushDevice(
  db: D1Database,
  playerId: string,
  installationId: string
): Promise<void> {
  await db.prepare(
    `UPDATE player_push_devices
     SET enabled = 0, updated_at = ?
     WHERE player_id = ? AND installation_id = ?`
  ).bind(Date.now(), playerId, installationId).run();
}

export async function listPushInstallations(
  db: D1Database,
  playerId: string
): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT installation_id
     FROM player_push_devices
     WHERE player_id = ? AND enabled = 1
     ORDER BY updated_at DESC`
  ).bind(playerId).all<{ installation_id: string }>();

  return rows.results.map(row => row.installation_id);
}

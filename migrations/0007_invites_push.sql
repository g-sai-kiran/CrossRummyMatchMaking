CREATE TABLE IF NOT EXISTS game_invites (
  invite_id TEXT PRIMARY KEY,
  host_player_id TEXT NOT NULL,
  game_type INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  game_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_invite_members (
  invite_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  responded_at INTEGER,
  PRIMARY KEY (invite_id, player_id),
  FOREIGN KEY (invite_id) REFERENCES game_invites(invite_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_invite_members_player
  ON game_invite_members(player_id, status);

CREATE INDEX IF NOT EXISTS idx_game_invites_host
  ON game_invites(host_player_id, status);

CREATE INDEX IF NOT EXISTS idx_game_invites_expiry
  ON game_invites(status, expires_at);

CREATE TABLE IF NOT EXISTS player_push_devices (
  player_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_player_push_devices_player
  ON player_push_devices(player_id, enabled);

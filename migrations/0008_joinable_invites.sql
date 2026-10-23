ALTER TABLE game_invites ADD COLUMN join_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_invites_join_code
  ON game_invites(join_code)
  WHERE join_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_invite_members_seat
  ON game_invite_members(invite_id, seat);

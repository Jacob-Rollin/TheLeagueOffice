-- TiDB Serverless schema for The League Office (league-office-native).
-- MySQL-compatible DDL. Run once against DATABASE_URL.
-- Supabase A retains auth, profiles, and native league ops.

CREATE TABLE IF NOT EXISTS player_warehouse (
  sleeper_id VARCHAR(32) NOT NULL,
  player_name VARCHAR(128) NULL,
  position VARCHAR(8) NULL,
  team VARCHAR(8) NULL,
  fantasycalc_value DECIMAL(12, 2) NULL,
  leaguelogs_status VARCHAR(64) NULL,
  injury_type VARCHAR(64) NULL,
  injury_notes TEXT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sleeper_id),
  INDEX idx_pw_position (position),
  INDEX idx_pw_player_name (player_name),
  INDEX idx_pw_team (team),
  INDEX idx_pw_pos_name (position, player_name)
);

-- Analytics copy of synced host leagues (ownership still gated via Supabase Auth).
CREATE TABLE IF NOT EXISTS synced_leagues (
  league_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  platform ENUM('sleeper', 'espn') NOT NULL,
  name VARCHAR(255) NULL,
  total_teams INT NULL,
  total_rounds INT NULL,
  playoff_start_week INT NULL,
  scoring_settings JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id),
  INDEX idx_sl_user_id (user_id),
  INDEX idx_sl_platform (platform)
);

CREATE TABLE IF NOT EXISTS synced_rosters (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id VARCHAR(64) NOT NULL,
  team_id INT NOT NULL,
  owner_name VARCHAR(255) NULL,
  players JSON NULL,
  starters JSON NULL,
  bench JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_league_team (league_id, team_id),
  INDEX idx_sr_league_id (league_id)
);

-- Aligned with supabase weekly_matchups so league-resync can retarget without feature loss.
CREATE TABLE IF NOT EXISTS synced_matchups (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NULL,
  platform VARCHAR(16) NOT NULL DEFAULT 'espn',
  week INT NOT NULL,
  team_id INT NOT NULL,
  matchup_id INT NULL,
  roster_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  projected_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  opponent_team_id INT NULL,
  team_name VARCHAR(255) NULL,
  owner_name VARCHAR(255) NULL,
  starters JSON NULL,
  player_points JSON NULL,
  synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_league_week_team (league_id, week, team_id),
  INDEX idx_sm_league_week (league_id, week),
  INDEX idx_sm_league_id (league_id)
);

-- Pre-aggregated research snapshots (written by cron; request path only SELECTs).
-- season may hold composite keys (e.g. redzone "2025:20:d:d").
CREATE TABLE IF NOT EXISTS agg_redzone (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

CREATE TABLE IF NOT EXISTS agg_targets (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

CREATE TABLE IF NOT EXISTS agg_sos (
  season VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

CREATE TABLE IF NOT EXISTS agg_are_they_playing (
  snapshot_key VARCHAR(32) NOT NULL DEFAULT 'latest',
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_key)
);

CREATE TABLE IF NOT EXISTS agg_week_plays_meta (
  season VARCHAR(16) NOT NULL,
  week INT NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season, week)
);

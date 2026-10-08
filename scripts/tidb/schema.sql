-- TiDB Serverless schema for The League Office (league-office-native).
-- MySQL-compatible DDL. Run once against DATABASE_URL (or via /api/admin/tidb-migrate).
-- Supabase A retains auth, profiles, and native_league_links (membership index).
-- Native league ops tables (native_*) live here — see end of this file.

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

CREATE TABLE IF NOT EXISTS agg_fpa (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

CREATE TABLE IF NOT EXISTS agg_matchups_guide (
  season VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

CREATE TABLE IF NOT EXISTS agg_sos_analysis (
  season VARCHAR(64) NOT NULL,
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

CREATE TABLE IF NOT EXISTS agg_fantasy_leaders (
  season VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season)
);

-- ---------------------------------------------------------------------------
-- Native custom fantasy leagues (ops). Auth stays on Supabase A; membership
-- index is native_league_links there. Keep DDL in sync with
-- src/lib/native-league-ddl.server.ts (applied by /api/admin/tidb-migrate).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS native_leagues (
  id CHAR(36) NOT NULL,
  season_year SMALLINT NOT NULL,
  name VARCHAR(128) NOT NULL,
  invite_code VARCHAR(16) NOT NULL,
  join_password_hash VARCHAR(255) NULL,
  commissioner_user_id VARCHAR(36) NOT NULL,
  status ENUM('setup','drafting','in_season','completed') NOT NULL DEFAULT 'setup',
  league_type ENUM('redraft') NOT NULL DEFAULT 'redraft',
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  auto_activate_next_year TINYINT(1) NOT NULL DEFAULT 1,
  season_start_week TINYINT NOT NULL DEFAULT 1,
  team_count TINYINT NOT NULL,
  current_week TINYINT NOT NULL DEFAULT 1,
  playoff_start_week TINYINT NOT NULL DEFAULT 15,
  playoff_teams TINYINT NOT NULL DEFAULT 4,
  playoff_matchup_length ENUM('one','two_all','two_championship') NOT NULL DEFAULT 'one',
  playoff_week_pair VARCHAR(16) NOT NULL DEFAULT '15-17',
  standings_tiebreaker ENUM('points_for','head_to_head','division') NOT NULL DEFAULT 'points_for',
  allow_matchup_ties TINYINT(1) NOT NULL DEFAULT 0,
  matchup_tiebreaker_slot VARCHAR(8) NOT NULL DEFAULT 'Bench',
  divisions_enabled TINYINT(1) NOT NULL DEFAULT 0,
  divisions JSON NULL,
  roster_slots JSON NOT NULL,
  scoring_preset VARCHAR(16) NOT NULL DEFAULT 'half',
  scoring_settings JSON NOT NULL,
  waiver_type ENUM('rolling','reverse','faab') NOT NULL DEFAULT 'rolling',
  waiver_budget INT NULL,
  waiver_period_days TINYINT NOT NULL DEFAULT 1,
  waiver_clear_hours INT NULL,
  waiver_process_weekday TINYINT NOT NULL DEFAULT 3,
  waiver_process_time CHAR(5) NOT NULL DEFAULT '10:00',
  post_draft_player_status ENUM('free_agents','follow_waiver_rules') NOT NULL DEFAULT 'free_agents',
  lock_fa_on_gametime TINYINT(1) NOT NULL DEFAULT 1,
  max_adds_per_week INT NULL,
  max_adds_per_season INT NULL,
  undroppable_top_players TINYINT(1) NOT NULL DEFAULT 0,
  roster_lock_type ENUM('game_time','first_game') NOT NULL DEFAULT 'game_time',
  league_tz VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  trade_deadline_week TINYINT NULL,
  trade_deadline_at DATETIME NULL,
  trade_review_hours INT NOT NULL DEFAULT 24,
  trade_veto_mode ENUM('none','commissioner') NOT NULL DEFAULT 'commissioner',
  max_trades_per_season INT NULL,
  draft_mode ENUM('offline','live','auto') NOT NULL DEFAULT 'offline',
  draft_format ENUM('standard','salary_cap') NOT NULL DEFAULT 'standard',
  draft_order_type ENUM('snake','linear') NOT NULL DEFAULT 'snake',
  draft_status ENUM('not_started','scheduled','live','paused','complete') NOT NULL DEFAULT 'not_started',
  draft_scheduled_at DATETIME NULL,
  draft_pick_time_limit_sec INT NOT NULL DEFAULT 90,
  draft_order JSON NULL,
  current_draft_pick INT NOT NULL DEFAULT 0,
  keepers_per_team TINYINT NOT NULL DEFAULT 0,
  keeper_note TEXT NULL,
  settings_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_leagues_invite (invite_code),
  INDEX idx_native_leagues_commish (commissioner_user_id),
  INDEX idx_native_leagues_season (season_year),
  INDEX idx_native_leagues_status (status)
);

CREATE TABLE IF NOT EXISTS native_teams (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NULL,
  team_name VARCHAR(64) NOT NULL,
  avatar_url VARCHAR(512) NULL,
  division_id VARCHAR(36) NULL,
  draft_slot TINYINT NOT NULL,
  waiver_priority INT NOT NULL DEFAULT 1,
  faab_balance INT NULL,
  adds_this_week INT NOT NULL DEFAULT 0,
  adds_this_season INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_teams_league_slot (league_id, draft_slot),
  UNIQUE KEY uq_native_teams_league_user (league_id, user_id),
  INDEX idx_native_teams_user (user_id),
  INDEX idx_native_teams_league (league_id)
);

CREATE TABLE IF NOT EXISTS native_rosters (
  league_id CHAR(36) NOT NULL,
  team_id BIGINT NOT NULL,
  player_ids JSON NOT NULL,
  reserve_ir JSON NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id, team_id),
  INDEX idx_native_rosters_team (team_id)
);

CREATE TABLE IF NOT EXISTS native_lineups (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  team_id BIGINT NOT NULL,
  season_year SMALLINT NOT NULL,
  week TINYINT NOT NULL,
  slots JSON NOT NULL,
  locked_at DATETIME NULL,
  team_total_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  player_points JSON NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_lineups_week (league_id, team_id, season_year, week),
  INDEX idx_native_lineups_league_week (league_id, season_year, week)
);

CREATE TABLE IF NOT EXISTS native_schedules (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  season_year SMALLINT NOT NULL,
  week TINYINT NOT NULL,
  matchup_id INT NOT NULL,
  home_team_id BIGINT NOT NULL,
  away_team_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_sched_matchup (league_id, season_year, week, matchup_id),
  INDEX idx_native_sched_league_week (league_id, season_year, week),
  INDEX idx_native_sched_home (league_id, home_team_id),
  INDEX idx_native_sched_away (league_id, away_team_id)
);

CREATE TABLE IF NOT EXISTS native_transactions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  team_id BIGINT NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  payload JSON NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (id),
  INDEX idx_native_tx_league_created (league_id, created_at),
  INDEX idx_native_tx_team (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS native_waiver_claims (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  team_id BIGINT NOT NULL,
  player_to_add VARCHAR(32) NOT NULL,
  player_to_drop VARCHAR(32) NULL,
  bid_amount INT NULL,
  priority_at_submit INT NOT NULL DEFAULT 0,
  status ENUM('pending','won','lost','cancelled') NOT NULL DEFAULT 'pending',
  process_batch_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (id),
  INDEX idx_native_claims_pending (league_id, status, created_at),
  INDEX idx_native_claims_team (league_id, team_id, status),
  INDEX idx_native_claims_player (league_id, player_to_add, status)
);

CREATE TABLE IF NOT EXISTS native_player_locks (
  league_id CHAR(36) NOT NULL,
  player_id VARCHAR(32) NOT NULL,
  held_by_team_id BIGINT NULL,
  lock_reason ENUM('roster','pending_fa','trade_hold') NOT NULL DEFAULT 'roster',
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id, player_id),
  INDEX idx_native_locks_team (league_id, held_by_team_id)
);

CREATE TABLE IF NOT EXISTS native_trades (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  proposer_team_id BIGINT NOT NULL,
  acceptor_team_id BIGINT NOT NULL,
  status ENUM('proposed','accepted','veto_window','completed','rejected','cancelled','vetoed') NOT NULL DEFAULT 'proposed',
  legs JSON NOT NULL,
  proposed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  respond_by DATETIME NULL,
  veto_until DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  INDEX idx_native_trades_league_status (league_id, status),
  INDEX idx_native_trades_proposer (league_id, proposer_team_id),
  INDEX idx_native_trades_acceptor (league_id, acceptor_team_id)
);

CREATE TABLE IF NOT EXISTS native_draft_picks (
  league_id CHAR(36) NOT NULL,
  pick_number INT NOT NULL,
  round TINYINT NOT NULL,
  team_id BIGINT NOT NULL,
  player_id VARCHAR(32) NULL,
  picked_at DATETIME NULL,
  source ENUM('manager','autopick','commissioner') NULL,
  PRIMARY KEY (league_id, pick_number),
  UNIQUE KEY uq_native_draft_player (league_id, player_id),
  INDEX idx_native_draft_team (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS native_draft_queues (
  league_id CHAR(36) NOT NULL,
  team_id BIGINT NOT NULL,
  player_id VARCHAR(32) NOT NULL,
  queue_rank INT NOT NULL,
  PRIMARY KEY (league_id, team_id, player_id),
  INDEX idx_native_queue_order (league_id, team_id, queue_rank)
);

CREATE TABLE IF NOT EXISTS native_matchup_results (
  id BIGINT NOT NULL AUTO_INCREMENT,
  league_id CHAR(36) NOT NULL,
  season_year SMALLINT NOT NULL,
  week TINYINT NOT NULL,
  team_id BIGINT NOT NULL,
  matchup_id INT NULL,
  points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  projected_points DECIMAL(8, 2) NOT NULL DEFAULT 0,
  opponent_team_id BIGINT NULL,
  starters JSON NULL,
  player_points JSON NULL,
  finalized_at DATETIME NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_matchup_team_week (league_id, season_year, week, team_id),
  INDEX idx_native_matchup_league_week (league_id, season_year, week)
);

CREATE TABLE IF NOT EXISTS native_season_standings_snap (
  league_id CHAR(36) NOT NULL,
  season_year SMALLINT NOT NULL,
  as_of_week TINYINT NOT NULL,
  standings JSON NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id, season_year, as_of_week)
);

CREATE TABLE IF NOT EXISTS native_season_archive (
  league_id CHAR(36) NOT NULL,
  season_year SMALLINT NOT NULL,
  champion_team_id BIGINT NULL,
  final_standings JSON NOT NULL,
  awards JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (league_id, season_year)
);

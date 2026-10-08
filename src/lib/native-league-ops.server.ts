/**
 * Server-only native league create / join / admin mutations (TiDB + Supabase links).
 */
import { randomUUID } from "node:crypto";

import {
  defaultNativeScoringSettings,
  generateNativeInviteCode,
  NATIVE_MAX_COMMISSIONER_LEAGUES,
  normalizeNativeLeagueSettings,
  type NativeDraftMode,
  type NativeLeagueSettingsInput,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";
import { NATIVE_LEAGUE_TABLE_NAMES } from "@/lib/native-league-ddl.server";
import {
  buildNativeRoundRobinSchedule,
  countDraftableRosterSpots,
} from "@/lib/native-league-schedule";
import { getNativeLeagueByInviteCode, countCommissionerNativeLeagues } from "@/lib/native-league.server";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

/** Child tables first; `native_leagues` last. No FKs in DDL, but keep a stable order. */
const NATIVE_LEAGUE_DELETE_TABLES = [
  ...NATIVE_LEAGUE_TABLE_NAMES.filter((name) => name !== "native_leagues"),
  "native_leagues",
] as const;

export type NativeLeagueMutationResult =
  | {
      ok: true;
      linkId: string;
      leagueId: string;
      inviteCode: string;
      teamId: number;
      role: "commissioner" | "member";
      name: string;
    }
  | { ok: false; error: string };

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateNativeInviteCode(8);
    const existing = await getNativeLeagueByInviteCode(code);
    if (!existing) return code;
  }
  throw new Error("Could not allocate an invite code");
}

async function insertMembershipLink(input: {
  userId: string;
  leagueId: string;
  teamId: number;
  role: "commissioner" | "co_commish" | "member";
  seasonYear: number;
  label: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("native_league_links")
    .insert({
      user_id: input.userId,
      native_league_id: input.leagueId,
      team_id: input.teamId,
      role: input.role,
      season_year: input.seasonYear,
      label: input.label,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function createNativeLeagueForUser(
  userId: string,
  raw: NativeLeagueSettingsInput & { teamName?: string },
): Promise<NativeLeagueMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "Not signed in" };

  const normalized = normalizeNativeLeagueSettings(raw);
  if (!normalized.ok) {
    return { ok: false, error: normalized.issues.map((i) => i.message).join("; ") };
  }
  const settings = normalized.value;

  const owned = await countCommissionerNativeLeagues(uid);
  if (owned >= NATIVE_MAX_COMMISSIONER_LEAGUES) {
    return {
      ok: false,
      error: `You can commissioner at most ${NATIVE_MAX_COMMISSIONER_LEAGUES} native leagues`,
    };
  }

  const leagueId = randomUUID();
  const inviteCode = await uniqueInviteCode();
  const teamName = String(raw.teamName ?? "Team 1").trim().slice(0, 64) || "Team 1";
  const draftMode = settings.draftMode === "live" ? "live" : "offline";

  try {
    await tidbExecute(
      `INSERT INTO native_leagues (
        id, season_year, name, invite_code, commissioner_user_id, status, league_type,
        is_public, auto_activate_next_year, season_start_week, team_count, current_week,
        playoff_start_week, playoff_teams, playoff_matchup_length, playoff_week_pair,
        standings_tiebreaker, allow_matchup_ties, matchup_tiebreaker_slot,
        divisions_enabled, divisions, roster_slots, scoring_preset, scoring_settings,
        waiver_type, waiver_budget, waiver_period_days, post_draft_player_status,
        lock_fa_on_gametime, max_adds_per_week, max_adds_per_season, undroppable_top_players,
        roster_lock_type, league_tz, trade_deadline_week, trade_review_hours, trade_veto_mode,
        max_trades_per_season, draft_mode, draft_format, draft_order_type, draft_status,
        draft_pick_time_limit_sec, keepers_per_team, keeper_note, settings_version
      ) VALUES (
        ?, ?, ?, ?, ?, 'setup', 'redraft',
        ?, ?, ?, ?, 1,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, NULL, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'not_started',
        ?, ?, ?, 1
      )`,
      [
        leagueId,
        settings.seasonYear,
        settings.name,
        inviteCode,
        uid,
        settings.isPublic ? 1 : 0,
        settings.autoActivateNextYear ? 1 : 0,
        settings.seasonStartWeek,
        settings.teamCount,
        settings.playoffStartWeek,
        settings.playoffTeams,
        settings.playoffMatchupLength,
        settings.playoffWeekPair,
        settings.standingsTiebreaker,
        settings.allowMatchupTies ? 1 : 0,
        settings.matchupTiebreakerSlot,
        settings.divisionsEnabled ? 1 : 0,
        jsonText(settings.rosterSlots),
        settings.scoringPreset,
        jsonText(settings.scoringSettings),
        settings.waiverType,
        settings.waiverBudget,
        settings.waiverPeriodDays,
        settings.postDraftPlayerStatus,
        settings.lockFaOnGametime ? 1 : 0,
        settings.maxAddsPerWeek,
        settings.maxAddsPerSeason,
        settings.undroppableTopPlayers ? 1 : 0,
        settings.rosterLockType,
        settings.leagueTz,
        settings.tradeDeadlineWeek,
        settings.tradeReviewHours,
        settings.tradeVetoMode,
        settings.maxTradesPerSeason,
        draftMode,
        settings.draftFormat,
        settings.draftOrderType,
        settings.draftPickTimeLimitSec,
        settings.keepersPerTeam,
        settings.keeperNote,
      ],
    );

    let commissionerTeamId: number | null = null;
    for (let slot = 1; slot <= settings.teamCount; slot++) {
      const isCommish = slot === 1;
      await tidbExecute(
        `INSERT INTO native_teams (
          league_id, user_id, team_name, draft_slot, waiver_priority, faab_balance
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          leagueId,
          isCommish ? uid : null,
          isCommish ? teamName : `Team ${slot}`,
          slot,
          slot,
          settings.waiverType === "faab" ? settings.waiverBudget : null,
        ],
      );
      const teamRows = await tidbExecute<{ id: number }>(
        `SELECT id FROM native_teams WHERE league_id = ? AND draft_slot = ? LIMIT 1`,
        [leagueId, slot],
      );
      const teamId = Number(teamRows[0]?.id ?? 0);
      if (!teamId) throw new Error("Failed to create team seats");
      if (isCommish) commissionerTeamId = teamId;
      await tidbExecute(
        `INSERT INTO native_rosters (league_id, team_id, player_ids, reserve_ir, version)
         VALUES (?, ?, ?, NULL, 1)`,
        [leagueId, teamId, jsonText([])],
      );
    }

    if (!commissionerTeamId) throw new Error("Commissioner seat missing");

    const linkId = await insertMembershipLink({
      userId: uid,
      leagueId,
      teamId: commissionerTeamId,
      role: "commissioner",
      seasonYear: settings.seasonYear,
      label: settings.name,
    });

    return {
      ok: true,
      linkId,
      leagueId,
      inviteCode,
      teamId: commissionerTeamId,
      role: "commissioner",
      name: settings.name,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create league failed";
    // Best-effort cleanup if link insert failed after TiDB writes.
    try {
      await tidbExecute(`DELETE FROM native_rosters WHERE league_id = ?`, [leagueId]);
      await tidbExecute(`DELETE FROM native_teams WHERE league_id = ?`, [leagueId]);
      await tidbExecute(`DELETE FROM native_leagues WHERE id = ?`, [leagueId]);
    } catch {
      /* ignore cleanup errors */
    }
    return { ok: false, error: message };
  }
}

export async function joinNativeLeagueForUser(
  userId: string,
  input: { inviteCode: string; teamName?: string },
): Promise<NativeLeagueMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "Not signed in" };

  const inviteCode = String(input.inviteCode ?? "").trim().toUpperCase();
  if (inviteCode.length < 4) return { ok: false, error: "Enter a valid invite code" };

  const league = await getNativeLeagueByInviteCode(inviteCode);
  if (!league) return { ok: false, error: "No league found for that invite code" };
  if (league.status === "completed") return { ok: false, error: "This league is closed" };

  const already = await tidbExecute<{ id: number }>(
    `SELECT id FROM native_teams WHERE league_id = ? AND user_id = ? LIMIT 1`,
    [league.id, uid],
  );
  if (already[0]) {
    return { ok: false, error: "You are already in this league" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existingLink } = await supabaseAdmin
    .from("native_league_links")
    .select("id")
    .eq("user_id", uid)
    .eq("native_league_id", league.id)
    .maybeSingle();
  if (existingLink?.id) {
    return { ok: false, error: "You are already in this league" };
  }

  const preferredName = String(input.teamName ?? "").trim().slice(0, 64);

  // Claim the lowest open draft slot (serialized by row update).
  await tidbExecute(
    `UPDATE native_teams
     SET user_id = ?,
         team_name = IF(? <> '', ?, team_name)
     WHERE league_id = ? AND user_id IS NULL
     ORDER BY draft_slot ASC
     LIMIT 1`,
    [uid, preferredName, preferredName, league.id],
  );

  const claimed = await tidbExecute<{ id: number; team_name: string; draft_slot: number }>(
    `SELECT id, team_name, draft_slot FROM native_teams WHERE league_id = ? AND user_id = ? LIMIT 1`,
    [league.id, uid],
  );
  const seat = claimed[0];
  if (!seat) {
    return { ok: false, error: "This league is full" };
  }

  try {
    const linkId = await insertMembershipLink({
      userId: uid,
      leagueId: league.id,
      teamId: Number(seat.id),
      role: "member",
      seasonYear: league.season_year,
      label: league.name,
    });

    return {
      ok: true,
      linkId,
      leagueId: league.id,
      inviteCode: league.invite_code,
      teamId: Number(seat.id),
      role: "member",
      name: league.name,
    };
  } catch (error) {
    // Roll back seat claim if link insert fails.
    try {
      await tidbExecute(
        `UPDATE native_teams SET user_id = NULL WHERE id = ? AND user_id = ?`,
        [seat.id, uid],
      );
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : "Join league failed";
    return { ok: false, error: message };
  }
}

export type NativeMemberLeagueSummary = {
  linkId: string;
  leagueId: string;
  role: string;
  teamId: number | null;
  name: string;
  inviteCode: string;
  seasonYear: number;
  status: string;
  leagueType: string;
  teamCount: number;
  filledTeams: number;
  scoringPreset: string;
  draftMode: string;
  draftStatus: string;
  updatedAt: string | null;
  createdAt: string;
  canEditInvite: boolean;
};

async function assertMembershipLink(
  userId: string,
  linkId: string,
): Promise<{
  linkId: string;
  leagueId: string;
  role: string;
  teamId: number | null;
} | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("native_league_links")
    .select("id, native_league_id, role, team_id")
    .eq("id", linkId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    linkId: String(data.id),
    leagueId: String(data.native_league_id),
    role: String(data.role ?? "member"),
    teamId: data.team_id == null ? null : Number(data.team_id),
  };
}

export async function getNativeLeagueSummaryForLink(
  userId: string,
  linkId: string,
): Promise<NativeMemberLeagueSummary | null> {
  if (!tidbConfigured()) return null;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return null;

  const rows = await tidbExecute<{
    id: string;
    name: string;
    invite_code: string;
    season_year: number;
    status: string;
    league_type: string;
    team_count: number;
    scoring_preset: string;
    draft_mode: string;
    draft_status: string;
    created_at: string;
    updated_at: string | null;
    filled_teams: number;
  }>(
    `SELECT l.id, l.name, l.invite_code, l.season_year, l.status, l.league_type, l.team_count,
            l.scoring_preset, l.draft_mode, l.draft_status, l.created_at, l.updated_at,
            (SELECT COUNT(*) FROM native_teams t
             WHERE t.league_id = l.id AND t.user_id IS NOT NULL) AS filled_teams
     FROM native_leagues l
     WHERE l.id = ?
     LIMIT 1`,
    [membership.leagueId],
  );
  const league = rows[0];
  if (!league) return null;

  const canEditInvite = membership.role === "commissioner" || membership.role === "co_commish";
  return {
    linkId: membership.linkId,
    leagueId: league.id,
    role: membership.role,
    teamId: membership.teamId,
    name: league.name,
    inviteCode: league.invite_code,
    seasonYear: Number(league.season_year),
    status: league.status,
    leagueType: league.league_type,
    teamCount: Number(league.team_count),
    filledTeams: Number(league.filled_teams ?? 0),
    scoringPreset: league.scoring_preset,
    draftMode: league.draft_mode,
    draftStatus: league.draft_status,
    updatedAt: league.updated_at,
    createdAt: league.created_at,
    canEditInvite,
  };
}

export type UpdateNativeInviteResult =
  | { ok: true; inviteCode: string }
  | { ok: false; error: string };

/** Commissioner/co-commish can set a custom unique invite code (4–16 A–Z / 0–9). */
export async function updateNativeInviteCodeForUser(
  userId: string,
  linkId: string,
  rawCode: string,
): Promise<UpdateNativeInviteResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (membership.role !== "commissioner" && membership.role !== "co_commish") {
    return { ok: false, error: "Only commissioners can change the invite code" };
  }

  const inviteCode = String(rawCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  if (inviteCode.length < 4) {
    return { ok: false, error: "Invite code must be at least 4 characters (A–Z, 0–9)" };
  }

  const taken = await tidbExecute<{ id: string }>(
    `SELECT id FROM native_leagues WHERE invite_code = ? AND id <> ? LIMIT 1`,
    [inviteCode, membership.leagueId],
  );
  if (taken[0]) return { ok: false, error: "That invite code is already in use" };

  try {
    await tidbExecute(`UPDATE native_leagues SET invite_code = ? WHERE id = ?`, [
      inviteCode,
      membership.leagueId,
    ]);
    return { ok: true, inviteCode };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update invite code";
    return { ok: false, error: message };
  }
}

export type AdminDeleteNativeLeagueResult = { ok: true } | { ok: false; error: string };

/** Cascading admin delete: all TiDB `native_*` rows for the league + Supabase membership links. */
export async function adminDeleteNativeLeague(leagueId: string): Promise<AdminDeleteNativeLeagueResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const id = String(leagueId ?? "").trim();
  if (!id) return { ok: false, error: "Missing league id" };

  const existing = await tidbExecute<{ id: string }>(
    `SELECT id FROM native_leagues WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!existing[0]) return { ok: false, error: "League not found" };

  try {
    for (const table of NATIVE_LEAGUE_DELETE_TABLES) {
      if (table === "native_leagues") {
        await tidbExecute(`DELETE FROM native_leagues WHERE id = ?`, [id]);
      } else {
        await tidbExecute(`DELETE FROM \`${table}\` WHERE league_id = ?`, [id]);
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: linkError } = await supabaseAdmin
      .from("native_league_links")
      .delete()
      .eq("native_league_id", id);
    if (linkError) throw new Error(linkError.message);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete league failed";
    return { ok: false, error: message };
  }
}

function isCommishRole(role: string): boolean {
  return role === "commissioner" || role === "co_commish";
}

export type NativeTeamRow = {
  id: number;
  teamName: string;
  userId: string | null;
  draftSlot: number;
  waiverPriority: number;
  avatarUrl: string | null;
};

export type NativeLeagueBoard = {
  summary: NativeMemberLeagueSummary;
  teams: NativeTeamRow[];
  picksPerTeam: number;
  canManage: boolean;
  settingsLocked: boolean;
};

async function loadLeagueBoard(userId: string, linkId: string): Promise<NativeLeagueBoard | null> {
  const summary = await getNativeLeagueSummaryForLink(userId, linkId);
  if (!summary) return null;

  const teamRows = await tidbExecute<{
    id: number;
    team_name: string;
    user_id: string | null;
    draft_slot: number;
    waiver_priority: number;
    avatar_url: string | null;
  }>(
    `SELECT id, team_name, user_id, draft_slot, waiver_priority, avatar_url
     FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
    [summary.leagueId],
  );

  const leagueMeta = await tidbExecute<{ roster_slots: string | Record<string, unknown> | null }>(
    `SELECT roster_slots FROM native_leagues WHERE id = ? LIMIT 1`,
    [summary.leagueId],
  );
  let rosterSlots: Record<string, unknown> | null = null;
  const raw = leagueMeta[0]?.roster_slots;
  if (typeof raw === "string") {
    try {
      rosterSlots = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      rosterSlots = null;
    }
  } else if (raw && typeof raw === "object") {
    rosterSlots = raw as Record<string, unknown>;
  }

  const settingsLocked = summary.draftStatus !== "not_started" && summary.draftStatus !== "scheduled";
  return {
    summary,
    teams: teamRows.map((t) => ({
      id: Number(t.id),
      teamName: t.team_name,
      userId: t.user_id,
      draftSlot: Number(t.draft_slot),
      waiverPriority: Number(t.waiver_priority),
      avatarUrl: t.avatar_url,
    })),
    picksPerTeam: countDraftableRosterSpots(rosterSlots),
    canManage: isCommishRole(summary.role),
    settingsLocked,
  };
}

export async function getNativeLeagueBoardForLink(
  userId: string,
  linkId: string,
): Promise<NativeLeagueBoard | null> {
  if (!tidbConfigured()) return null;
  return loadLeagueBoard(userId, linkId);
}

export type NativeMutationResult = { ok: true } | { ok: false; error: string };

export async function renameNativeTeamForUser(
  userId: string,
  linkId: string,
  teamId: number,
  teamName: string,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  const name = String(teamName ?? "").trim().slice(0, 64);
  if (name.length < 1) return { ok: false, error: "Team name is required" };

  const team = await tidbExecute<{ id: number; user_id: string | null }>(
    `SELECT id, user_id FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
    [teamId, membership.leagueId],
  );
  const row = team[0];
  if (!row) return { ok: false, error: "Team not found" };
  const owns = row.user_id === userId;
  if (!owns && !isCommishRole(membership.role)) {
    return { ok: false, error: "You can only rename your own team" };
  }

  await tidbExecute(`UPDATE native_teams SET team_name = ? WHERE id = ? AND league_id = ?`, [
    name,
    teamId,
    membership.leagueId,
  ]);
  return { ok: true };
}

export async function kickNativeTeamMemberForUser(
  userId: string,
  linkId: string,
  teamId: number,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const board = await loadLeagueBoard(userId, linkId);
  if (!board) return { ok: false, error: "League not found" };
  if (!board.canManage) return { ok: false, error: "Only commissioners can open seats" };
  if (board.settingsLocked) return { ok: false, error: "Seats are locked after the draft starts" };

  const team = board.teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: "Team not found" };
  if (!team.userId) return { ok: true };
  if (team.userId === userId && board.summary.role === "commissioner") {
    return { ok: false, error: "Commissioner cannot leave their own seat this way" };
  }

  await tidbExecute(`UPDATE native_teams SET user_id = NULL WHERE id = ? AND league_id = ?`, [
    teamId,
    board.summary.leagueId,
  ]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("native_league_links")
    .delete()
    .eq("native_league_id", board.summary.leagueId)
    .eq("user_id", team.userId);
  return { ok: true };
}

export async function updateNativeLeagueBasicsForUser(
  userId: string,
  linkId: string,
  input: { name?: string; scoringPreset?: NativeScoringPreset; draftMode?: NativeDraftMode },
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const board = await loadLeagueBoard(userId, linkId);
  if (!board) return { ok: false, error: "League not found" };
  if (!board.canManage) return { ok: false, error: "Only commissioners can edit league settings" };
  if (board.settingsLocked) {
    return { ok: false, error: "Structural settings lock after the draft starts" };
  }

  const name = input.name != null ? String(input.name).trim().slice(0, 128) : null;
  if (name != null && name.length < 1) return { ok: false, error: "League name is required" };

  const scoringPreset = input.scoringPreset;
  let scoringSettings: Record<string, number> | null = null;
  if (scoringPreset === "ppr") scoringSettings = { ...defaultNativeScoringSettings(), rec: 1 };
  else if (scoringPreset === "std") scoringSettings = { ...defaultNativeScoringSettings(), rec: 0 };
  else if (scoringPreset === "half") scoringSettings = defaultNativeScoringSettings();

  const draftMode =
    input.draftMode === "live" || input.draftMode === "offline" ? input.draftMode : null;

  const sets: string[] = [];
  const params: unknown[] = [];
  if (name != null) {
    sets.push("name = ?");
    params.push(name);
  }
  if (scoringPreset && scoringSettings) {
    sets.push("scoring_preset = ?", "scoring_settings = ?");
    params.push(scoringPreset, JSON.stringify(scoringSettings));
  }
  if (draftMode) {
    sets.push("draft_mode = ?");
    params.push(draftMode);
  }
  if (!sets.length) return { ok: true };

  params.push(board.summary.leagueId);
  await tidbExecute(`UPDATE native_leagues SET ${sets.join(", ")} WHERE id = ?`, params);

  if (name != null) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("native_league_links")
      .update({ label: name })
      .eq("native_league_id", board.summary.leagueId);
  }
  return { ok: true };
}

export type NativeDraftPickRow = {
  pickNumber: number;
  round: number;
  teamId: number;
  playerId: string | null;
  pickedAt: string | null;
  source: string | null;
};

export type NativeDraftState = {
  board: NativeLeagueBoard;
  picks: NativeDraftPickRow[];
  draftedPlayerIds: string[];
  nextPickNumber: number;
  totalPicks: number;
  canAssign: boolean;
  liveDraftDeferred: boolean;
};

export async function getNativeDraftStateForLink(
  userId: string,
  linkId: string,
): Promise<NativeDraftState | null> {
  if (!tidbConfigured()) return null;
  const board = await loadLeagueBoard(userId, linkId);
  if (!board) return null;

  const pickRows = await tidbExecute<{
    pick_number: number;
    round: number;
    team_id: number;
    player_id: string | null;
    picked_at: string | null;
    source: string | null;
  }>(
    `SELECT pick_number, round, team_id, player_id, picked_at, source
     FROM native_draft_picks WHERE league_id = ? ORDER BY pick_number ASC`,
    [board.summary.leagueId],
  );

  const picks = pickRows.map((p) => ({
    pickNumber: Number(p.pick_number),
    round: Number(p.round),
    teamId: Number(p.team_id),
    playerId: p.player_id,
    pickedAt: p.picked_at,
    source: p.source,
  }));
  const draftedPlayerIds = picks.map((p) => p.playerId).filter((id): id is string => Boolean(id));
  const nextPickNumber = picks.length + 1;
  const totalPicks = board.picksPerTeam * board.teams.length;
  const drafting =
    board.summary.draftStatus === "not_started" ||
    board.summary.draftStatus === "live" ||
    board.summary.draftStatus === "paused" ||
    board.summary.draftStatus === "scheduled";
  const liveDraftDeferred = board.summary.draftMode === "live";

  return {
    board,
    picks,
    draftedPlayerIds,
    nextPickNumber,
    totalPicks,
    canAssign: board.canManage && drafting && board.summary.draftStatus !== "complete",
    liveDraftDeferred,
  };
}

export async function assignNativeOfflinePickForUser(
  userId: string,
  linkId: string,
  input: { teamId: number; playerId: string },
): Promise<NativeMutationResult & { pickNumber?: number }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const state = await getNativeDraftStateForLink(userId, linkId);
  if (!state) return { ok: false, error: "League not found" };
  if (!state.canAssign) return { ok: false, error: "You cannot assign picks right now" };
  if (state.board.summary.draftStatus === "complete") {
    return { ok: false, error: "Draft is already complete" };
  }

  const teamId = Number(input.teamId);
  const playerId = String(input.playerId ?? "").trim().slice(0, 32);
  if (!teamId || !playerId) return { ok: false, error: "Team and player are required" };
  if (!state.board.teams.some((t) => t.id === teamId)) return { ok: false, error: "Invalid team" };
  if (state.draftedPlayerIds.includes(playerId)) {
    return { ok: false, error: "Player already drafted" };
  }

  const teamPickCount = state.picks.filter((p) => p.teamId === teamId).length;
  if (teamPickCount >= state.board.picksPerTeam) {
    return { ok: false, error: "That team already has a full draft roster" };
  }

  const pickNumber = state.nextPickNumber;
  const round = Math.floor((pickNumber - 1) / state.board.teams.length) + 1;
  const leagueId = state.board.summary.leagueId;

  try {
    if (state.board.summary.draftStatus === "not_started") {
      await tidbExecute(
        `UPDATE native_leagues SET draft_status = 'live', status = 'drafting', current_draft_pick = ? WHERE id = ?`,
        [pickNumber, leagueId],
      );
    } else {
      await tidbExecute(`UPDATE native_leagues SET current_draft_pick = ? WHERE id = ?`, [
        pickNumber,
        leagueId,
      ]);
    }

    await tidbExecute(
      `INSERT INTO native_draft_picks (league_id, pick_number, round, team_id, player_id, picked_at, source)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'commissioner')`,
      [leagueId, pickNumber, round, teamId, playerId],
    );
    return { ok: true, pickNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not assign pick";
    if (/uq_native_draft_player|Duplicate/i.test(message)) {
      return { ok: false, error: "Player already drafted" };
    }
    return { ok: false, error: message };
  }
}

export async function undoNativeOfflinePickForUser(
  userId: string,
  linkId: string,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const state = await getNativeDraftStateForLink(userId, linkId);
  if (!state) return { ok: false, error: "League not found" };
  if (!state.canAssign) return { ok: false, error: "You cannot undo picks right now" };
  if (state.picks.length === 0) return { ok: false, error: "No picks to undo" };

  const last = state.picks[state.picks.length - 1]!;
  const leagueId = state.board.summary.leagueId;
  await tidbExecute(`DELETE FROM native_draft_picks WHERE league_id = ? AND pick_number = ?`, [
    leagueId,
    last.pickNumber,
  ]);
  const remaining = state.picks.length - 1;
  if (remaining === 0) {
    await tidbExecute(
      `UPDATE native_leagues SET draft_status = 'not_started', status = 'setup', current_draft_pick = 0 WHERE id = ?`,
      [leagueId],
    );
  } else {
    await tidbExecute(`UPDATE native_leagues SET current_draft_pick = ? WHERE id = ?`, [
      remaining,
      leagueId,
    ]);
  }
  return { ok: true };
}

export async function completeNativeDraftForUser(
  userId: string,
  linkId: string,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const state = await getNativeDraftStateForLink(userId, linkId);
  if (!state) return { ok: false, error: "League not found" };
  if (!state.board.canManage) return { ok: false, error: "Only commissioners can complete the draft" };
  if (state.board.summary.draftStatus === "complete") return { ok: true };
  if (state.picks.length === 0) return { ok: false, error: "Assign at least one pick before completing" };

  const leagueId = state.board.summary.leagueId;
  const byTeam = new Map<number, string[]>();
  for (const team of state.board.teams) byTeam.set(team.id, []);
  for (const pick of state.picks) {
    if (!pick.playerId) continue;
    const list = byTeam.get(pick.teamId) ?? [];
    list.push(pick.playerId);
    byTeam.set(pick.teamId, list);
  }

  try {
    for (const [teamId, playerIds] of byTeam) {
      await tidbExecute(
        `INSERT INTO native_rosters (league_id, team_id, player_ids, reserve_ir, version)
         VALUES (?, ?, ?, NULL, 1)
         ON DUPLICATE KEY UPDATE player_ids = VALUES(player_ids), version = version + 1`,
        [leagueId, teamId, JSON.stringify(playerIds)],
      );
      for (const playerId of playerIds) {
        await tidbExecute(
          `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
           VALUES (?, ?, ?, 'roster')
           ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
          [leagueId, playerId, teamId],
        );
      }
    }

    const playoffRows = await tidbExecute<{ playoff_start_week: number; season_year: number }>(
      `SELECT playoff_start_week, season_year FROM native_leagues WHERE id = ? LIMIT 1`,
      [leagueId],
    );
    const playoffStart = Number(playoffRows[0]?.playoff_start_week ?? 15);
    const seasonYear = Number(playoffRows[0]?.season_year ?? new Date().getUTCFullYear());
    const weekCount = Math.max(1, playoffStart - 1);
    const teamIds = state.board.teams.map((t) => t.id);
    const schedule = buildNativeRoundRobinSchedule(teamIds, weekCount);

    await tidbExecute(`DELETE FROM native_schedules WHERE league_id = ?`, [leagueId]);
    for (const m of schedule) {
      await tidbExecute(
        `INSERT INTO native_schedules (league_id, season_year, week, matchup_id, home_team_id, away_team_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [leagueId, seasonYear, m.week, m.matchupId, m.homeTeamId, m.awayTeamId],
      );
    }

    await tidbExecute(
      `UPDATE native_leagues
       SET draft_status = 'complete', status = 'in_season', current_draft_pick = ?, current_week = 1
       WHERE id = ?`,
      [state.picks.length, leagueId],
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete draft";
    return { ok: false, error: message };
  }
}

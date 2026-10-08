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

    // One multi-row INSERT for seats + one for empty rosters (avoids 3×N round-trips).
    const teamPlaceholders: string[] = [];
    const teamParams: unknown[] = [];
    const faab = settings.waiverType === "faab" ? settings.waiverBudget : null;
    for (let slot = 1; slot <= settings.teamCount; slot++) {
      const isCommish = slot === 1;
      teamPlaceholders.push("(?, ?, ?, ?, ?, ?)");
      teamParams.push(
        leagueId,
        isCommish ? uid : null,
        isCommish ? teamName : `Team ${slot}`,
        slot,
        slot,
        faab,
      );
    }
    await tidbExecute(
      `INSERT INTO native_teams (
        league_id, user_id, team_name, draft_slot, waiver_priority, faab_balance
      ) VALUES ${teamPlaceholders.join(", ")}`,
      teamParams,
    );

    const seats = await tidbExecute<{ id: number; draft_slot: number }>(
      `SELECT id, draft_slot FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
      [leagueId],
    );
    if (seats.length !== settings.teamCount) throw new Error("Failed to create team seats");

    const rosterPlaceholders = seats.map(() => "(?, ?, ?, NULL, 1)");
    const rosterParams = seats.flatMap((s) => [leagueId, Number(s.id), jsonText([])]);
    await tidbExecute(
      `INSERT INTO native_rosters (league_id, team_id, player_ids, reserve_ir, version)
       VALUES ${rosterPlaceholders.join(", ")}`,
      rosterParams,
    );

    const commissionerTeamId = Number(seats.find((s) => Number(s.draft_slot) === 1)?.id ?? 0);
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

type LeagueCoreRow = {
  id: string;
  name: string;
  invite_code: string;
  season_year: number;
  status: string;
  league_type: string;
  team_count: number;
  current_week?: number;
  scoring_preset: string;
  draft_mode: string;
  draft_status: string;
  created_at: string;
  updated_at: string | null;
  roster_slots?: string | Record<string, unknown> | null;
  playoff_start_week?: number;
};

function parseRosterSlots(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function summaryFromParts(
  membership: { linkId: string; leagueId: string; role: string; teamId: number | null },
  league: LeagueCoreRow,
  filledTeams: number,
): NativeMemberLeagueSummary {
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
    filledTeams,
    scoringPreset: league.scoring_preset,
    draftMode: league.draft_mode,
    draftStatus: league.draft_status,
    updatedAt: league.updated_at,
    createdAt: league.created_at,
    canEditInvite: isCommishRole(membership.role),
  };
}

const LEAGUE_CORE_SELECT = `id, name, invite_code, season_year, status, league_type, team_count, current_week,
            scoring_preset, draft_mode, draft_status, created_at, updated_at, roster_slots, playoff_start_week`;

function parsePlayerIdList(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0)
    .slice(0, 64);
}

export async function getNativeLeagueSummaryForLink(
  userId: string,
  linkId: string,
): Promise<NativeMemberLeagueSummary | null> {
  if (!tidbConfigured()) return null;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return null;

  const [rows, filledRows] = await Promise.all([
    tidbExecute<LeagueCoreRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
      [membership.leagueId],
    ),
    tidbExecute<{ c: number }>(
      `SELECT COUNT(*) AS c FROM native_teams WHERE league_id = ? AND user_id IS NOT NULL`,
      [membership.leagueId],
    ),
  ]);
  const league = rows[0];
  if (!league) return null;
  return summaryFromParts(membership, league, Number(filledRows[0]?.c ?? 0));
}

/** One Fluid call for My Leagues — avoids N per-row TiDB summary fetches. */
export async function listNativeLeagueSummariesForUser(
  userId: string,
): Promise<NativeMemberLeagueSummary[]> {
  if (!tidbConfigured()) return [];
  const uid = String(userId ?? "").trim();
  if (!uid) return [];

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: links, error } = await supabaseAdmin
    .from("native_league_links")
    .select("id, native_league_id, role, team_id")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error || !links?.length) return [];

  const leagueIds = [...new Set(links.map((l) => String(l.native_league_id)).filter(Boolean))];
  if (leagueIds.length === 0) return [];
  const placeholders = leagueIds.map(() => "?").join(", ");

  const [leagues, filledRows] = await Promise.all([
    tidbExecute<LeagueCoreRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id IN (${placeholders})`,
      leagueIds,
    ),
    tidbExecute<{ league_id: string; c: number }>(
      `SELECT league_id, COUNT(*) AS c FROM native_teams
       WHERE league_id IN (${placeholders}) AND user_id IS NOT NULL
       GROUP BY league_id`,
      leagueIds,
    ),
  ]);

  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  const filledById = new Map(filledRows.map((r) => [String(r.league_id), Number(r.c ?? 0)]));

  const out: NativeMemberLeagueSummary[] = [];
  for (const link of links) {
    const leagueId = String(link.native_league_id);
    const league = leagueById.get(leagueId);
    if (!league) continue;
    out.push(
      summaryFromParts(
        {
          linkId: String(link.id),
          leagueId,
          role: String(link.role ?? "member"),
          teamId: link.team_id == null ? null : Number(link.team_id),
        },
        league,
        filledById.get(leagueId) ?? 0,
      ),
    );
  }
  return out;
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

export type NativeRosterRow = {
  teamId: number;
  playerIds: string[];
  version: number;
};

export type NativeWeekMatchup = {
  matchupId: number;
  homeTeamId: number;
  awayTeamId: number;
};

export type NativeLeagueBoard = {
  summary: NativeMemberLeagueSummary;
  teams: NativeTeamRow[];
  picksPerTeam: number;
  canManage: boolean;
  settingsLocked: boolean;
  playoffStartWeek: number;
  /** League current week (1–18). */
  currentWeek: number;
  /** Per-team roster player ids (Sleeper ids). */
  rosters: NativeRosterRow[];
  /** playerId → teamId ownership map for FA / Players merge. */
  ownership: Record<string, number>;
  /** Current-week schedule pairings (empty pre-draft). */
  weekMatchups: NativeWeekMatchup[];
};

type TeamDbRow = {
  id: number;
  team_name: string;
  user_id: string | null;
  draft_slot: number;
  waiver_priority: number;
  avatar_url: string | null;
};

async function loadLeagueBoard(userId: string, linkId: string): Promise<NativeLeagueBoard | null> {
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return null;

  // Parallel board bundle: league + teams + rosters + picks + current-week schedule.
  const [rows, teamRows, rosterRows, pickRows, scheduleRows] = await Promise.all([
    tidbExecute<LeagueCoreRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
      [membership.leagueId],
    ),
    tidbExecute<TeamDbRow>(
      `SELECT id, team_name, user_id, draft_slot, waiver_priority, avatar_url
       FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
      [membership.leagueId],
    ),
    tidbExecute<{ team_id: number; player_ids: unknown; version: number }>(
      `SELECT team_id, player_ids, version FROM native_rosters WHERE league_id = ?`,
      [membership.leagueId],
    ),
    tidbExecute<{ player_id: string; team_id: number }>(
      `SELECT player_id, team_id FROM native_draft_picks
       WHERE league_id = ? AND player_id IS NOT NULL`,
      [membership.leagueId],
    ),
    tidbExecute<{
      matchup_id: number;
      home_team_id: number;
      away_team_id: number;
    }>(
      `SELECT s.matchup_id, s.home_team_id, s.away_team_id
       FROM native_schedules s
       INNER JOIN native_leagues l ON l.id = s.league_id
       WHERE s.league_id = ?
         AND s.season_year = l.season_year
         AND s.week = l.current_week
       ORDER BY s.matchup_id ASC
       LIMIT 32`,
      [membership.leagueId],
    ),
  ]);
  const league = rows[0];
  if (!league) return null;

  const currentWeek = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));

  const filledTeams = teamRows.filter((t) => t.user_id != null && String(t.user_id).length > 0).length;
  const summary = summaryFromParts(membership, league, filledTeams);
  const rosterSlots = parseRosterSlots(league.roster_slots);
  const settingsLocked = summary.draftStatus !== "not_started" && summary.draftStatus !== "scheduled";

  const rosters: NativeRosterRow[] = rosterRows.map((r) => ({
    teamId: Number(r.team_id),
    playerIds: parsePlayerIdList(r.player_ids),
    version: Number(r.version ?? 1) || 1,
  }));
  const ownership: Record<string, number> = {};
  // Prefer committed rosters; fall back to draft picks while draft is in progress.
  for (const pick of pickRows) {
    const playerId = String(pick.player_id ?? "").trim();
    if (playerId) ownership[playerId] = Number(pick.team_id);
  }
  for (const roster of rosters) {
    for (const playerId of roster.playerIds) {
      ownership[playerId] = roster.teamId;
    }
  }

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
    playoffStartWeek: Number(league.playoff_start_week ?? 15) || 15,
    currentWeek,
    rosters,
    ownership,
    weekMatchups: scheduleRows.map((m) => ({
      matchupId: Number(m.matchup_id),
      homeTeamId: Number(m.home_team_id),
      awayTeamId: Number(m.away_team_id),
    })),
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
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (!isCommishRole(membership.role)) return { ok: false, error: "Only commissioners can open seats" };

  const [leagueRows, teamRows] = await Promise.all([
    tidbExecute<{ draft_status: string }>(
      `SELECT draft_status FROM native_leagues WHERE id = ? LIMIT 1`,
      [membership.leagueId],
    ),
    tidbExecute<{ id: number; user_id: string | null }>(
      `SELECT id, user_id FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
      [teamId, membership.leagueId],
    ),
  ]);
  const draftStatus = String(leagueRows[0]?.draft_status ?? "");
  if (draftStatus !== "not_started" && draftStatus !== "scheduled") {
    return { ok: false, error: "Seats are locked after the draft starts" };
  }
  const team = teamRows[0];
  if (!team) return { ok: false, error: "Team not found" };
  if (!team.user_id) return { ok: true };
  if (team.user_id === userId && membership.role === "commissioner") {
    return { ok: false, error: "Commissioner cannot leave their own seat this way" };
  }

  await tidbExecute(`UPDATE native_teams SET user_id = NULL WHERE id = ? AND league_id = ?`, [
    teamId,
    membership.leagueId,
  ]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("native_league_links")
    .delete()
    .eq("native_league_id", membership.leagueId)
    .eq("user_id", team.user_id);
  return { ok: true };
}

export async function updateNativeLeagueBasicsForUser(
  userId: string,
  linkId: string,
  input: { name?: string; scoringPreset?: NativeScoringPreset; draftMode?: NativeDraftMode },
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (!isCommishRole(membership.role)) {
    return { ok: false, error: "Only commissioners can edit league settings" };
  }

  const leagueRows = await tidbExecute<{ draft_status: string }>(
    `SELECT draft_status FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const draftStatus = String(leagueRows[0]?.draft_status ?? "");
  if (draftStatus !== "not_started" && draftStatus !== "scheduled") {
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

  params.push(membership.leagueId);
  await tidbExecute(`UPDATE native_leagues SET ${sets.join(", ")} WHERE id = ?`, params);

  if (name != null) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("native_league_links")
      .update({ label: name })
      .eq("native_league_id", membership.leagueId);
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
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (!isCommishRole(membership.role)) return { ok: false, error: "You cannot assign picks right now" };

  const teamId = Number(input.teamId);
  const playerId = String(input.playerId ?? "").trim().slice(0, 32);
  if (!teamId || !playerId) return { ok: false, error: "Team and player are required" };

  const leagueId = membership.leagueId;
  const [leagueRows, teamRows, aggRows] = await Promise.all([
    tidbExecute<LeagueCoreRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
      [leagueId],
    ),
    tidbExecute<{ id: number }>(
      `SELECT id FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
      [teamId, leagueId],
    ),
    tidbExecute<{
      next_pick: number;
      team_picks: number;
      player_taken: number;
      team_count: number;
    }>(
      `SELECT
         (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM native_draft_picks WHERE league_id = ?) AS next_pick,
         (SELECT COUNT(*) FROM native_draft_picks WHERE league_id = ? AND team_id = ?) AS team_picks,
         (SELECT COUNT(*) FROM native_draft_picks WHERE league_id = ? AND player_id = ?) AS player_taken,
         (SELECT COUNT(*) FROM native_teams WHERE league_id = ?) AS team_count`,
      [leagueId, leagueId, teamId, leagueId, playerId, leagueId],
    ),
  ]);

  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };
  if (!teamRows[0]) return { ok: false, error: "Invalid team" };

  const draftStatus = String(league.draft_status);
  if (draftStatus === "complete") return { ok: false, error: "Draft is already complete" };
  const drafting =
    draftStatus === "not_started" ||
    draftStatus === "live" ||
    draftStatus === "paused" ||
    draftStatus === "scheduled";
  if (!drafting) return { ok: false, error: "You cannot assign picks right now" };

  const agg = aggRows[0];
  if (Number(agg?.player_taken ?? 0) > 0) return { ok: false, error: "Player already drafted" };

  const picksPerTeam = countDraftableRosterSpots(parseRosterSlots(league.roster_slots));
  if (Number(agg?.team_picks ?? 0) >= picksPerTeam) {
    return { ok: false, error: "That team already has a full draft roster" };
  }

  const pickNumber = Number(agg?.next_pick ?? 1);
  const teamCount = Math.max(1, Number(agg?.team_count ?? league.team_count) || 1);
  const round = Math.floor((pickNumber - 1) / teamCount) + 1;

  try {
    if (draftStatus === "not_started") {
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
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (!isCommishRole(membership.role)) return { ok: false, error: "You cannot undo picks right now" };

  const leagueId = membership.leagueId;
  const [leagueRows, lastRows] = await Promise.all([
    tidbExecute<{ draft_status: string }>(
      `SELECT draft_status FROM native_leagues WHERE id = ? LIMIT 1`,
      [leagueId],
    ),
    tidbExecute<{ pick_number: number }>(
      `SELECT pick_number FROM native_draft_picks WHERE league_id = ? ORDER BY pick_number DESC LIMIT 1`,
      [leagueId],
    ),
  ]);
  const draftStatus = String(leagueRows[0]?.draft_status ?? "");
  if (draftStatus === "complete") return { ok: false, error: "You cannot undo picks right now" };
  const drafting =
    draftStatus === "not_started" ||
    draftStatus === "live" ||
    draftStatus === "paused" ||
    draftStatus === "scheduled";
  if (!drafting) return { ok: false, error: "You cannot undo picks right now" };

  const last = lastRows[0];
  if (!last) return { ok: false, error: "No picks to undo" };

  const pickNumber = Number(last.pick_number);
  await tidbExecute(`DELETE FROM native_draft_picks WHERE league_id = ? AND pick_number = ?`, [
    leagueId,
    pickNumber,
  ]);
  const remaining = pickNumber - 1;
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
    const rosterEntries = [...byTeam.entries()];
    if (rosterEntries.length > 0) {
      const rosterPlaceholders = rosterEntries.map(() => "(?, ?, ?, NULL, 1)");
      const rosterParams = rosterEntries.flatMap(([teamId, playerIds]) => [
        leagueId,
        teamId,
        JSON.stringify(playerIds),
      ]);
      await tidbExecute(
        `INSERT INTO native_rosters (league_id, team_id, player_ids, reserve_ir, version)
         VALUES ${rosterPlaceholders.join(", ")}
         ON DUPLICATE KEY UPDATE player_ids = VALUES(player_ids), version = version + 1`,
        rosterParams,
      );
    }

    const lockRows: Array<{ teamId: number; playerId: string }> = [];
    for (const [teamId, playerIds] of byTeam) {
      for (const playerId of playerIds) lockRows.push({ teamId, playerId });
    }
    // Chunk locks to keep packet size sane for large leagues.
    const LOCK_CHUNK = 80;
    for (let i = 0; i < lockRows.length; i += LOCK_CHUNK) {
      const chunk = lockRows.slice(i, i + LOCK_CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, 'roster')");
      const params = chunk.flatMap((r) => [leagueId, r.playerId, r.teamId]);
      await tidbExecute(
        `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
         VALUES ${placeholders.join(", ")}
         ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
        params,
      );
    }

    const playoffWeek = Number(state.board.playoffStartWeek ?? 15) || 15;
    const seasonYear = Number(state.board.summary.seasonYear ?? new Date().getUTCFullYear());
    const weekCount = Math.max(1, playoffWeek - 1);
    const teamIds = state.board.teams.map((t) => t.id);
    const schedule = buildNativeRoundRobinSchedule(teamIds, weekCount);

    await tidbExecute(`DELETE FROM native_schedules WHERE league_id = ?`, [leagueId]);
    const SCHED_CHUNK = 60;
    for (let i = 0; i < schedule.length; i += SCHED_CHUNK) {
      const chunk = schedule.slice(i, i + SCHED_CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)");
      const params = chunk.flatMap((m) => [
        leagueId,
        seasonYear,
        m.week,
        m.matchupId,
        m.homeTeamId,
        m.awayTeamId,
      ]);
      await tidbExecute(
        `INSERT INTO native_schedules (league_id, season_year, week, matchup_id, home_team_id, away_team_id)
         VALUES ${placeholders.join(", ")}`,
        params,
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

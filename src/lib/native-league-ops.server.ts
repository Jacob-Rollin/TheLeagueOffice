/**
 * Server-only native league create / join / admin mutations (TiDB + Supabase links).
 */
import { randomUUID } from "node:crypto";

import {
  defaultNativeScoringSettings,
  generateNativeInviteCode,
  NATIVE_MAX_COMMISSIONER_LEAGUES,
  normalizeNativeLeagueSettings,
  packRosterSlotsJson,
  parseIrAllowedStatuses,
  type NativeCommissionerSettings,
  type NativeDraftMode,
  type NativeIrAllowedStatus,
  type NativeLeagueSettingsInput,
  type NativeScoringPreset,
} from "@/lib/native-league-settings";

export type { NativeCommissionerSettings };
import { NATIVE_LEAGUE_TABLE_NAMES } from "@/lib/native-league-ddl.server";
import {
  buildNativeRoundRobinSchedule,
  countDraftableRosterSpots,
} from "@/lib/native-league-schedule";
import {
  countActiveRosterCapacity,
  parseRosterSlotCounts,
  splitActiveAndIrFromSlots,
  validateNativeLineupSlots,
  type NativeLineupSlots,
} from "@/lib/native-league-lineup";
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
        jsonText(packRosterSlotsJson(settings.rosterSlots, settings.irAllowedStatuses)),
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

  // Claim the lowest open human seat (AI seats stay user_id NULL + is_ai=1).
  await tidbExecute(
    `UPDATE native_teams
     SET user_id = ?,
         team_name = IF(? <> '', ?, team_name),
         is_ai = 0,
         ai_persona = NULL
     WHERE league_id = ? AND user_id IS NULL AND COALESCE(is_ai, 0) = 0
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

export async function assertMembershipLink(
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
  season_start_week?: number;
  is_public?: number | boolean;
  auto_activate_next_year?: number | boolean;
  playoff_teams?: number;
  playoff_matchup_length?: string;
  playoff_week_pair?: string;
  standings_tiebreaker?: string;
  allow_matchup_ties?: number | boolean;
  matchup_tiebreaker_slot?: string;
  divisions_enabled?: number | boolean;
  waiver_type?: string;
  waiver_budget?: number | null;
  waiver_period_days?: number;
  post_draft_player_status?: string;
  lock_fa_on_gametime?: number | boolean;
  max_adds_per_week?: number | null;
  max_adds_per_season?: number | null;
  undroppable_top_players?: number | boolean;
  roster_lock_type?: string;
  trade_deadline_week?: number | null;
  trade_review_hours?: number;
  trade_veto_mode?: string;
  max_trades_per_season?: number | null;
  draft_format?: string;
  draft_order_type?: string;
  draft_pick_time_limit_sec?: number;
  keepers_per_team?: number;
  keeper_note?: string | null;
  scoring_settings?: string | Record<string, unknown> | null;
  allow_ai_teams?: number | boolean;
};

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return fallback;
}

export function parseScoringSettingsJson(raw: unknown): Record<string, number> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaultNativeScoringSettings();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultNativeScoringSettings();
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : defaultNativeScoringSettings();
}

function commissionerSettingsFromLeague(
  league: LeagueCoreRow,
  canManage: boolean,
): NativeCommissionerSettings {
  const rosterSlotsRaw = parseRosterSlots(league.roster_slots);
  const slotCounts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);
  const rosterSlots: Record<string, number> = {};
  for (const [k, v] of Object.entries(slotCounts)) {
    if (v != null && v > 0) rosterSlots[k] = v;
  }
  const draftStatus = String(league.draft_status ?? "");
  return {
    name: league.name,
    inviteCode: league.invite_code,
    leagueId: league.id,
    seasonYear: Number(league.season_year),
    teamCount: Number(league.team_count),
    seasonStartWeek: Math.max(1, Number(league.season_start_week ?? 1) || 1),
    isPublic: asBool(league.is_public, false),
    autoActivateNextYear: asBool(league.auto_activate_next_year, true),
    scoringPreset: String(league.scoring_preset ?? "half"),
    scoringSettings: parseScoringSettingsJson(league.scoring_settings),
    playoffTeams: Number(league.playoff_teams ?? 4) || 4,
    playoffMatchupLength: String(league.playoff_matchup_length ?? "one"),
    playoffWeekPair: String(league.playoff_week_pair ?? "15-17"),
    standingsTiebreaker: String(league.standings_tiebreaker ?? "points_for"),
    allowMatchupTies: asBool(league.allow_matchup_ties, false),
    matchupTiebreakerSlot: String(league.matchup_tiebreaker_slot ?? "Bench"),
    divisionsEnabled: asBool(league.divisions_enabled, false),
    waiverType: String(league.waiver_type ?? "rolling"),
    waiverBudget: league.waiver_budget == null ? null : Number(league.waiver_budget),
    waiverPeriodDays: Number(league.waiver_period_days ?? 1) || 1,
    postDraftPlayerStatus: String(league.post_draft_player_status ?? "free_agents"),
    lockFaOnGametime: asBool(league.lock_fa_on_gametime, true),
    maxAddsPerWeek: league.max_adds_per_week == null ? null : Number(league.max_adds_per_week),
    maxAddsPerSeason: league.max_adds_per_season == null ? null : Number(league.max_adds_per_season),
    undroppableTopPlayers: asBool(league.undroppable_top_players, false),
    rosterLockType: String(league.roster_lock_type ?? "game_time"),
    tradeDeadlineWeek:
      league.trade_deadline_week == null ? null : Number(league.trade_deadline_week),
    tradeReviewHours: Number(league.trade_review_hours ?? 24) || 24,
    tradeVetoMode: String(league.trade_veto_mode ?? "commissioner"),
    maxTradesPerSeason:
      league.max_trades_per_season == null ? null : Number(league.max_trades_per_season),
    draftMode: String(league.draft_mode ?? "offline"),
    draftFormat: String(league.draft_format ?? "standard"),
    draftOrderType: String(league.draft_order_type ?? "snake"),
    draftPickTimeLimitSec: Number(league.draft_pick_time_limit_sec ?? 90) || 90,
    keepersPerTeam: Number(league.keepers_per_team ?? 0) || 0,
    keeperNote: league.keeper_note == null ? null : String(league.keeper_note),
    rosterSlots,
    irAllowedStatuses: parseIrAllowedStatuses(rosterSlotsRaw),
    rosterCapacity: countActiveRosterCapacity(slotCounts),
    settingsLocked: draftStatus !== "not_started" && draftStatus !== "scheduled",
    canManage,
    allowAiTeams: asBool(league.allow_ai_teams, false),
  };
}

export function parseRosterSlots(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
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

export const LEAGUE_CORE_SELECT = `id, name, invite_code, season_year, status, league_type, team_count, current_week,
            scoring_preset, draft_mode, draft_status, created_at, updated_at, roster_slots, playoff_start_week,
            season_start_week, is_public, auto_activate_next_year, playoff_teams, playoff_matchup_length,
            playoff_week_pair, standings_tiebreaker, allow_matchup_ties, matchup_tiebreaker_slot,
            divisions_enabled, waiver_type, waiver_budget, waiver_period_days, post_draft_player_status,
            lock_fa_on_gametime, max_adds_per_week, max_adds_per_season, undroppable_top_players,
            roster_lock_type, trade_deadline_week, trade_review_hours, trade_veto_mode, max_trades_per_season,
            draft_format, draft_order_type, draft_pick_time_limit_sec, keepers_per_team, keeper_note,
            scoring_settings, allow_ai_teams`;

export function parsePlayerIdList(raw: unknown): string[] {
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

export function isCommishRole(role: string): boolean {
  return role === "commissioner" || role === "co_commish";
}

export type NativeTeamRow = {
  id: number;
  teamName: string;
  userId: string | null;
  draftSlot: number;
  waiverPriority: number;
  avatarUrl: string | null;
  /** AI-managed testing seat (no human user_id). */
  isAi: boolean;
  aiPersona: string | null;
};

export type NativeRosterRow = {
  teamId: number;
  /** Active + IR (for ownership / display). */
  playerIds: string[];
  /** Active roster only (excludes IR) — use for FA open-slot math. */
  activePlayerIds: string[];
  irPlayerIds: string[];
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
  /** Slot counts (BN / IR / starters) from league settings. */
  rosterSlots: Record<string, number>;
  /** Active roster capacity (excludes IR). */
  rosterCapacity: number;
  irAllowedStatuses: NativeIrAllowedStatus[];
  /** Full commissioner settings snapshot for mobile / desktop tools. */
  commissioner: NativeCommissionerSettings;
};

type TeamDbRow = {
  id: number;
  team_name: string;
  user_id: string | null;
  draft_slot: number;
  waiver_priority: number;
  avatar_url: string | null;
  is_ai?: number | boolean;
  ai_persona?: string | null;
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
      `SELECT id, team_name, user_id, draft_slot, waiver_priority, avatar_url, is_ai, ai_persona
       FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
      [membership.leagueId],
    ),
    tidbExecute<{ team_id: number; player_ids: unknown; reserve_ir: unknown; version: number }>(
      `SELECT team_id, player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ?`,
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

  const filledTeams = teamRows.filter(
    (t) => (t.user_id != null && String(t.user_id).length > 0) || asBool(t.is_ai, false),
  ).length;
  const summary = summaryFromParts(membership, league, filledTeams);
  const rosterSlotsRaw = parseRosterSlots(league.roster_slots);
  const slotCounts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);
  const rosterSlots: Record<string, number> = {};
  for (const [k, v] of Object.entries(slotCounts)) {
    if (v != null && v > 0) rosterSlots[k] = v;
  }
  const settingsLocked = summary.draftStatus !== "not_started" && summary.draftStatus !== "scheduled";

  const rosters: NativeRosterRow[] = rosterRows.map((r) => {
    const active = parsePlayerIdList(r.player_ids);
    const ir = parsePlayerIdList(r.reserve_ir);
    return {
      teamId: Number(r.team_id),
      playerIds: [...active, ...ir.filter((id) => !active.includes(id))],
      activePlayerIds: active,
      irPlayerIds: ir,
      version: Number(r.version ?? 1) || 1,
    };
  });
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
      isAi: asBool(t.is_ai, false),
      aiPersona: t.ai_persona == null ? null : String(t.ai_persona),
    })),
    picksPerTeam: countDraftableRosterSpots(rosterSlotsRaw),
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
    rosterSlots,
    rosterCapacity: countActiveRosterCapacity(slotCounts),
    irAllowedStatuses: parseIrAllowedStatuses(rosterSlotsRaw),
    commissioner: commissionerSettingsFromLeague(league, isCommishRole(summary.role)),
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

  await tidbExecute(
    `UPDATE native_teams SET user_id = NULL, is_ai = 0, ai_persona = NULL WHERE id = ? AND league_id = ?`,
    [teamId, membership.leagueId],
  );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("native_league_links")
    .delete()
    .eq("native_league_id", membership.leagueId)
    .eq("user_id", team.user_id);
  return { ok: true };
}

export type NativeCommissionerPatch = {
  name?: string;
  scoringPreset?: NativeScoringPreset;
  scoringSettings?: Record<string, number>;
  draftMode?: NativeDraftMode;
  draftFormat?: string;
  draftOrderType?: string;
  draftPickTimeLimitSec?: number;
  benchSpots?: number;
  irSpots?: number;
  irAllowedStatuses?: NativeIrAllowedStatus[];
  seasonStartWeek?: number;
  isPublic?: boolean;
  autoActivateNextYear?: boolean;
  playoffTeams?: number;
  playoffMatchupLength?: string;
  playoffWeekPair?: string;
  standingsTiebreaker?: string;
  allowMatchupTies?: boolean;
  matchupTiebreakerSlot?: string;
  divisionsEnabled?: boolean;
  waiverType?: string;
  waiverBudget?: number | null;
  waiverPeriodDays?: number;
  postDraftPlayerStatus?: string;
  lockFaOnGametime?: boolean;
  maxAddsPerWeek?: number | null;
  maxAddsPerSeason?: number | null;
  undroppableTopPlayers?: boolean;
  rosterLockType?: string;
  tradeDeadlineWeek?: number | null;
  tradeReviewHours?: number;
  tradeVetoMode?: string;
  maxTradesPerSeason?: number | null;
  keepersPerTeam?: number;
  keeperNote?: string | null;
  teamCount?: number;
  allowAiTeams?: boolean;
};

export async function updateNativeLeagueBasicsForUser(
  userId: string,
  linkId: string,
  input: NativeCommissionerPatch,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  if (!isCommishRole(membership.role)) {
    return { ok: false, error: "Only commissioners can edit league settings" };
  }

  const leagueRows = await tidbExecute<LeagueCoreRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };
  const draftStatus = String(league.draft_status ?? "");
  if (draftStatus !== "not_started" && draftStatus !== "scheduled") {
    return { ok: false, error: "Structural settings lock after the draft starts" };
  }

  const name = input.name != null ? String(input.name).trim().slice(0, 128) : null;
  if (name != null && name.length < 1) return { ok: false, error: "League name is required" };

  const scoringPreset = input.scoringPreset;
  let scoringSettings: Record<string, number> | null = null;
  if (input.scoringSettings && typeof input.scoringSettings === "object") {
    scoringSettings = { ...defaultNativeScoringSettings(), ...input.scoringSettings };
  } else if (scoringPreset === "ppr") scoringSettings = { ...defaultNativeScoringSettings(), rec: 1 };
  else if (scoringPreset === "std") scoringSettings = { ...defaultNativeScoringSettings(), rec: 0 };
  else if (scoringPreset === "half") scoringSettings = defaultNativeScoringSettings();

  const draftMode =
    input.draftMode === "live" || input.draftMode === "offline" ? input.draftMode : null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };

  if (name != null) push("name", name);
  if (scoringPreset && scoringSettings) {
    push("scoring_preset", scoringPreset);
    push("scoring_settings", JSON.stringify(scoringSettings));
  } else if (scoringSettings && !scoringPreset) {
    push("scoring_preset", "custom");
    push("scoring_settings", JSON.stringify(scoringSettings));
  }
  if (draftMode) push("draft_mode", draftMode);
  if (input.draftFormat === "standard" || input.draftFormat === "salary_cap") {
    if (input.draftFormat === "salary_cap") {
      return { ok: false, error: "Salary Cap draft is not available in v1" };
    }
    push("draft_format", input.draftFormat);
  }
  if (input.draftOrderType === "snake" || input.draftOrderType === "linear") {
    push("draft_order_type", input.draftOrderType);
  }
  if (input.draftPickTimeLimitSec != null) {
    push(
      "draft_pick_time_limit_sec",
      Math.max(15, Math.min(600, Math.floor(Number(input.draftPickTimeLimitSec) || 90))),
    );
  }
  if (input.seasonStartWeek != null) {
    push("season_start_week", Math.max(1, Math.min(5, Math.floor(Number(input.seasonStartWeek) || 1))));
  }
  if (input.isPublic != null) push("is_public", input.isPublic ? 1 : 0);
  if (input.autoActivateNextYear != null) {
    push("auto_activate_next_year", input.autoActivateNextYear ? 1 : 0);
  }
  if (input.playoffTeams != null) {
    push("playoff_teams", Math.max(0, Math.min(8, Math.floor(Number(input.playoffTeams) || 0))));
  }
  if (input.playoffMatchupLength != null) {
    push("playoff_matchup_length", String(input.playoffMatchupLength).slice(0, 32));
  }
  if (input.playoffWeekPair != null) {
    push("playoff_week_pair", String(input.playoffWeekPair).slice(0, 16));
  }
  if (input.standingsTiebreaker != null) {
    push("standings_tiebreaker", String(input.standingsTiebreaker).slice(0, 32));
  }
  if (input.allowMatchupTies != null) push("allow_matchup_ties", input.allowMatchupTies ? 1 : 0);
  if (input.matchupTiebreakerSlot != null) {
    push("matchup_tiebreaker_slot", String(input.matchupTiebreakerSlot).slice(0, 8));
  }
  if (input.divisionsEnabled != null) push("divisions_enabled", input.divisionsEnabled ? 1 : 0);
  if (input.waiverType != null) push("waiver_type", String(input.waiverType).slice(0, 16));
  if (input.waiverBudget !== undefined) {
    push("waiver_budget", input.waiverBudget == null ? null : Math.max(0, Math.floor(Number(input.waiverBudget))));
  }
  if (input.waiverPeriodDays != null) {
    push("waiver_period_days", Math.max(0, Math.min(4, Math.floor(Number(input.waiverPeriodDays) || 0))));
  }
  if (input.postDraftPlayerStatus != null) {
    push("post_draft_player_status", String(input.postDraftPlayerStatus).slice(0, 32));
  }
  if (input.lockFaOnGametime != null) push("lock_fa_on_gametime", input.lockFaOnGametime ? 1 : 0);
  if (input.maxAddsPerWeek !== undefined) {
    push(
      "max_adds_per_week",
      input.maxAddsPerWeek == null ? null : Math.max(0, Math.floor(Number(input.maxAddsPerWeek))),
    );
  }
  if (input.maxAddsPerSeason !== undefined) {
    push(
      "max_adds_per_season",
      input.maxAddsPerSeason == null ? null : Math.max(0, Math.floor(Number(input.maxAddsPerSeason))),
    );
  }
  if (input.undroppableTopPlayers != null) {
    push("undroppable_top_players", input.undroppableTopPlayers ? 1 : 0);
  }
  if (input.rosterLockType != null) push("roster_lock_type", String(input.rosterLockType).slice(0, 16));
  if (input.tradeDeadlineWeek !== undefined) {
    push(
      "trade_deadline_week",
      input.tradeDeadlineWeek == null
        ? null
        : Math.max(1, Math.min(18, Math.floor(Number(input.tradeDeadlineWeek)))),
    );
  }
  if (input.tradeReviewHours != null) {
    push("trade_review_hours", Math.max(0, Math.min(168, Math.floor(Number(input.tradeReviewHours) || 0))));
  }
  if (input.tradeVetoMode != null) push("trade_veto_mode", String(input.tradeVetoMode).slice(0, 16));
  if (input.maxTradesPerSeason !== undefined) {
    push(
      "max_trades_per_season",
      input.maxTradesPerSeason == null ? null : Math.max(0, Math.floor(Number(input.maxTradesPerSeason))),
    );
  }
  if (input.keepersPerTeam != null) {
    const k = Math.floor(Number(input.keepersPerTeam) || 0);
    if (k > 0) return { ok: false, error: "Keepers are not enabled in v1 (must be 0)" };
    push("keepers_per_team", 0);
  }
  if (input.keeperNote !== undefined) {
    push("keeper_note", input.keeperNote == null ? null : String(input.keeperNote).slice(0, 2000));
  }
  if (input.teamCount != null) {
    const nextCount = Math.max(4, Math.min(20, Math.floor(Number(input.teamCount) || 10)));
    const current = Number(league.team_count);
    if (nextCount !== current) {
      // Seat resize is a separate flow; reject size changes here for safety.
      return { ok: false, error: "Changing team count is not supported from this screen yet" };
    }
  }
  if (input.allowAiTeams != null) {
    push("allow_ai_teams", input.allowAiTeams ? 1 : 0);
  }

  const touchRoster =
    input.benchSpots != null || input.irSpots != null || input.irAllowedStatuses != null;
  if (touchRoster) {
    const raw = parseRosterSlots(league.roster_slots) ?? {};
    const counts = parseRosterSlotCounts(raw);
    const merged = { ...counts };
    if (input.benchSpots != null) {
      merged.BN = Math.max(0, Math.min(20, Math.floor(Number(input.benchSpots) || 0)));
    }
    if (input.irSpots != null) {
      merged.IR = Math.max(0, Math.min(5, Math.floor(Number(input.irSpots) || 0)));
    }
    const irAllowedStatuses = input.irAllowedStatuses ?? parseIrAllowedStatuses(raw);
    push("roster_slots", JSON.stringify(packRosterSlotsJson(merged, irAllowedStatuses)));
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

export type NativeLineupState = {
  linkId: string;
  leagueId: string;
  teamId: number;
  teamName: string;
  seasonYear: number;
  week: number;
  version: number;
  /** null when no saved lineup yet — client should build a default with catalog positions. */
  slots: NativeLineupSlots | null;
  /** Active + IR reserve combined for the editor. */
  rosterPlayerIds: string[];
  /** Active roster only (excludes IR reserve). */
  activePlayerIds: string[];
  /** IR reserve player ids. */
  irPlayerIds: string[];
  rosterSlots: Record<string, number>;
  irAllowedStatuses: NativeIrAllowedStatus[];
  rosterCapacity: number;
  rosterVersion: number;
  draftComplete: boolean;
  canEdit: boolean;
};

function parseSlotsJson(raw: unknown): NativeLineupSlots | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: NativeLineupSlots = {};
  for (const [key, bucket] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue;
    out[key] = bucket.map((id) => (id == null || id === "" ? null : String(id)));
  }
  return out;
}

export async function getNativeLineupForLink(
  userId: string,
  linkId: string,
  weekInput?: number,
): Promise<NativeLineupState | null> {
  if (!tidbConfigured()) return null;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) return null;

  const leagueRows = await tidbExecute<LeagueCoreRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return null;

  const currentWeek = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
  const week =
    weekInput != null && Number.isFinite(weekInput)
      ? Math.max(1, Math.min(18, Math.round(Number(weekInput))))
      : currentWeek;
  const seasonYear = Number(league.season_year);
  const draftComplete = String(league.draft_status) === "complete";
  const rosterSlotsRaw = parseRosterSlots(league.roster_slots);
  const counts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);
  const rosterSlots: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    if (v != null && v > 0) rosterSlots[k] = v;
  }

  const [teamRows, rosterRows, lineupRows] = await Promise.all([
    tidbExecute<{ id: number; team_name: string }>(
      `SELECT id, team_name FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
      [membership.teamId, membership.leagueId],
    ),
    tidbExecute<{ player_ids: unknown; reserve_ir: unknown; version: number }>(
      `SELECT player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ? AND team_id = ? LIMIT 1`,
      [membership.leagueId, membership.teamId],
    ),
    tidbExecute<{ slots: unknown; version: number }>(
      `SELECT slots, version FROM native_lineups
       WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
       LIMIT 1`,
      [membership.leagueId, membership.teamId, seasonYear, week],
    ),
  ]);
  const team = teamRows[0];
  if (!team) return null;

  const activePlayerIds = parsePlayerIdList(rosterRows[0]?.player_ids);
  const irPlayerIds = parsePlayerIdList(rosterRows[0]?.reserve_ir);
  const rosterPlayerIds = [...activePlayerIds, ...irPlayerIds.filter((id) => !activePlayerIds.includes(id))];
  const lineup = lineupRows[0];
  const slots = lineup ? parseSlotsJson(lineup.slots) : null;

  return {
    linkId: membership.linkId,
    leagueId: membership.leagueId,
    teamId: Number(team.id),
    teamName: String(team.team_name),
    seasonYear,
    week,
    version: Number(lineup?.version ?? 0) || 0,
    slots,
    rosterPlayerIds,
    activePlayerIds,
    irPlayerIds,
    rosterSlots,
    irAllowedStatuses: parseIrAllowedStatuses(rosterSlotsRaw),
    rosterCapacity: countActiveRosterCapacity(counts),
    rosterVersion: Number(rosterRows[0]?.version ?? 1) || 1,
    draftComplete,
    canEdit: draftComplete,
  };
}

export async function saveNativeLineupForUser(
  userId: string,
  linkId: string,
  input: {
    week: number;
    version: number;
    slots: NativeLineupSlots;
    posById: Record<string, string>;
    injuryById?: Record<string, string | null | undefined>;
    /** NFL team by player id for roster lock checks. */
    teamByPlayerId?: Record<string, string | null | undefined>;
  },
): Promise<NativeMutationResult & { version?: number }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) return { ok: false, error: "League not found" };

  const leagueRows = await tidbExecute<LeagueCoreRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };
  if (String(league.draft_status) !== "complete") {
    return { ok: false, error: "Lineups unlock after the draft is complete" };
  }

  const week = Math.max(1, Math.min(18, Math.round(Number(input.week) || 1)));
  const seasonYear = Number(league.season_year);
  const expectedVersion = Math.max(0, Math.floor(Number(input.version) || 0));
  const rosterSlotsRaw = parseRosterSlots(league.roster_slots);
  const counts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);

  const rosterRows = await tidbExecute<{ player_ids: unknown; reserve_ir: unknown; version: number }>(
    `SELECT player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ? AND team_id = ? LIMIT 1`,
    [membership.leagueId, membership.teamId],
  );
  const activeIds = parsePlayerIdList(rosterRows[0]?.player_ids);
  const irIds = parsePlayerIdList(rosterRows[0]?.reserve_ir);
  const rosterPlayerIds = [...activeIds, ...irIds.filter((id) => !activeIds.includes(id))];
  if (rosterPlayerIds.length === 0) {
    return { ok: false, error: "Your roster is empty" };
  }

  const irAllowedStatuses = parseIrAllowedStatuses(rosterSlotsRaw);

  // Preserve locked players (game_time / first_game) before validation.
  const existingLineup = await tidbExecute<{ slots: unknown }>(
    `SELECT slots FROM native_lineups
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
     LIMIT 1`,
    [membership.leagueId, membership.teamId, seasonYear, week],
  );
  const { filterLockedLineupSlots } = await import("@/lib/native-league-gameplay.server");
  const locked = await filterLockedLineupSlots({
    league,
    week,
    nextSlots: input.slots ?? {},
    prevSlots: parseSlotsJson(existingLineup[0]?.slots),
    teamByPlayerId: input.teamByPlayerId ?? {},
  });
  if (!locked.ok) return { ok: false, error: locked.error };

  const validated = validateNativeLineupSlots({
    slots: locked.slots ?? input.slots ?? {},
    counts,
    rosterPlayerIds,
    posById: input.posById ?? {},
    injuryById: input.injuryById ?? {},
    irAllowedStatuses,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const { activePlayerIds, irPlayerIds } = splitActiveAndIrFromSlots(validated.slots);
  const capacity = countActiveRosterCapacity(counts);
  if (activePlayerIds.length > capacity) {
    return {
      ok: false,
      error: "Active roster is over capacity — drop a player or keep someone on IR",
    };
  }

  const existing = await tidbExecute<{ version: number }>(
    `SELECT version FROM native_lineups
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
     LIMIT 1`,
    [membership.leagueId, membership.teamId, seasonYear, week],
  );
  const currentVersion = Number(existing[0]?.version ?? 0) || 0;
  if (currentVersion !== expectedVersion) {
    return { ok: false, error: "Lineup changed elsewhere — reload and try again" };
  }

  const nextVersion = currentVersion + 1;
  try {
    if (currentVersion === 0) {
      await tidbExecute(
        `INSERT INTO native_lineups
           (league_id, team_id, season_year, week, slots, team_total_points, player_points, version)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
        [
          membership.leagueId,
          membership.teamId,
          seasonYear,
          week,
          JSON.stringify(validated.slots),
          nextVersion,
        ],
      );
    } else {
      await tidbExecute(
        `UPDATE native_lineups
         SET slots = ?, version = ?
         WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ? AND version = ?`,
        [
          JSON.stringify(validated.slots),
          nextVersion,
          membership.leagueId,
          membership.teamId,
          seasonYear,
          week,
          expectedVersion,
        ],
      );
      const check = await tidbExecute<{ version: number }>(
        `SELECT version FROM native_lineups
         WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
         LIMIT 1`,
        [membership.leagueId, membership.teamId, seasonYear, week],
      );
      if (Number(check[0]?.version ?? 0) !== nextVersion) {
        return { ok: false, error: "Lineup changed elsewhere — reload and try again" };
      }
    }

    // Keep active / IR reserve in sync so FA capacity reflects open active spots.
    await tidbExecute(
      `UPDATE native_rosters
       SET player_ids = ?, reserve_ir = ?, version = version + 1
       WHERE league_id = ? AND team_id = ?`,
      [
        JSON.stringify(activePlayerIds),
        JSON.stringify(irPlayerIds),
        membership.leagueId,
        membership.teamId,
      ],
    );

    return { ok: true, version: nextVersion };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save lineup";
    return { ok: false, error: message };
  }
}

export type NativeFaMoveResult = NativeMutationResult & {
  rosterVersion?: number;
  openSlots?: number;
  requiresDrop?: boolean;
};

/** Soft-patch current-week lineup JSON after FA add/drop (best-effort). */
export async function syncLineupAfterRosterChange(input: {
  leagueId: string;
  teamId: number;
  seasonYear: number;
  week: number;
  nextPlayerIds: string[];
  droppedPlayerId: string | null;
  addedPlayerId?: string | null;
}): Promise<void> {
  const rows = await tidbExecute<{ slots: unknown; version: number }>(
    `SELECT slots, version FROM native_lineups
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
     LIMIT 1`,
    [input.leagueId, input.teamId, input.seasonYear, input.week],
  );
  const row = rows[0];
  if (!row) return;
  const slots = parseSlotsJson(row.slots);
  if (!slots) return;

  const clearPlayer = (playerId: string) => {
    for (const key of Object.keys(slots)) {
      const bucket = slots[key];
      if (!Array.isArray(bucket)) continue;
      for (let i = 0; i < bucket.length; i++) {
        if (bucket[i] === playerId) bucket[i] = null;
      }
    }
  };

  // Remove dropped player from any slot.
  if (input.droppedPlayerId) clearPlayer(input.droppedPlayerId);

  // Place added player in first empty BN, else first empty non-IR slot.
  // Clear prior slots first so IR → active moves do not leave a duplicate IR row.
  if (input.addedPlayerId) {
    clearPlayer(input.addedPlayerId);
    let placed = false;
    const preferKeys = ["BN", "FLEX", "WRRB", "WRTE", "SFLEX", "QB", "RB", "WR", "TE", "K", "DEF", "TAXI"];
    for (const key of preferKeys) {
      const bucket = slots[key];
      if (!Array.isArray(bucket)) continue;
      for (let i = 0; i < bucket.length; i++) {
        if (bucket[i] == null || bucket[i] === "") {
          bucket[i] = input.addedPlayerId;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      // Ensure added id appears somewhere so My Team validation can recover.
      const bn = slots["BN"] ?? [];
      bn.push(input.addedPlayerId);
      slots["BN"] = bn;
    }
  }

  // Drop any ids no longer on roster.
  const keep = new Set(input.nextPlayerIds);
  for (const key of Object.keys(slots)) {
    const bucket = slots[key];
    if (!Array.isArray(bucket)) continue;
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i];
      if (id && !keep.has(id)) bucket[i] = null;
    }
  }

  await tidbExecute(
    `UPDATE native_lineups SET slots = ?, version = version + 1
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?`,
    [JSON.stringify(slots), input.leagueId, input.teamId, input.seasonYear, input.week],
  );
}

/**
 * Immediate free-agent add. When the active roster is full, `dropPlayerId` is required.
 * Waiver claims are a separate path (not implemented here).
 */
export async function submitNativeFreeAgentMoveForUser(
  userId: string,
  linkId: string,
  input: {
    addPlayerId: string;
    dropPlayerId?: string | null;
    rosterVersion: number;
    /** NFL team abbrev for gametime FA lock (from client catalog). */
    addPlayerTeam?: string | null;
  },
): Promise<NativeFaMoveResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) {
    return { ok: false, error: "Claim a team seat before adding players" };
  }

  const addPlayerId = String(input.addPlayerId ?? "").trim().slice(0, 32);
  const dropPlayerId =
    input.dropPlayerId == null || input.dropPlayerId === ""
      ? null
      : String(input.dropPlayerId).trim().slice(0, 32);
  if (!addPlayerId) return { ok: false, error: "Select a player to add" };
  if (dropPlayerId && dropPlayerId === addPlayerId) {
    return { ok: false, error: "Add and drop players must be different" };
  }

  const leagueRows = await tidbExecute<
    LeagueCoreRow & {
      post_draft_player_status?: string;
      max_adds_per_week?: number | null;
      max_adds_per_season?: number | null;
    }
  >(
    `SELECT ${LEAGUE_CORE_SELECT}, post_draft_player_status, max_adds_per_week, max_adds_per_season
     FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };
  if (String(league.draft_status) !== "complete") {
    return { ok: false, error: "Free-agent adds unlock after the draft is complete" };
  }
  if (String(league.status) === "completed") {
    return { ok: false, error: "This season is complete" };
  }

  const rosterSlotsRaw = parseRosterSlots(league.roster_slots);
  const capacity = countActiveRosterCapacity(rosterSlotsRaw);
  const expectedRosterVersion = Math.max(1, Math.floor(Number(input.rosterVersion) || 1));
  const seasonYear = Number(league.season_year);
  const week = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));

  const { assertFaMoveAllowed } = await import("@/lib/native-league-gameplay.server");
  const faGate = await assertFaMoveAllowed({
    league,
    addPlayerId,
    addPlayerTeam: input.addPlayerTeam ?? null,
    week,
  });
  if (!faGate.ok) return faGate;

  const [rosterRows, lockRows, teamMeta] = await Promise.all([
    tidbExecute<{ player_ids: unknown; reserve_ir: unknown; version: number }>(
      `SELECT player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ? AND team_id = ? LIMIT 1`,
      [membership.leagueId, membership.teamId],
    ),
    tidbExecute<{ player_id: string; held_by_team_id: number | null; lock_reason?: string }>(
      `SELECT player_id, held_by_team_id, lock_reason FROM native_player_locks
       WHERE league_id = ? AND player_id IN (?, ?)`,
      [membership.leagueId, addPlayerId, dropPlayerId ?? addPlayerId],
    ),
    tidbExecute<{ adds_this_week: number; adds_this_season: number }>(
      `SELECT adds_this_week, adds_this_season FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
      [membership.teamId, membership.leagueId],
    ),
  ]);

  const roster = rosterRows[0];
  if (!roster) return { ok: false, error: "Roster not found" };
  const currentVersion = Number(roster.version ?? 1) || 1;
  if (currentVersion !== expectedRosterVersion) {
    return { ok: false, error: "Roster changed elsewhere — reload and try again" };
  }

  const activeIds = parsePlayerIdList(roster.player_ids);
  const irIds = parsePlayerIdList(roster.reserve_ir);
  const allOwned = [...activeIds, ...irIds];
  const openSlots = Math.max(0, capacity - activeIds.length);
  if (allOwned.includes(addPlayerId)) {
    return { ok: false, error: "That player is already on your roster" };
  }

  const addLock = lockRows.find((r) => String(r.player_id) === addPlayerId);
  if (addLock?.held_by_team_id != null) {
    return { ok: false, error: "That player is already rostered in this league" };
  }
  if (dropPlayerId) {
    const dropHold = lockRows.find((r) => String(r.player_id) === dropPlayerId);
    if (dropHold && String(dropHold.lock_reason ?? "") === "trade_hold") {
      return { ok: false, error: "That player is held in a pending trade" };
    }
  }

  // Also verify ownership via any roster (locks can lag).
  const allRosters = await tidbExecute<{ team_id: number; player_ids: unknown; reserve_ir: unknown }>(
    `SELECT team_id, player_ids, reserve_ir FROM native_rosters WHERE league_id = ?`,
    [membership.leagueId],
  );
  for (const row of allRosters) {
    const ids = [...parsePlayerIdList(row.player_ids), ...parsePlayerIdList(row.reserve_ir)];
    if (ids.includes(addPlayerId)) {
      return { ok: false, error: "That player is already rostered in this league" };
    }
  }

  if (openSlots <= 0 && !dropPlayerId) {
    return {
      ok: false,
      error: "Roster is full — choose a player to drop",
      requiresDrop: true,
      openSlots: 0,
    };
  }
  if (dropPlayerId) {
    if (!allOwned.includes(dropPlayerId)) {
      return { ok: false, error: "Drop player must be on your roster" };
    }
    const dropLock = lockRows.find((r) => String(r.player_id) === dropPlayerId);
    if (dropLock && Number(dropLock.held_by_team_id) !== Number(membership.teamId)) {
      return { ok: false, error: "You do not hold that drop player" };
    }
  }

  const maxWeek = league.max_adds_per_week == null ? null : Number(league.max_adds_per_week);
  const maxSeason = league.max_adds_per_season == null ? null : Number(league.max_adds_per_season);
  const addsWeek = Number(teamMeta[0]?.adds_this_week ?? 0) || 0;
  const addsSeason = Number(teamMeta[0]?.adds_this_season ?? 0) || 0;
  if (maxWeek != null && Number.isFinite(maxWeek) && addsWeek >= maxWeek) {
    return { ok: false, error: `Weekly add limit reached (${maxWeek})` };
  }
  if (maxSeason != null && Number.isFinite(maxSeason) && addsSeason >= maxSeason) {
    return { ok: false, error: `Season add limit reached (${maxSeason})` };
  }

  let nextActive = [...activeIds];
  let nextIr = [...irIds];
  if (dropPlayerId) {
    nextActive = nextActive.filter((id) => id !== dropPlayerId);
    nextIr = nextIr.filter((id) => id !== dropPlayerId);
  }
  nextActive = [...nextActive, addPlayerId];
  if (nextActive.length > capacity) {
    return { ok: false, error: "Roster is full — choose a player to drop", requiresDrop: true };
  }

  const nextVersion = currentVersion + 1;
  const nextAll = [...nextActive, ...nextIr];
  try {
    await tidbExecute(
      `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = ?
       WHERE league_id = ? AND team_id = ? AND version = ?`,
      [
        JSON.stringify(nextActive),
        JSON.stringify(nextIr),
        nextVersion,
        membership.leagueId,
        membership.teamId,
        expectedRosterVersion,
      ],
    );
    const verify = await tidbExecute<{ version: number }>(
      `SELECT version FROM native_rosters WHERE league_id = ? AND team_id = ? LIMIT 1`,
      [membership.leagueId, membership.teamId],
    );
    if (Number(verify[0]?.version ?? 0) !== nextVersion) {
      return { ok: false, error: "Roster changed elsewhere — reload and try again" };
    }

    await tidbExecute(
      `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
       VALUES (?, ?, ?, 'roster')
       ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
      [membership.leagueId, addPlayerId, membership.teamId],
    );
    if (dropPlayerId) {
      await tidbExecute(
        `DELETE FROM native_player_locks WHERE league_id = ? AND player_id = ? AND held_by_team_id = ?`,
        [membership.leagueId, dropPlayerId, membership.teamId],
      );
    }

    await tidbExecute(
      `UPDATE native_teams
       SET adds_this_week = adds_this_week + 1, adds_this_season = adds_this_season + 1
       WHERE id = ? AND league_id = ?`,
      [membership.teamId, membership.leagueId],
    );

    await tidbExecute(
      `INSERT INTO native_transactions
         (league_id, team_id, type, status, payload, created_by, processed_at)
       VALUES (?, ?, ?, 'completed', ?, ?, UTC_TIMESTAMP())`,
      [
        membership.leagueId,
        membership.teamId,
        dropPlayerId ? "add_drop" : "add",
        JSON.stringify({
          addPlayerId,
          dropPlayerId,
          week,
          seasonYear,
        }),
        userId,
      ],
    );

    await syncLineupAfterRosterChange({
      leagueId: membership.leagueId,
      teamId: membership.teamId,
      seasonYear,
      week,
      nextPlayerIds: nextAll,
      droppedPlayerId: dropPlayerId,
      addedPlayerId: addPlayerId,
    });

    return {
      ok: true,
      rosterVersion: nextVersion,
      openSlots: Math.max(0, capacity - nextActive.length),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete free-agent move";
    return { ok: false, error: message };
  }
}

/**
 * Resolve an IR occupant who no longer matches commissioner allow-list:
 * - drop: remove that player from the roster
 * - activate: move them to active (requires dropPlayerId when active is full)
 */
export async function resolveNativeIrViolationForUser(
  userId: string,
  linkId: string,
  input: {
    playerId: string;
    action: "drop" | "activate";
    dropPlayerId?: string | null;
    rosterVersion: number;
  },
): Promise<NativeFaMoveResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) {
    return { ok: false, error: "Claim a team seat first" };
  }

  const playerId = String(input.playerId ?? "").trim().slice(0, 32);
  const dropPlayerId =
    input.dropPlayerId == null || input.dropPlayerId === ""
      ? null
      : String(input.dropPlayerId).trim().slice(0, 32);
  if (!playerId) return { ok: false, error: "Select a player" };
  if (input.action !== "drop" && input.action !== "activate") {
    return { ok: false, error: "Invalid IR resolution action" };
  }

  const leagueRows = await tidbExecute<LeagueCoreRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };

  const capacity = countActiveRosterCapacity(parseRosterSlots(league.roster_slots));
  const expectedRosterVersion = Math.max(1, Math.floor(Number(input.rosterVersion) || 1));
  const seasonYear = Number(league.season_year);
  const week = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));

  const rosterRows = await tidbExecute<{ player_ids: unknown; reserve_ir: unknown; version: number }>(
    `SELECT player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ? AND team_id = ? LIMIT 1`,
    [membership.leagueId, membership.teamId],
  );
  const roster = rosterRows[0];
  if (!roster) return { ok: false, error: "Roster not found" };
  const currentVersion = Number(roster.version ?? 1) || 1;
  if (currentVersion !== expectedRosterVersion) {
    return { ok: false, error: "Roster changed elsewhere — reload and try again" };
  }

  let nextActive = parsePlayerIdList(roster.player_ids);
  let nextIr = parsePlayerIdList(roster.reserve_ir);
  if (!nextIr.includes(playerId)) {
    return { ok: false, error: "Player is not on IR" };
  }

  if (input.action === "drop") {
    nextActive = nextActive.filter((id) => id !== playerId);
    nextIr = nextIr.filter((id) => id !== playerId);
  } else {
    // activate: remove from IR, add to active (optionally drop someone else)
    nextIr = nextIr.filter((id) => id !== playerId);
    if (dropPlayerId) {
      if (dropPlayerId === playerId) return { ok: false, error: "Choose a different player to drop" };
      if (!nextActive.includes(dropPlayerId) && !nextIr.includes(dropPlayerId)) {
        return { ok: false, error: "Drop player must be on your roster" };
      }
      nextActive = nextActive.filter((id) => id !== dropPlayerId);
      nextIr = nextIr.filter((id) => id !== dropPlayerId);
    }
    if (!nextActive.includes(playerId)) nextActive = [...nextActive, playerId];
    if (nextActive.length > capacity) {
      return {
        ok: false,
        error: "Active roster is full — choose a player to drop to activate this IR player",
        requiresDrop: true,
        openSlots: 0,
      };
    }
  }

  const nextVersion = currentVersion + 1;
  try {
    await tidbExecute(
      `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = ?
       WHERE league_id = ? AND team_id = ? AND version = ?`,
      [
        JSON.stringify(nextActive),
        JSON.stringify(nextIr),
        nextVersion,
        membership.leagueId,
        membership.teamId,
        expectedRosterVersion,
      ],
    );

    if (input.action === "drop") {
      await tidbExecute(
        `DELETE FROM native_player_locks WHERE league_id = ? AND player_id = ? AND held_by_team_id = ?`,
        [membership.leagueId, playerId, membership.teamId],
      );
    } else if (dropPlayerId) {
      await tidbExecute(
        `DELETE FROM native_player_locks WHERE league_id = ? AND player_id = ? AND held_by_team_id = ?`,
        [membership.leagueId, dropPlayerId, membership.teamId],
      );
    }

    await tidbExecute(
      `INSERT INTO native_transactions
         (league_id, team_id, type, status, payload, created_by, processed_at)
       VALUES (?, ?, ?, 'completed', ?, ?, UTC_TIMESTAMP())`,
      [
        membership.leagueId,
        membership.teamId,
        input.action === "drop" ? "ir_force_drop" : "ir_force_activate",
        JSON.stringify({
          playerId,
          dropPlayerId: input.action === "activate" ? dropPlayerId : null,
          week,
          seasonYear,
        }),
        userId,
      ],
    );

    // Soft-clear lineup slots for removed players; leave manager to re-save lineup.
    await syncLineupAfterRosterChange({
      leagueId: membership.leagueId,
      teamId: membership.teamId,
      seasonYear,
      week,
      nextPlayerIds: [...nextActive, ...nextIr],
      droppedPlayerId: input.action === "drop" ? playerId : dropPlayerId,
      addedPlayerId: input.action === "activate" ? playerId : null,
    });

    return {
      ok: true,
      rosterVersion: nextVersion,
      openSlots: Math.max(0, capacity - nextActive.length),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve IR violation";
    return { ok: false, error: message };
  }
}

export type NativeTransactionRow = {
  id: number;
  teamId: number | null;
  teamName: string | null;
  type: string;
  status: string;
  addPlayerId: string | null;
  dropPlayerId: string | null;
  createdAt: string;
};

export async function listNativeTransactionsForLink(
  userId: string,
  linkId: string,
  limit = 40,
): Promise<NativeTransactionRow[]> {
  if (!tidbConfigured()) return [];
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return [];
  const cap = Math.max(1, Math.min(100, Math.floor(limit)));

  const rows = await tidbExecute<{
    id: number;
    team_id: number | null;
    type: string;
    status: string;
    payload: unknown;
    created_at: string;
    team_name: string | null;
  }>(
    `SELECT t.id, t.team_id, t.type, t.status, t.payload, t.created_at, tm.team_name
     FROM native_transactions t
     LEFT JOIN native_teams tm ON tm.id = t.team_id AND tm.league_id = t.league_id
     WHERE t.league_id = ?
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT ${cap}`,
    [membership.leagueId],
  );

  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    if (typeof r.payload === "string") {
      try {
        payload = JSON.parse(r.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    } else if (r.payload && typeof r.payload === "object") {
      payload = r.payload as Record<string, unknown>;
    }
    return {
      id: Number(r.id),
      teamId: r.team_id == null ? null : Number(r.team_id),
      teamName: r.team_name,
      type: String(r.type),
      status: String(r.status),
      addPlayerId: payload["addPlayerId"] != null ? String(payload["addPlayerId"]) : null,
      dropPlayerId: payload["dropPlayerId"] != null ? String(payload["dropPlayerId"]) : null,
      createdAt: String(r.created_at),
    };
  });
}


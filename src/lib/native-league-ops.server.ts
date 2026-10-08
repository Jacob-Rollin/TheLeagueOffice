/**
 * Server-only native league create / join / admin mutations (TiDB + Supabase links).
 */
import { randomUUID } from "node:crypto";

import {
  generateNativeInviteCode,
  NATIVE_MAX_COMMISSIONER_LEAGUES,
  normalizeNativeLeagueSettings,
  type NativeLeagueSettingsInput,
} from "@/lib/native-league-settings";
import { NATIVE_LEAGUE_TABLE_NAMES } from "@/lib/native-league-ddl.server";
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

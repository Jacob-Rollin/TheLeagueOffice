/**
 * Native-league AI managers (testing): ADP draft picks + weekly lineups.
 *
 * Free-tier rules:
 * - Batch work runs from Actions → /api/cron/native-ai (CRON_SECRET), not page-load Fluid.
 * - One shared memoized player catalog per tick (loadPlayers), no per-team Sleeper fan-out.
 * - Commissioner mutations only toggle seats / trigger a bounded draft/lineup tick.
 */

import {
  aiPick,
  PERSONALITIES,
  randomAiPersona,
  randomAiTeamName,
  type Personality,
} from "@/lib/mock-ai";
import { teamForPick, type Pos, type Scoring, type Settings } from "@/lib/draft";
import { buildAiLineupSlots, type AiLineupPlayerMeta } from "@/lib/native-league-ai-lineup";
import {
  countActiveRosterCapacity,
  parseRosterSlotCounts,
  splitActiveAndIrFromSlots,
  validateNativeLineupSlots,
} from "@/lib/native-league-lineup";
import {
  LEAGUE_CORE_SELECT,
  isCommishRole,
  parsePlayerIdList,
  parseRosterSlots,
  type NativeMutationResult,
} from "@/lib/native-league-ops.server";
import { countDraftableRosterSpots } from "@/lib/native-league-schedule";
import { parseIrAllowedStatuses } from "@/lib/native-league-settings";
import type { Player } from "@/lib/players-build";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

type LeagueAiRow = {
  id: string;
  name: string;
  season_year: number;
  team_count: number;
  current_week: number;
  scoring_preset: string;
  draft_mode: string;
  draft_status: string;
  draft_order_type?: string;
  roster_slots?: string | Record<string, unknown> | null;
  allow_ai_teams?: number | boolean;
  status?: string;
};

type TeamAiRow = {
  id: number;
  team_name: string;
  user_id: string | null;
  draft_slot: number;
  is_ai: number | boolean;
  ai_persona: string | null;
};

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function scoringFromPreset(preset: string): Scoring {
  if (preset === "ppr" || preset === "std" || preset === "half") return preset;
  return "half";
}

async function loadCatalogPlayers(): Promise<Player[]> {
  const { loadPlayers } = await import("@/lib/players.server");
  const payload = await loadPlayers();
  const out = (payload.players ?? []).filter((p) =>
    ["QB", "RB", "WR", "TE", "K", "DEF"].includes(String(p.pos ?? "").toUpperCase()),
  );
  // Prefer ADP board order for the AI pool.
  out.sort((a, b) => (a.adp.half || 999) - (b.adp.half || 999));
  return out;
}

function metaFromCatalog(
  players: Player[],
  scoring: Scoring,
): Record<string, AiLineupPlayerMeta> {
  const out: Record<string, AiLineupPlayerMeta> = {};
  for (const p of players) {
    out[p.id] = {
      pos: p.pos,
      team: p.team,
      bye: p.bye,
      injury: p.injury_status ?? p.injury ?? null,
      rank: p.rank?.[scoring] ?? p.adp?.[scoring] ?? 400,
    };
  }
  return out;
}

async function assertCommishLink(
  userId: string,
  linkId: string,
): Promise<{ leagueId: string; role: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("native_league_links")
    .select("native_league_id, role")
    .eq("id", linkId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  if (!isCommishRole(String(data.role))) return null;
  return { leagueId: String(data.native_league_id), role: String(data.role) };
}

export async function setNativeTeamAiForUser(
  userId: string,
  linkId: string,
  input: { teamId: number; enabled: boolean },
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertCommishLink(userId, linkId);
  if (!membership) return { ok: false, error: "Only commissioners can assign AI managers" };

  const teamId = Number(input.teamId);
  if (!teamId) return { ok: false, error: "Invalid team" };

  const leagueRows = await tidbExecute<LeagueAiRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };
  if (!asBool(league.allow_ai_teams, false) && input.enabled) {
    return { ok: false, error: "Enable AI managers in league settings first" };
  }

  const draftStatus = String(league.draft_status ?? "");
  if (draftStatus !== "not_started" && draftStatus !== "scheduled") {
    return { ok: false, error: "AI seats can only change before the draft starts" };
  }

  const teams = await tidbExecute<TeamAiRow>(
    `SELECT id, team_name, user_id, draft_slot, is_ai, ai_persona
     FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
    [teamId, membership.leagueId],
  );
  const team = teams[0];
  if (!team) return { ok: false, error: "Team not found" };

  if (input.enabled) {
    if (team.user_id) {
      return { ok: false, error: "Open the human seat first before assigning AI" };
    }
    const persona = randomAiPersona();
    const name = String(team.team_name ?? "").startsWith("Team ")
      ? randomAiTeamName()
      : String(team.team_name);
    await tidbExecute(
      `UPDATE native_teams
       SET is_ai = 1, ai_persona = ?, user_id = NULL, team_name = ?
       WHERE id = ? AND league_id = ?`,
      [persona, name.slice(0, 64), teamId, membership.leagueId],
    );
    return { ok: true };
  }

  await tidbExecute(
    `UPDATE native_teams
     SET is_ai = 0, ai_persona = NULL, user_id = NULL,
         team_name = CONCAT('Team ', draft_slot)
     WHERE id = ? AND league_id = ?`,
    [teamId, membership.leagueId],
  );
  return { ok: true };
}

type DraftPickRow = {
  pick_number: number;
  team_id: number;
  player_id: string | null;
  round: number;
};

async function fillAiDraftForLeague(
  league: LeagueAiRow,
  catalog: Player[],
  maxPicks: number,
): Promise<{ picks: number; stoppedReason: string }> {
  if (!asBool(league.allow_ai_teams, false)) {
    return { picks: 0, stoppedReason: "ai_disabled" };
  }
  const draftStatus = String(league.draft_status ?? "");
  if (draftStatus === "complete") return { picks: 0, stoppedReason: "draft_complete" };
  const drafting =
    draftStatus === "not_started" ||
    draftStatus === "live" ||
    draftStatus === "paused" ||
    draftStatus === "scheduled";
  if (!drafting) return { picks: 0, stoppedReason: "not_drafting" };

  const teamRows = await tidbExecute<TeamAiRow>(
    `SELECT id, team_name, user_id, draft_slot, is_ai, ai_persona
     FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
    [league.id],
  );
  const aiTeams = teamRows.filter((t) => asBool(t.is_ai, false));
  if (aiTeams.length === 0) return { picks: 0, stoppedReason: "no_ai_teams" };

  const picksPerTeam = countDraftableRosterSpots(parseRosterSlots(league.roster_slots));
  const teamCount = Math.max(1, Number(league.team_count) || teamRows.length);
  const totalPicks = picksPerTeam * teamCount;
  const snake = String(league.draft_order_type ?? "snake") !== "linear";
  const scoring = scoringFromPreset(String(league.scoring_preset ?? "half"));

  const slotCounts = parseRosterSlotCounts(parseRosterSlots(league.roster_slots) ?? undefined);
  const settings: Settings = {
    teams: teamCount,
    rounds: picksPerTeam,
    myTeam: 1,
    scoring,
    snake,
    roster: {
      QB: Number(slotCounts.QB ?? 1) || 0,
      RB: Number(slotCounts.RB ?? 2) || 0,
      WR: Number(slotCounts.WR ?? 2) || 0,
      TE: Number(slotCounts.TE ?? 1) || 0,
      FLEX: Number(slotCounts.FLEX ?? 1) || 0,
      K: Number(slotCounts.K ?? 1) || 0,
      DEF: Number(slotCounts.DEF ?? 1) || 0,
      BENCH: Number(slotCounts.BN ?? 6) || 0,
    },
    teamNames: {},
  };

  let made = 0;
  let stoppedReason = "done";

  for (let i = 0; i < maxPicks; i++) {
    const existing = await tidbExecute<DraftPickRow>(
      `SELECT pick_number, team_id, player_id, round FROM native_draft_picks
       WHERE league_id = ? ORDER BY pick_number ASC`,
      [league.id],
    );
    const nextPick = existing.length + 1;
    if (nextPick > totalPicks) {
      stoppedReason = "draft_full";
      break;
    }

    const onClockSlot = teamForPick(nextPick, teamCount, snake);
    const onClock = teamRows.find((t) => Number(t.draft_slot) === onClockSlot);
    if (!onClock || !asBool(onClock.is_ai, false)) {
      stoppedReason = "human_on_clock";
      break;
    }

    const teamPickCount = existing.filter((p) => Number(p.team_id) === Number(onClock.id)).length;
    if (teamPickCount >= picksPerTeam) {
      stoppedReason = "ai_roster_full";
      break;
    }

    const drafted = new Set(
      existing.map((p) => String(p.player_id ?? "")).filter(Boolean),
    );
    const available = catalog.filter((p) => !drafted.has(p.id));
    if (available.length === 0) {
      stoppedReason = "board_empty";
      break;
    }

    const rosters = new Map<number, Player[]>();
    const personas: Record<string, Personality> = {};
    for (const t of teamRows) {
      const slot = Number(t.draft_slot);
      const ids = existing
        .filter((p) => Number(p.team_id) === Number(t.id))
        .map((p) => String(p.player_id ?? ""));
      const fromCatalog = ids
        .map((id) => catalog.find((p) => p.id === id))
        .filter((p): p is Player => Boolean(p));
      rosters.set(slot, fromCatalog);
      const personaRaw = String(t.ai_persona ?? "value");
      personas[String(slot)] = (PERSONALITIES as readonly string[]).includes(personaRaw)
        ? (personaRaw as Personality)
        : "value";
    }

    const recentPos: Pos[] = existing
      .slice(-6)
      .map((p) => catalog.find((c) => c.id === String(p.player_id ?? ""))?.pos)
      .filter((p): p is Pos => Boolean(p));

    const choice = aiPick(onClockSlot, available, {
      settings,
      recentPos,
      rosters,
      personas,
      overall: nextPick,
    });
    if (!choice) {
      stoppedReason = "no_pick";
      break;
    }

    const round = Math.floor((nextPick - 1) / teamCount) + 1;
    try {
      if (draftStatus === "not_started" && made === 0 && existing.length === 0) {
        await tidbExecute(
          `UPDATE native_leagues
           SET draft_status = 'live', status = 'drafting', current_draft_pick = ?
           WHERE id = ?`,
          [nextPick, league.id],
        );
      } else {
        await tidbExecute(`UPDATE native_leagues SET current_draft_pick = ? WHERE id = ?`, [
          nextPick,
          league.id,
        ]);
      }
      await tidbExecute(
        `INSERT INTO native_draft_picks
           (league_id, pick_number, round, team_id, player_id, picked_at, source)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'autopick')`,
        [league.id, nextPick, round, Number(onClock.id), choice.id],
      );
      made += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/uq_native_draft_player|Duplicate/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  return { picks: made, stoppedReason };
}

export async function runNativeAiDraftForUser(
  userId: string,
  linkId: string,
  opts?: { maxPicks?: number },
): Promise<NativeMutationResult & { picks?: number; stoppedReason?: string }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertCommishLink(userId, linkId);
  if (!membership) return { ok: false, error: "Only commissioners can run AI draft picks" };

  const leagueRows = await tidbExecute<LeagueAiRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };

  const catalog = await loadCatalogPlayers();
  const maxPicks = Math.max(1, Math.min(80, Math.floor(Number(opts?.maxPicks ?? 40) || 40)));
  const result = await fillAiDraftForLeague(league, catalog, maxPicks);
  return { ok: true, picks: result.picks, stoppedReason: result.stoppedReason };
}

async function applyAiLineupForTeam(input: {
  league: LeagueAiRow;
  teamId: number;
  week: number;
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rosterSlotsRaw = parseRosterSlots(input.league.roster_slots);
  const counts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);
  const irAllowedStatuses = parseIrAllowedStatuses(rosterSlotsRaw);
  if (input.rosterPlayerIds.length === 0) {
    return { ok: false, error: "empty_roster" };
  }

  const slots = buildAiLineupSlots({
    rosterPlayerIds: input.rosterPlayerIds,
    metaById: input.metaById,
    counts,
    week: input.week,
    irAllowedStatuses,
  });

  const posById: Record<string, string> = {};
  const injuryById: Record<string, string | null> = {};
  for (const id of input.rosterPlayerIds) {
    posById[id] = input.metaById[id]?.pos ?? "";
    injuryById[id] = input.metaById[id]?.injury ?? null;
  }

  const validated = validateNativeLineupSlots({
    slots,
    counts,
    rosterPlayerIds: input.rosterPlayerIds,
    posById,
    injuryById,
    irAllowedStatuses,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const { activePlayerIds, irPlayerIds } = splitActiveAndIrFromSlots(validated.slots);
  const capacity = countActiveRosterCapacity(counts);
  if (activePlayerIds.length > capacity) {
    return { ok: false, error: "over_capacity" };
  }

  const seasonYear = Number(input.league.season_year);
  const week = input.week;
  const existing = await tidbExecute<{ version: number }>(
    `SELECT version FROM native_lineups
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
     LIMIT 1`,
    [input.league.id, input.teamId, seasonYear, week],
  );
  const currentVersion = Number(existing[0]?.version ?? 0) || 0;
  const nextVersion = currentVersion + 1;

  if (currentVersion === 0) {
    await tidbExecute(
      `INSERT INTO native_lineups
         (league_id, team_id, season_year, week, slots, team_total_points, player_points, version)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
      [input.league.id, input.teamId, seasonYear, week, JSON.stringify(validated.slots), nextVersion],
    );
  } else {
    await tidbExecute(
      `UPDATE native_lineups
       SET slots = ?, version = ?
       WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?`,
      [
        JSON.stringify(validated.slots),
        nextVersion,
        input.league.id,
        input.teamId,
        seasonYear,
        week,
      ],
    );
  }

  // Keep roster active/IR split aligned with lineup.
  await tidbExecute(
    `UPDATE native_rosters
     SET player_ids = ?, reserve_ir = ?, version = version + 1
     WHERE league_id = ? AND team_id = ?`,
    [
      JSON.stringify(activePlayerIds),
      JSON.stringify(irPlayerIds),
      input.league.id,
      input.teamId,
    ],
  );

  return { ok: true };
}

async function setAiLineupsForLeague(
  league: LeagueAiRow,
  catalog: Player[],
  week: number,
): Promise<{ teams: number; errors: string[] }> {
  if (!asBool(league.allow_ai_teams, false)) return { teams: 0, errors: [] };
  if (String(league.draft_status) !== "complete") return { teams: 0, errors: [] };

  const scoring = scoringFromPreset(String(league.scoring_preset ?? "half"));
  const metaById = metaFromCatalog(catalog, scoring);

  const teamRows = await tidbExecute<TeamAiRow>(
    `SELECT id, team_name, user_id, draft_slot, is_ai, ai_persona
     FROM native_teams WHERE league_id = ? AND is_ai = 1`,
    [league.id],
  );
  let teams = 0;
  const errors: string[] = [];
  for (const team of teamRows) {
    const rosterRows = await tidbExecute<{ player_ids: unknown; reserve_ir: unknown }>(
      `SELECT player_ids, reserve_ir FROM native_rosters
       WHERE league_id = ? AND team_id = ? LIMIT 1`,
      [league.id, Number(team.id)],
    );
    const active = parsePlayerIdList(rosterRows[0]?.player_ids);
    const ir = parsePlayerIdList(rosterRows[0]?.reserve_ir);
    const rosterPlayerIds = [...active, ...ir.filter((id) => !active.includes(id))];
    const result = await applyAiLineupForTeam({
      league,
      teamId: Number(team.id),
      week,
      rosterPlayerIds,
      metaById,
    });
    if (result.ok) teams += 1;
    else errors.push(`team ${team.id}: ${result.error}`);
  }
  return { teams, errors };
}

export async function runNativeAiLineupsForUser(
  userId: string,
  linkId: string,
  opts?: { week?: number },
): Promise<NativeMutationResult & { teams?: number; errors?: string[] }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertCommishLink(userId, linkId);
  if (!membership) return { ok: false, error: "Only commissioners can run AI lineups" };

  const leagueRows = await tidbExecute<LeagueAiRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [membership.leagueId],
  );
  const league = leagueRows[0];
  if (!league) return { ok: false, error: "League not found" };

  const week = Math.max(
    1,
    Math.min(18, Math.round(Number(opts?.week ?? league.current_week ?? 1) || 1)),
  );
  const catalog = await loadCatalogPlayers();
  const result = await setAiLineupsForLeague(league, catalog, week);
  return { ok: true, teams: result.teams, errors: result.errors };
}

/** Actions cron: fill consecutive AI draft picks + set weekly AI lineups. */
export async function processNativeAiCron(opts?: {
  leagueId?: string;
  limit?: number;
  maxPicksPerLeague?: number;
}): Promise<{
  ok: boolean;
  leagues: number;
  draftPicks: number;
  lineups: number;
  errors: string[];
}> {
  if (!tidbConfigured()) {
    return { ok: false, leagues: 0, draftPicks: 0, lineups: 0, errors: ["tidb_unconfigured"] };
  }

  const limit = Math.max(1, Math.min(25, Math.floor(Number(opts?.limit ?? 12) || 12)));
  const maxPicksPerLeague = Math.max(
    1,
    Math.min(60, Math.floor(Number(opts?.maxPicksPerLeague ?? 30) || 30)),
  );

  let leagues: LeagueAiRow[] = [];
  if (opts?.leagueId) {
    leagues = await tidbExecute<LeagueAiRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? AND allow_ai_teams = 1 LIMIT 1`,
      [opts.leagueId],
    );
  } else {
    leagues = await tidbExecute<LeagueAiRow>(
      `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues
       WHERE allow_ai_teams = 1
         AND status IN ('setup', 'drafting', 'in_season')
       ORDER BY updated_at DESC
       LIMIT ?`,
      [limit],
    );
  }

  if (leagues.length === 0) {
    return { ok: true, leagues: 0, draftPicks: 0, lineups: 0, errors: [] };
  }

  const catalog = await loadCatalogPlayers();
  let draftPicks = 0;
  let lineups = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    try {
      const draft = await fillAiDraftForLeague(league, catalog, maxPicksPerLeague);
      draftPicks += draft.picks;

      // Lineups only after completeNativeDraft has materialized rosters.
      const fresh = await tidbExecute<LeagueAiRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
        [league.id],
      );
      const row = fresh[0] ?? league;
      if (String(row.draft_status) === "complete") {
        const week = Math.max(1, Math.min(18, Number(row.current_week ?? 1) || 1));
        const lu = await setAiLineupsForLeague(row, catalog, week);
        lineups += lu.teams;
        for (const e of lu.errors) errors.push(`${league.id}: ${e}`);
      }
    } catch (error) {
      errors.push(
        `${league.id}: ${error instanceof Error ? error.message : "ai_tick_failed"}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    leagues: leagues.length,
    draftPicks,
    lineups,
    errors,
  };
}

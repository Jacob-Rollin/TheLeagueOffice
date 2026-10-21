/**
 * Native-league AI managers (testing): ADP draft picks, starter-hole streamer
 * waivers/FA (any pos), and weekly optimized lineups.
 *
 * Free-tier rules:
 * - Batch work runs from Actions → /api/cron/native-ai (CRON_SECRET), not page-load Fluid.
 * - One shared memoized player catalog + one week-projection bundle per tick
 *   (loadPlayers / Sleeper projections), no per-team Sleeper fan-out.
 * - Commissioner mutations only toggle seats / trigger a bounded draft/lineup tick.
 * - Lineups optimize by weekly projection (same signal as Optimize), still
 *   respecting bye / Out / IR. Kickoff-locked players are pinned exactly like
 *   human Optimize / lineup save (game_time / first_game).
 * - Streamer claims fill bye / Out / missing starter slots (QB–DEF) before waiver
 *   process; immediate FA only when the league is not on follow_waiver_rules
 *   (same assertFaMoveAllowed gate as humans). Full rosters always require a drop;
 *   AI never bypasses waiver routing or roster capacity. Drops prefer least-effective
 *   players without breaking this- or next-week depth. Locked players are never dropped.
 */

import {
  aiPick,
  PERSONALITIES,
  randomAiPersona,
  randomAiTeamName,
  type Personality,
} from "@/lib/mock-ai";
import { teamForPick, type Pos, type Scoring, type Settings } from "@/lib/draft";
import {
  buildAiLineupSlots,
  isUnstartableThisWeek,
  type AiLineupPlayerMeta,
} from "@/lib/native-league-ai-lineup";
import { planAiStreamerClaims } from "@/lib/native-league-ai-waivers";
import {
  countActiveRosterCapacity,
  parseRosterSlotCounts,
  splitActiveAndIrFromSlots,
  starterIdsFromNativeSlots,
  validateNativeLineupSlots,
} from "@/lib/native-league-lineup";
import {
  LEAGUE_CORE_SELECT,
  isCommishRole,
  parsePlayerIdList,
  parseRosterSlots,
  syncLineupAfterRosterChange,
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
  roster_lock_type?: string | null;
  scoring_settings?: string | Record<string, unknown> | null;
  waiver_type?: string | null;
  waiver_period_days?: number | null;
  waiver_budget?: number | null;
  post_draft_player_status?: string | null;
  lock_fa_on_gametime?: number | boolean | null;
  max_adds_per_week?: number | null;
  max_adds_per_season?: number | null;
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
  weeklyProjById?: Record<string, number>,
): Record<string, AiLineupPlayerMeta> {
  const out: Record<string, AiLineupPlayerMeta> = {};
  for (const p of players) {
    const weekly = weeklyProjById?.[p.id];
    out[p.id] = {
      pos: p.pos,
      team: p.team,
      bye: p.bye,
      injury: p.injury_status ?? p.injury ?? null,
      rank: p.rank?.[scoring] ?? p.adp?.[scoring] ?? 400,
      ...(weekly != null && Number.isFinite(weekly) ? { weeklyProj: weekly } : {}),
    };
  }
  return out;
}

function ptsKeyForScoring(scoring: Scoring): "pts_std" | "pts_half_ppr" | "pts_ppr" {
  if (scoring === "ppr") return "pts_ppr";
  if (scoring === "std") return "pts_std";
  return "pts_half_ppr";
}

/**
 * One shared Sleeper week-projection map for the AI tick (preset pts_*).
 * Soft-empty on miss — lineup builder falls back to ADP/rank.
 */
async function loadWeekProjectionPoints(
  season: number,
  week: number,
  scoring: Scoring,
): Promise<Record<string, number>> {
  const { SLEEPER_BASE, positionsQuery } = await import("@/lib/players-build");
  const safeSeason = Math.max(2000, Math.floor(season) || new Date().getUTCFullYear());
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));
  const url = `${SLEEPER_BASE}/projections/nfl/${safeSeason}/${safeWeek}?season_type=regular&${positionsQuery()}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return {};
    const rows = (await res.json()) as unknown;
    const key = ptsKeyForScoring(scoring);
    const out: Record<string, number> = {};
    if (Array.isArray(rows)) {
      for (const row of rows as { player_id?: string; stats?: Record<string, number> }[]) {
        const id = String(row?.player_id ?? "").trim();
        const pts = Number(row?.stats?.[key]);
        if (!id || !Number.isFinite(pts)) continue;
        out[id] = Math.round(pts * 100) / 100;
      }
      return out;
    }
    if (rows && typeof rows === "object") {
      for (const [id, row] of Object.entries(rows as Record<string, { stats?: Record<string, number> }>)) {
        const clean = String(id ?? "").trim();
        const pts = Number(row?.stats?.[key] ?? (row as { [k: string]: unknown })?.[key]);
        if (!clean || !Number.isFinite(pts)) continue;
        out[clean] = Math.round(pts * 100) / 100;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseSlotsJson(raw: unknown): Record<string, Array<string | null>> | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, Array<string | null>> = {};
  for (const [key, bucket] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue;
    out[key] = bucket.map((id) => {
      const s = String(id ?? "").trim();
      return s.length ? s : null;
    });
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

  const teams = await tidbExecute<TeamAiRow>(
    `SELECT id, team_name, user_id, draft_slot, is_ai, ai_persona
     FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
    [teamId, membership.leagueId],
  );
  const team = teams[0];
  if (!team) return { ok: false, error: "Team not found" };

  if (input.enabled) {
    // Testing: commissioners may convert any seat (except their own human seat) to AI anytime.
    if (team.user_id && String(team.user_id) === String(userId)) {
      return { ok: false, error: "Cannot convert your own seat to AI" };
    }
    if (team.user_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("native_league_links")
        .delete()
        .eq("native_league_id", membership.leagueId)
        .eq("user_id", team.user_id);
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

function slotsEqual(a: Record<string, Array<string | null>>, b: Record<string, Array<string | null>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const l = left[i] == null || left[i] === "" ? null : String(left[i]);
      const r = right[i] == null || right[i] === "" ? null : String(right[i]);
      if (l !== r) return false;
    }
  }
  return true;
}

async function applyAiLineupForTeam(input: {
  league: LeagueAiRow;
  teamId: number;
  week: number;
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
}): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  const rosterSlotsRaw = parseRosterSlots(input.league.roster_slots);
  const counts = parseRosterSlotCounts(rosterSlotsRaw ?? undefined);
  const irAllowedStatuses = parseIrAllowedStatuses(rosterSlotsRaw);
  if (input.rosterPlayerIds.length === 0) {
    return { ok: false, error: "empty_roster" };
  }

  const posById: Record<string, string> = {};
  const injuryById: Record<string, string | null> = {};
  const teamByPlayerId: Record<string, string | null> = {};
  for (const id of input.rosterPlayerIds) {
    posById[id] = input.metaById[id]?.pos ?? "";
    injuryById[id] = input.metaById[id]?.injury ?? null;
    teamByPlayerId[id] = input.metaById[id]?.team ?? null;
  }

  const seasonYear = Number(input.league.season_year);
  const week = input.week;
  const existing = await tidbExecute<{ version: number; slots: unknown }>(
    `SELECT version, slots FROM native_lineups
     WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?
     LIMIT 1`,
    [input.league.id, input.teamId, seasonYear, week],
  );
  const currentVersion = Number(existing[0]?.version ?? 0) || 0;
  const nextVersion = currentVersion + 1;
  const previousSlots = parseSlotsJson(existing[0]?.slots);

  // Same kickoff lock rules as human Optimize / lineup save.
  const {
    fetchWeekKickoffsServer,
  } = await import("@/lib/native-league-gameplay.server");
  const { firstGameHasStarted, playerRosterLocked } = await import("@/lib/native-league-locks");
  const kickoffs = await fetchWeekKickoffsServer(week);
  const lockType = String(input.league.roster_lock_type ?? "game_time");

  const priorStarterCount = previousSlots
    ? starterIdsFromNativeSlots(previousSlots).length
    : 0;

  // first_game: freeze once kickoff starts — but still set a lineup when starters
  // are empty (e.g. prior tick left everyone on the bench).
  if (
    lockType === "first_game" &&
    previousSlots &&
    priorStarterCount > 0 &&
    firstGameHasStarted(kickoffs)
  ) {
    return { ok: true, skipped: true };
  }

  const immovableIds = new Set<string>();
  if (previousSlots) {
    for (const bucket of Object.values(previousSlots)) {
      if (!Array.isArray(bucket)) continue;
      for (const raw of bucket) {
        const id = raw == null || raw === "" ? "" : String(raw);
        if (!id) continue;
        // Bye / FA / Out players must be free to move out of the lineup.
        if (isUnstartableThisWeek(input.metaById[id], week)) continue;
        if (
          playerRosterLocked({
            rosterLockType: lockType,
            playerTeam: teamByPlayerId[id],
            kickoffs,
          })
        ) {
          immovableIds.add(id);
        }
      }
    }
  }

  const optimized = buildAiLineupSlots({
    rosterPlayerIds: input.rosterPlayerIds,
    metaById: input.metaById,
    counts,
    week: input.week,
    irAllowedStatuses,
    immovableIds,
    previousSlots,
  });

  // Defense-in-depth: snap any locked placement the optimizer still disturbed.
  const { filterLockedLineupSlots } = await import("@/lib/native-league-gameplay.server");
  const locked = await filterLockedLineupSlots({
    league: input.league as Parameters<typeof filterLockedLineupSlots>[0]["league"],
    week,
    nextSlots: optimized,
    prevSlots: previousSlots,
    teamByPlayerId,
  });
  if (!locked.ok) return { ok: false, error: locked.error ?? "lock_failed" };
  const nextSlots = locked.slots ?? optimized;

  if (previousSlots && slotsEqual(previousSlots, nextSlots)) {
    return { ok: true, skipped: true };
  }

  const validated = validateNativeLineupSlots({
    slots: nextSlots,
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
  const seasonYear = Number(league.season_year) || new Date().getUTCFullYear();
  // One shared week-projection download for every AI team in this league tick.
  const weeklyProjById = await loadWeekProjectionPoints(seasonYear, week, scoring);
  const metaById = metaFromCatalog(catalog, scoring, weeklyProjById);

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
  // Fill bye / Out starter holes via FA/waivers before optimizing lineups.
  const stream = await submitAiStreamerMovesForLeague(league, catalog, week);
  const result = await setAiLineupsForLeague(league, catalog, week);
  return {
    ok: true,
    teams: result.teams,
    errors: [...stream.errors, ...result.errors],
  };
}

function waiversRequired(league: LeagueAiRow): boolean {
  const waiverDays = Math.max(0, Number(league.waiver_period_days ?? 1) || 0);
  const postDraft = String(league.post_draft_player_status ?? "free_agents")
    .trim()
    .toLowerCase();
  return waiverDays > 0 && postDraft === "follow_waiver_rules";
}

async function upsertAiWaiverClaim(input: {
  leagueId: string;
  teamId: number;
  addId: string;
  dropId: string | null;
  bid: number | null;
  priority: number;
}): Promise<"inserted" | "updated" | "skipped"> {
  const existing = await tidbExecute<{ id: number }>(
    `SELECT id FROM native_waiver_claims
     WHERE league_id = ? AND team_id = ? AND player_to_add = ? AND status = 'pending'
     LIMIT 1`,
    [input.leagueId, input.teamId, input.addId],
  );
  if (existing[0]) {
    await tidbExecute(
      `UPDATE native_waiver_claims
       SET player_to_drop = ?, bid_amount = ?, priority_at_submit = ?
       WHERE id = ?`,
      [input.dropId, input.bid, input.priority, existing[0].id],
    );
    return "updated";
  }
  // Cap pending streamer claims per AI team (multi-hole bye weeks).
  const pendingCount = await tidbExecute<{ c: number }>(
    `SELECT COUNT(*) AS c FROM native_waiver_claims
     WHERE league_id = ? AND team_id = ? AND status = 'pending'`,
    [input.leagueId, input.teamId],
  );
  if (Number(pendingCount[0]?.c ?? 0) >= 8) return "skipped";

  await tidbExecute(
    `INSERT INTO native_waiver_claims
       (league_id, team_id, player_to_add, player_to_drop, bid_amount, priority_at_submit, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      input.leagueId,
      input.teamId,
      input.addId,
      input.dropId,
      input.bid,
      input.priority,
    ],
  );
  return "inserted";
}

async function applyAiFreeAgentSwap(input: {
  league: LeagueAiRow;
  teamId: number;
  week: number;
  addId: string;
  dropId: string | null;
  /** NFL team for add player — gametime FA lock (same as human FA). */
  addPlayerTeam?: string | null;
  /** NFL team for drop player — used for kickoff lock (same as human FA). */
  dropPlayerTeam?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Never immediate-add when the league routes players through waivers.
  if (waiversRequired(input.league)) {
    return { ok: false, error: "waivers_required" };
  }
  const { assertFaMoveAllowed } = await import("@/lib/native-league-gameplay.server");
  const gate = await assertFaMoveAllowed({
    league: input.league as Parameters<typeof assertFaMoveAllowed>[0]["league"],
    addPlayerId: input.addId,
    addPlayerTeam: input.addPlayerTeam ?? null,
    week: input.week,
  });
  if (!gate.ok) return { ok: false, error: gate.error ?? "fa_blocked" };

  const capacity = countActiveRosterCapacity(parseRosterSlots(input.league.roster_slots));
  const seasonYear = Number(input.league.season_year);
  const [rosterRows, teamMeta] = await Promise.all([
    tidbExecute<{
      player_ids: unknown;
      reserve_ir: unknown;
      version: number;
    }>(
      `SELECT player_ids, reserve_ir, version FROM native_rosters
       WHERE league_id = ? AND team_id = ? LIMIT 1`,
      [input.league.id, input.teamId],
    ),
    tidbExecute<{ adds_this_week: number; adds_this_season: number }>(
      `SELECT adds_this_week, adds_this_season FROM native_teams
       WHERE id = ? AND league_id = ? LIMIT 1`,
      [input.teamId, input.league.id],
    ),
  ]);
  const roster = rosterRows[0];
  if (!roster) return { ok: false, error: "roster_missing" };

  const maxWeek =
    input.league.max_adds_per_week == null ? null : Number(input.league.max_adds_per_week);
  const maxSeason =
    input.league.max_adds_per_season == null ? null : Number(input.league.max_adds_per_season);
  const addsWeek = Number(teamMeta[0]?.adds_this_week ?? 0) || 0;
  const addsSeason = Number(teamMeta[0]?.adds_this_season ?? 0) || 0;
  if (maxWeek != null && Number.isFinite(maxWeek) && addsWeek >= maxWeek) {
    return { ok: false, error: "weekly_add_limit" };
  }
  if (maxSeason != null && Number.isFinite(maxSeason) && addsSeason >= maxSeason) {
    return { ok: false, error: "season_add_limit" };
  }

  let active = parsePlayerIdList(roster.player_ids);
  let ir = parsePlayerIdList(roster.reserve_ir);
  if (active.includes(input.addId) || ir.includes(input.addId)) {
    return { ok: false, error: "already_owned" };
  }

  // Confirm add is free league-wide.
  const allRosters = await tidbExecute<{ player_ids: unknown; reserve_ir: unknown }>(
    `SELECT player_ids, reserve_ir FROM native_rosters WHERE league_id = ?`,
    [input.league.id],
  );
  for (const row of allRosters) {
    const ids = [...parsePlayerIdList(row.player_ids), ...parsePlayerIdList(row.reserve_ir)];
    if (ids.includes(input.addId)) return { ok: false, error: "player_taken" };
  }

  if (input.dropId) {
    if (!active.includes(input.dropId) && !ir.includes(input.dropId)) {
      return { ok: false, error: "drop_not_owned" };
    }
    const { fetchWeekKickoffsServer } = await import("@/lib/native-league-gameplay.server");
    const { playerRosterLocked } = await import("@/lib/native-league-locks");
    const kickoffs = await fetchWeekKickoffsServer(input.week);
    if (
      playerRosterLocked({
        rosterLockType: String(input.league.roster_lock_type ?? "game_time"),
        playerTeam: input.dropPlayerTeam,
        kickoffs,
      })
    ) {
      return { ok: false, error: "drop_locked" };
    }
    active = active.filter((id) => id !== input.dropId);
    ir = ir.filter((id) => id !== input.dropId);
  } else if (active.length >= capacity) {
    // Human parity: roster full with no drop → reject (no silent overflow).
    return { ok: false, error: "roster_full" };
  }

  active = [...active, input.addId];
  if (active.length > capacity) return { ok: false, error: "over_capacity" };

  const nextVersion = (Number(roster.version ?? 1) || 1) + 1;
  await tidbExecute(
    `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = ?
     WHERE league_id = ? AND team_id = ?`,
    [
      JSON.stringify(active),
      JSON.stringify(ir),
      nextVersion,
      input.league.id,
      input.teamId,
    ],
  );
  await tidbExecute(
    `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
     VALUES (?, ?, ?, 'roster')
     ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
    [input.league.id, input.addId, input.teamId],
  );
  if (input.dropId) {
    await tidbExecute(
      `DELETE FROM native_player_locks WHERE league_id = ? AND player_id = ? AND held_by_team_id = ?`,
      [input.league.id, input.dropId, input.teamId],
    );
  }
  await tidbExecute(
    `UPDATE native_teams SET adds_this_week = adds_this_week + 1,
       adds_this_season = adds_this_season + 1
     WHERE id = ? AND league_id = ?`,
    [input.teamId, input.league.id],
  );
  await tidbExecute(
    `INSERT INTO native_transactions
       (league_id, team_id, type, status, payload, created_by, processed_at)
     VALUES (?, ?, 'free_agent', 'completed', ?, NULL, UTC_TIMESTAMP())`,
    [
      input.league.id,
      input.teamId,
      JSON.stringify({
        addPlayerId: input.addId,
        dropPlayerId: input.dropId,
        week: input.week,
        seasonYear,
        source: "ai_streamer",
      }),
    ],
  );
  await syncLineupAfterRosterChange({
    leagueId: input.league.id,
    teamId: input.teamId,
    seasonYear,
    week: input.week,
    nextPlayerIds: [...active, ...ir],
    droppedPlayerId: input.dropId,
    addedPlayerId: input.addId,
  });
  return { ok: true };
}

/**
 * AI starter-hole streamers: submit waiver claims when the league uses waivers,
 * otherwise immediate FA add/drop. Shared by AI cron and waiver cron (pre-process).
 */
export async function submitAiStreamerMovesForLeague(
  league: LeagueAiRow,
  catalog: Player[],
  week: number,
  weeklyProjById?: Record<string, number>,
): Promise<{ claims: number; faMoves: number; errors: string[] }> {
  if (!asBool(league.allow_ai_teams, false)) return { claims: 0, faMoves: 0, errors: [] };
  if (String(league.draft_status) !== "complete") return { claims: 0, faMoves: 0, errors: [] };
  if (String(league.status) === "completed") return { claims: 0, faMoves: 0, errors: [] };

  const scoring = scoringFromPreset(String(league.scoring_preset ?? "half"));
  const seasonYear = Number(league.season_year) || new Date().getUTCFullYear();
  const proj =
    weeklyProjById ?? (await loadWeekProjectionPoints(seasonYear, week, scoring));
  const metaById = metaFromCatalog(catalog, scoring, proj);
  const counts = parseRosterSlotCounts(parseRosterSlots(league.roster_slots) ?? undefined);
  const starterNeeds = {
    QB: Math.max(0, Number(counts.QB ?? 0) || 0),
    RB: Math.max(0, Number(counts.RB ?? 0) || 0),
    WR: Math.max(0, Number(counts.WR ?? 0) || 0),
    TE: Math.max(0, Number(counts.TE ?? 0) || 0),
    FLEX: Math.max(0, Number(counts.FLEX ?? 0) || 0),
    WRRB: Math.max(0, Number(counts.WRRB ?? 0) || 0),
    WRTE: Math.max(0, Number(counts.WRTE ?? 0) || 0),
    SFLEX: Math.max(0, Number(counts.SFLEX ?? 0) || 0),
    K: Math.max(0, Number(counts.K ?? 0) || 0),
    DEF: Math.max(0, Number(counts.DEF ?? 0) || 0),
  };
  const starterSlotTotal = Object.values(starterNeeds).reduce((n, v) => n + v, 0);
  if (starterSlotTotal <= 0) return { claims: 0, faMoves: 0, errors: [] };

  const capacity = countActiveRosterCapacity(counts);
  const useWaivers = waiversRequired(league);
  const waiverType = String(league.waiver_type ?? "rolling").toLowerCase();
  const lockType = String(league.roster_lock_type ?? "game_time");
  const { fetchWeekKickoffsServer } = await import("@/lib/native-league-gameplay.server");
  const { firstGameHasStarted, playerRosterLocked, nflTeamHasLocked } = await import(
    "@/lib/native-league-locks"
  );
  const kickoffs = await fetchWeekKickoffsServer(week);

  // first_game lock freezes the whole roster for FA drops (same as human lineups).
  if (lockType === "first_game" && firstGameHasStarted(kickoffs)) {
    return { claims: 0, faMoves: 0, errors: [] };
  }

  const teamRows = await tidbExecute<
    TeamAiRow & { waiver_priority?: number; faab_balance?: number | null }
  >(
    `SELECT id, team_name, user_id, draft_slot, is_ai, ai_persona, waiver_priority, faab_balance
     FROM native_teams WHERE league_id = ? AND is_ai = 1`,
    [league.id],
  );
  if (!teamRows.length) return { claims: 0, faMoves: 0, errors: [] };

  const rosterRows = await tidbExecute<{
    team_id: number;
    player_ids: unknown;
    reserve_ir: unknown;
  }>(`SELECT team_id, player_ids, reserve_ir FROM native_rosters WHERE league_id = ?`, [
    league.id,
  ]);
  const ownedLeagueWide = new Set<string>();
  const rosterByTeam = new Map<number, string[]>();
  const activeCountByTeam = new Map<number, number>();
  for (const row of rosterRows) {
    const teamId = Number(row.team_id);
    const active = parsePlayerIdList(row.player_ids);
    const ids = [...active, ...parsePlayerIdList(row.reserve_ir)];
    rosterByTeam.set(teamId, ids);
    activeCountByTeam.set(teamId, active.length);
    for (const id of ids) ownedLeagueWide.add(id);
  }

  const streamerPos = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DST", "D/ST"]);
  const freeAgents = catalog
    .filter((p) => {
      const pos = String(p.pos ?? "").toUpperCase();
      if (!streamerPos.has(pos)) return false;
      if (ownedLeagueWide.has(p.id)) return false;
      const meta = metaById[p.id];
      if (!meta) return false;
      // Never stream a bye / Out / no-team player into the lineup.
      if (isUnstartableThisWeek(meta, week)) return false;
      // Don't add a FA whose NFL game has already locked.
      if (nflTeamHasLocked(p.team, kickoffs)) return false;
      return true;
    })
    .map((p) => ({ id: p.id, meta: metaById[p.id]! }))
    .filter((fa) => fa.meta);

  let claims = 0;
  let faMoves = 0;
  const errors: string[] = [];
  // Avoid two AI teams claiming the same FA in one tick.
  const claimedAdds = new Set<string>();

  for (const team of teamRows) {
    const teamId = Number(team.id);
    const rosterPlayerIds = rosterByTeam.get(teamId) ?? [];
    let activeCount = activeCountByTeam.get(teamId) ?? 0;
    const lockedPlayerIds = new Set<string>();
    for (const id of rosterPlayerIds) {
      // Bye / FA / Out must remain droppable for streamer fills.
      if (isUnstartableThisWeek(metaById[id], week)) continue;
      if (
        playerRosterLocked({
          rosterLockType: lockType,
          playerTeam: metaById[id]?.team,
          kickoffs,
        })
      ) {
        lockedPlayerIds.add(id);
      }
    }
    const plans = planAiStreamerClaims({
      week,
      rosterPlayerIds,
      metaById,
      freeAgents: freeAgents.filter((fa) => !claimedAdds.has(fa.id)),
      starterNeeds,
      activeRosterCount: activeCount,
      rosterCapacity: capacity,
      lockedPlayerIds,
    });

    for (const plan of plans) {
      if (claimedAdds.has(plan.addPlayerId)) continue;
      // Human parity: full roster without a drop is never allowed.
      if (activeCount >= capacity && !plan.dropPlayerId) {
        errors.push(`team ${teamId}: roster_full_needs_drop`);
        continue;
      }
      if (useWaivers) {
        const priority = Number(team.waiver_priority ?? 99) || 99;
        let bid: number | null = null;
        if (waiverType === "faab") {
          const bal = Number(team.faab_balance ?? league.waiver_budget ?? 100) || 0;
          bid = Math.min(1, Math.max(0, Math.floor(bal)));
        }
        try {
          const result = await upsertAiWaiverClaim({
            leagueId: league.id,
            teamId,
            addId: plan.addPlayerId,
            dropId: plan.dropPlayerId,
            bid,
            priority,
          });
          if (result !== "skipped") {
            claims += 1;
            claimedAdds.add(plan.addPlayerId);
            ownedLeagueWide.add(plan.addPlayerId);
            // Pending claims reserve the add; active count only changes on process,
            // but keep local capacity so later plans in this tick still require drops.
            if (!plan.dropPlayerId) activeCount += 1;
            activeCountByTeam.set(teamId, activeCount);
          }
        } catch (error) {
          errors.push(
            `team ${teamId} claim: ${error instanceof Error ? error.message : "claim_failed"}`,
          );
        }
      } else {
        // Immediate FA only when league is not on waiver rules (assertFaMoveAllowed inside).
        const moved = await applyAiFreeAgentSwap({
          league,
          teamId,
          week,
          addId: plan.addPlayerId,
          dropId: plan.dropPlayerId,
          addPlayerTeam: metaById[plan.addPlayerId]?.team ?? null,
          dropPlayerTeam: plan.dropPlayerId
            ? (metaById[plan.dropPlayerId]?.team ?? null)
            : null,
        });
        if (moved.ok) {
          faMoves += 1;
          claimedAdds.add(plan.addPlayerId);
          ownedLeagueWide.add(plan.addPlayerId);
          const prev = rosterByTeam.get(teamId) ?? [];
          const next = plan.dropPlayerId
            ? prev.filter((id) => id !== plan.dropPlayerId)
            : prev.slice();
          next.push(plan.addPlayerId);
          rosterByTeam.set(teamId, next);
          if (!plan.dropPlayerId) activeCount += 1;
          activeCountByTeam.set(teamId, activeCount);
        } else {
          errors.push(`team ${teamId} fa: ${moved.error}`);
        }
      }
    }
  }

  return { claims, faMoves, errors };
}

/** Actions cron: AI draft picks + streamer waivers/FA + weekly optimized lineups. */
export async function processNativeAiCron(opts?: {
  leagueId?: string;
  limit?: number;
  maxPicksPerLeague?: number;
}): Promise<{
  ok: boolean;
  leagues: number;
  draftPicks: number;
  lineups: number;
  waiverClaims: number;
  faMoves: number;
  errors: string[];
}> {
  if (!tidbConfigured()) {
    return {
      ok: false,
      leagues: 0,
      draftPicks: 0,
      lineups: 0,
      waiverClaims: 0,
      faMoves: 0,
      errors: ["tidb_unconfigured"],
    };
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
    return {
      ok: true,
      leagues: 0,
      draftPicks: 0,
      lineups: 0,
      waiverClaims: 0,
      faMoves: 0,
      errors: [],
    };
  }

  const catalog = await loadCatalogPlayers();
  let draftPicks = 0;
  let lineups = 0;
  let waiverClaims = 0;
  let faMoves = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    try {
      const draft = await fillAiDraftForLeague(league, catalog, maxPicksPerLeague);
      draftPicks += draft.picks;

      // Lineups / streamers only after completeNativeDraft has materialized rosters.
      const fresh = await tidbExecute<LeagueAiRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
        [league.id],
      );
      const row = fresh[0] ?? league;
      if (String(row.draft_status) === "complete") {
        const week = Math.max(1, Math.min(18, Number(row.current_week ?? 1) || 1));
        const scoring = scoringFromPreset(String(row.scoring_preset ?? "half"));
        const seasonYear = Number(row.season_year) || new Date().getUTCFullYear();
        const weeklyProjById = await loadWeekProjectionPoints(seasonYear, week, scoring);

        const stream = await submitAiStreamerMovesForLeague(
          row,
          catalog,
          week,
          weeklyProjById,
        );
        waiverClaims += stream.claims;
        faMoves += stream.faMoves;
        for (const e of stream.errors) errors.push(`${league.id}: ${e}`);

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
    waiverClaims,
    faMoves,
    errors,
  };
}

/** Pre-waiver hook: let AI file starter-hole streamer claims before claims are processed. */
export async function submitAiStreamerClaimsForCron(opts?: {
  leagueId?: string;
  limit?: number;
}): Promise<{ leagues: number; claims: number; faMoves: number; errors: string[] }> {
  if (!tidbConfigured()) {
    return { leagues: 0, claims: 0, faMoves: 0, errors: ["tidb_unconfigured"] };
  }
  const limit = Math.max(1, Math.min(40, Math.floor(Number(opts?.limit ?? 20) || 20)));
  const leagues = opts?.leagueId
    ? await tidbExecute<LeagueAiRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? AND allow_ai_teams = 1 LIMIT 1`,
        [opts.leagueId],
      )
    : await tidbExecute<LeagueAiRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues
         WHERE allow_ai_teams = 1
           AND draft_status = 'complete'
           AND status IN ('in_season', 'drafting')
         ORDER BY updated_at DESC
         LIMIT ?`,
        [limit],
      );
  if (!leagues.length) return { leagues: 0, claims: 0, faMoves: 0, errors: [] };

  const catalog = await loadCatalogPlayers();
  let claims = 0;
  let faMoves = 0;
  const errors: string[] = [];
  for (const league of leagues) {
    try {
      const week = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
      const result = await submitAiStreamerMovesForLeague(league, catalog, week);
      claims += result.claims;
      faMoves += result.faMoves;
      for (const e of result.errors) errors.push(`${league.id}: ${e}`);
    } catch (error) {
      errors.push(
        `${league.id}: ${error instanceof Error ? error.message : "streamer_tick_failed"}`,
      );
    }
  }
  return { leagues: leagues.length, claims, faMoves, errors };
}

/**
 * Native league in-season gameplay: waivers, trades, scoring apply, kickoff locks.
 * Schema already exists (native_waiver_claims, native_trades, native_matchup_results).
 */
import {
  nflTeamHasLocked,
  parseScoreboardKickoffs,
  playerRosterLocked,
  type NflTeamKickoff,
} from "@/lib/native-league-locks";
import {
  assertMembershipLink,
  isCommishRole,
  LEAGUE_CORE_SELECT,
  parsePlayerIdList,
  parseRosterSlots,
  parseScoringSettingsJson,
  syncLineupAfterRosterChange,
  type NativeMutationResult,
} from "@/lib/native-league-ops.server";
import { countActiveRosterCapacity } from "@/lib/native-league-lineup";
import { scoreActualLine, type ScoringMap } from "@/lib/scoring-map";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

type LeagueRow = {
  id: string;
  season_year: number;
  current_week?: number;
  status: string;
  draft_status: string;
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
  roster_slots?: string | Record<string, unknown> | null;
  scoring_settings?: string | Record<string, unknown> | null;
  standings_tiebreaker?: string;
  allow_matchup_ties?: number | boolean;
  matchup_tiebreaker_slot?: string;
};

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return fallback;
}

async function loadLeague(leagueId: string): Promise<LeagueRow | null> {
  const rows = await tidbExecute<LeagueRow>(
    `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
    [leagueId],
  );
  return rows[0] ?? null;
}

/** Fetch ESPN scoreboard kickoffs for a week (server-side; cron/mutations). */
export async function fetchWeekKickoffsServer(
  week: number,
): Promise<Map<string, NflTeamKickoff>> {
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${safeWeek}&seasontype=2`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return new Map();
    const json = await res.json();
    return parseScoreboardKickoffs(json);
  } catch {
    return new Map();
  }
}

/** Sleeper week actuals map player_id → stats (server; cron only). */
export async function fetchSleeperWeekStatsServer(
  season: number,
  week: number,
): Promise<Record<string, Record<string, number>>> {
  const safeWeek = Math.max(1, Math.min(18, Math.floor(week) || 1));
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"]
    .map((p) => `position[]=${p}`)
    .join("&");
  const url = `https://api.sleeper.app/v1/stats/nfl/${season}/${safeWeek}?season_type=regular&${positions}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return {};
    const rows = (await res.json()) as Array<{
      player_id?: string;
      stats?: Record<string, number>;
    }>;
    const out: Record<string, Record<string, number>> = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row.player_id ?? "").trim();
      if (!id || !row.stats) continue;
      const stats: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.stats)) {
        const n = Number(v);
        if (Number.isFinite(n)) stats[k] = n;
      }
      out[id] = stats;
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Free-agent / lineup lock gates ─────────────────────────────────────────

export async function assertFaMoveAllowed(input: {
  league: LeagueRow;
  addPlayerId: string;
  addPlayerTeam?: string | null;
  week: number;
}): Promise<NativeMutationResult> {
  const postDraft = String(input.league.post_draft_player_status ?? "free_agents");
  const waiverDays = Math.max(0, Number(input.league.waiver_period_days ?? 1) || 0);
  // When follow_waiver_rules and waivers are active (period > 0), block immediate FA adds.
  if (postDraft === "follow_waiver_rules" && waiverDays > 0) {
    return {
      ok: false,
      error: "This league routes free agents through waivers — submit a waiver claim instead",
    };
  }
  if (asBool(input.league.lock_fa_on_gametime, true) && input.addPlayerTeam) {
    const kickoffs = await fetchWeekKickoffsServer(input.week);
    if (nflTeamHasLocked(input.addPlayerTeam, kickoffs)) {
      return { ok: false, error: "That player’s NFL game has started — FA add is locked" };
    }
  }
  return { ok: true };
}

export async function filterLockedLineupSlots(input: {
  league: LeagueRow;
  week: number;
  nextSlots: Record<string, Array<string | null>>;
  prevSlots: Record<string, Array<string | null>> | null;
  teamByPlayerId: Record<string, string | null | undefined>;
}): Promise<NativeMutationResult & { slots?: Record<string, Array<string | null>> }> {
  const kickoffs = await fetchWeekKickoffsServer(input.week);
  const lockType = String(input.league.roster_lock_type ?? "game_time");
  const prev = input.prevSlots ?? {};
  const next = structuredClone(input.nextSlots);

  // Build previous placement map.
  const prevPlace = new Map<string, { key: string; index: number }>();
  for (const [key, bucket] of Object.entries(prev)) {
    if (!Array.isArray(bucket)) continue;
    bucket.forEach((id, index) => {
      if (id) prevPlace.set(id, { key, index });
    });
  }

  for (const [key, bucket] of Object.entries(next)) {
    if (!Array.isArray(bucket)) continue;
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i];
      if (!id) continue;
      const locked = playerRosterLocked({
        rosterLockType: lockType,
        playerTeam: input.teamByPlayerId[id],
        kickoffs,
      });
      if (!locked) continue;
      const was = prevPlace.get(id);
      // Locked player must stay in the same slot; reject moves.
      if (!was || was.key !== key || was.index !== i) {
        // Restore locked player to previous slot if possible.
        if (was) {
          const prevBucket = next[was.key] ?? [];
          while (prevBucket.length <= was.index) prevBucket.push(null);
          // Clear current erroneous placement.
          bucket[i] = null;
          prevBucket[was.index] = id;
          next[was.key] = prevBucket;
        } else {
          return { ok: false, error: "Cannot move a player whose NFL game has locked" };
        }
      }
    }
  }

  // Also: empty a locked previous slot that lost its player.
  for (const [id, was] of prevPlace) {
    const locked = playerRosterLocked({
      rosterLockType: lockType,
      playerTeam: input.teamByPlayerId[id],
      kickoffs,
    });
    if (!locked) continue;
    const bucket = next[was.key] ?? [];
    if (bucket[was.index] !== id) {
      // Someone swapped them out — put them back.
      for (const [k, b] of Object.entries(next)) {
        if (!Array.isArray(b)) continue;
        for (let i = 0; i < b.length; i++) {
          if (b[i] === id) b[i] = null;
        }
        next[k] = b;
      }
      while (bucket.length <= was.index) bucket.push(null);
      bucket[was.index] = id;
      next[was.key] = bucket;
    }
  }

  return { ok: true, slots: next };
}

// ─── Waivers ────────────────────────────────────────────────────────────────

export type NativeWaiverClaimRow = {
  id: number;
  teamId: number;
  teamName: string | null;
  playerToAdd: string;
  playerToDrop: string | null;
  bidAmount: number | null;
  priorityAtSubmit: number;
  status: string;
  createdAt: string;
};

export async function listNativeWaiverClaimsForLink(
  userId: string,
  linkId: string,
): Promise<{
  claims: NativeWaiverClaimRow[];
  myTeamId: number | null;
  waiverType: string;
  waiverPeriodDays: number;
  postDraftPlayerStatus: string;
  faabBalance: number | null;
  canSubmit: boolean;
}> {
  const empty = {
    claims: [] as NativeWaiverClaimRow[],
    myTeamId: null as number | null,
    waiverType: "rolling",
    waiverPeriodDays: 1,
    postDraftPlayerStatus: "free_agents",
    faabBalance: null as number | null,
    canSubmit: false,
  };
  if (!tidbConfigured()) return empty;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return empty;
  const league = await loadLeague(membership.leagueId);
  if (!league) return empty;

  const [claimRows, teamRows] = await Promise.all([
    tidbExecute<{
      id: number;
      team_id: number;
      player_to_add: string;
      player_to_drop: string | null;
      bid_amount: number | null;
      priority_at_submit: number;
      status: string;
      created_at: string;
      team_name: string | null;
    }>(
      `SELECT c.id, c.team_id, c.player_to_add, c.player_to_drop, c.bid_amount,
              c.priority_at_submit, c.status, c.created_at, t.team_name
       FROM native_waiver_claims c
       LEFT JOIN native_teams t ON t.id = c.team_id AND t.league_id = c.league_id
       WHERE c.league_id = ? AND c.status IN ('pending','won','lost','cancelled')
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 80`,
      [membership.leagueId],
    ),
    membership.teamId != null
      ? tidbExecute<{ faab_balance: number | null }>(
          `SELECT faab_balance FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
          [membership.teamId, membership.leagueId],
        )
      : Promise.resolve([]),
  ]);

  const waiverDays = Math.max(0, Number(league.waiver_period_days ?? 1) || 0);
  const draftDone = String(league.draft_status) === "complete";
  return {
    claims: claimRows.map((r) => ({
      id: Number(r.id),
      teamId: Number(r.team_id),
      teamName: r.team_name,
      playerToAdd: String(r.player_to_add),
      playerToDrop: r.player_to_drop == null ? null : String(r.player_to_drop),
      bidAmount: r.bid_amount == null ? null : Number(r.bid_amount),
      priorityAtSubmit: Number(r.priority_at_submit ?? 0),
      status: String(r.status),
      createdAt: String(r.created_at),
    })),
    myTeamId: membership.teamId,
    waiverType: String(league.waiver_type ?? "rolling"),
    waiverPeriodDays: waiverDays,
    postDraftPlayerStatus: String(league.post_draft_player_status ?? "free_agents"),
    faabBalance: teamRows[0]?.faab_balance == null ? null : Number(teamRows[0].faab_balance),
    canSubmit: draftDone && membership.teamId != null && waiverDays > 0,
  };
}

export async function submitNativeWaiverClaimForUser(
  userId: string,
  linkId: string,
  input: {
    playerToAdd: string;
    playerToDrop?: string | null;
    bidAmount?: number | null;
  },
): Promise<NativeMutationResult & { claimId?: number }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) {
    return { ok: false, error: "Claim a team seat first" };
  }
  const addId = String(input.playerToAdd ?? "").trim().slice(0, 32);
  const dropId =
    input.playerToDrop == null || input.playerToDrop === ""
      ? null
      : String(input.playerToDrop).trim().slice(0, 32);
  if (!addId) return { ok: false, error: "Select a player to claim" };
  if (dropId && dropId === addId) return { ok: false, error: "Add and drop must differ" };

  const league = await loadLeague(membership.leagueId);
  if (!league) return { ok: false, error: "League not found" };
  if (String(league.draft_status) !== "complete") {
    return { ok: false, error: "Waivers unlock after the draft is complete" };
  }
  const waiverDays = Math.max(0, Number(league.waiver_period_days ?? 1) || 0);
  if (waiverDays <= 0) {
    return { ok: false, error: "Waivers are disabled — use free-agent adds instead" };
  }

  const waiverType = String(league.waiver_type ?? "rolling");
  let bid: number | null = null;
  if (waiverType === "faab") {
    bid = Math.max(0, Math.floor(Number(input.bidAmount ?? 0) || 0));
    const team = await tidbExecute<{ faab_balance: number | null }>(
      `SELECT faab_balance FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
      [membership.teamId, membership.leagueId],
    );
    const balance = Number(team[0]?.faab_balance ?? league.waiver_budget ?? 100);
    if (bid > balance) return { ok: false, error: `Bid exceeds FAAB balance (${balance})` };
  }

  // Player must be free.
  const owned = await tidbExecute<{ team_id: number; player_ids: unknown; reserve_ir: unknown }>(
    `SELECT team_id, player_ids, reserve_ir FROM native_rosters WHERE league_id = ?`,
    [membership.leagueId],
  );
  for (const row of owned) {
    const ids = [...parsePlayerIdList(row.player_ids), ...parsePlayerIdList(row.reserve_ir)];
    if (ids.includes(addId)) return { ok: false, error: "Player is already rostered" };
  }

  if (dropId) {
    const mine = owned.find((r) => Number(r.team_id) === membership.teamId);
    const mineIds = [
      ...parsePlayerIdList(mine?.player_ids),
      ...parsePlayerIdList(mine?.reserve_ir),
    ];
    if (!mineIds.includes(dropId)) return { ok: false, error: "Drop player must be on your roster" };
  }

  const priorityRows = await tidbExecute<{ waiver_priority: number }>(
    `SELECT waiver_priority FROM native_teams WHERE id = ? AND league_id = ? LIMIT 1`,
    [membership.teamId, membership.leagueId],
  );
  const priority = Number(priorityRows[0]?.waiver_priority ?? 99) || 99;

  // One pending claim per team+add player.
  const existing = await tidbExecute<{ id: number }>(
    `SELECT id FROM native_waiver_claims
     WHERE league_id = ? AND team_id = ? AND player_to_add = ? AND status = 'pending'
     LIMIT 1`,
    [membership.leagueId, membership.teamId, addId],
  );
  if (existing[0]) {
    await tidbExecute(
      `UPDATE native_waiver_claims
       SET player_to_drop = ?, bid_amount = ?, priority_at_submit = ?
       WHERE id = ?`,
      [dropId, bid, priority, existing[0].id],
    );
    return { ok: true, claimId: Number(existing[0].id) };
  }

  await tidbExecute(
    `INSERT INTO native_waiver_claims
       (league_id, team_id, player_to_add, player_to_drop, bid_amount, priority_at_submit, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [membership.leagueId, membership.teamId, addId, dropId, bid, priority],
  );
  const inserted = await tidbExecute<{ id: number }>(
    `SELECT id FROM native_waiver_claims
     WHERE league_id = ? AND team_id = ? AND player_to_add = ? AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    [membership.leagueId, membership.teamId, addId],
  );
  const claimId = Number(inserted[0]?.id ?? 0);
  return claimId > 0 ? { ok: true, claimId } : { ok: true };
}

export async function cancelNativeWaiverClaimForUser(
  userId: string,
  linkId: string,
  claimId: number,
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) return { ok: false, error: "League not found" };
  const id = Math.floor(Number(claimId) || 0);
  if (!id) return { ok: false, error: "Invalid claim" };
  const rows = await tidbExecute<{ id: number; team_id: number; status: string }>(
    `SELECT id, team_id, status FROM native_waiver_claims
     WHERE id = ? AND league_id = ? LIMIT 1`,
    [id, membership.leagueId],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Claim not found" };
  if (Number(row.team_id) !== membership.teamId && !isCommishRole(membership.role)) {
    return { ok: false, error: "You can only cancel your own claims" };
  }
  if (String(row.status) !== "pending") return { ok: false, error: "Claim is no longer pending" };
  await tidbExecute(
    `UPDATE native_waiver_claims SET status = 'cancelled', processed_at = UTC_TIMESTAMP()
     WHERE id = ? AND league_id = ?`,
    [id, membership.leagueId],
  );
  return { ok: true };
}

/** Cron: process pending waiver claims for all in-season leagues (or one league). */
export async function processNativeWaiversCron(opts?: {
  leagueId?: string;
  limit?: number;
}): Promise<{ ok: boolean; leagues: number; awarded: number; lost: number; error?: string }> {
  if (!tidbConfigured()) return { ok: false, leagues: 0, awarded: 0, lost: 0, error: "TiDB not configured" };
  const limit = Math.max(1, Math.min(40, Math.floor(opts?.limit ?? 20)));
  const leagues = opts?.leagueId
    ? await tidbExecute<LeagueRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
        [opts.leagueId],
      )
    : await tidbExecute<LeagueRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues
         WHERE draft_status = 'complete' AND status IN ('in_season','drafting')
           AND waiver_period_days > 0
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
      );

  let awarded = 0;
  let lost = 0;
  for (const league of leagues) {
    const result = await processWaiverClaimsForLeague(league);
    awarded += result.awarded;
    lost += result.lost;
  }
  return { ok: true, leagues: leagues.length, awarded, lost };
}

async function processWaiverClaimsForLeague(
  league: LeagueRow,
): Promise<{ awarded: number; lost: number }> {
  const leagueId = league.id;
  const waiverType = String(league.waiver_type ?? "rolling");
  const capacity = countActiveRosterCapacity(parseRosterSlots(league.roster_slots));
  const week = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
  const seasonYear = Number(league.season_year);
  const batchId = Date.now();

  const claims = await tidbExecute<{
    id: number;
    team_id: number;
    player_to_add: string;
    player_to_drop: string | null;
    bid_amount: number | null;
    priority_at_submit: number;
  }>(
    `SELECT id, team_id, player_to_add, player_to_drop, bid_amount, priority_at_submit
     FROM native_waiver_claims
     WHERE league_id = ? AND status = 'pending'
     ORDER BY
       ${waiverType === "faab" ? "bid_amount DESC, priority_at_submit ASC, created_at ASC" : "priority_at_submit ASC, created_at ASC"},
       id ASC
     LIMIT 200`,
    [leagueId],
  );
  if (!claims.length) return { awarded: 0, lost: 0 };

  const rosters = await tidbExecute<{
    team_id: number;
    player_ids: unknown;
    reserve_ir: unknown;
    version: number;
  }>(`SELECT team_id, player_ids, reserve_ir, version FROM native_rosters WHERE league_id = ?`, [
    leagueId,
  ]);
  const rosterByTeam = new Map(
    rosters.map((r) => [
      Number(r.team_id),
      {
        active: parsePlayerIdList(r.player_ids),
        ir: parsePlayerIdList(r.reserve_ir),
        version: Number(r.version ?? 1) || 1,
      },
    ]),
  );
  const ownerOf = new Map<string, number>();
  for (const [teamId, r] of rosterByTeam) {
    for (const id of [...r.active, ...r.ir]) ownerOf.set(id, teamId);
  }

  const teams = await tidbExecute<{
    id: number;
    waiver_priority: number;
    faab_balance: number | null;
  }>(`SELECT id, waiver_priority, faab_balance FROM native_teams WHERE league_id = ?`, [leagueId]);
  const teamMeta = new Map(
    teams.map((t) => [
      Number(t.id),
      {
        priority: Number(t.waiver_priority ?? 99),
        faab: t.faab_balance == null ? null : Number(t.faab_balance),
      },
    ]),
  );

  let awarded = 0;
  let lost = 0;
  const awardedTeamsRolling: number[] = [];

  for (const claim of claims) {
    const teamId = Number(claim.team_id);
    const addId = String(claim.player_to_add);
    const dropId = claim.player_to_drop == null ? null : String(claim.player_to_drop);
    const roster = rosterByTeam.get(teamId);
    if (!roster) {
      await markClaim(leagueId, claim.id, "lost", batchId);
      lost++;
      continue;
    }
    if (ownerOf.has(addId)) {
      await markClaim(leagueId, claim.id, "lost", batchId);
      lost++;
      continue;
    }
    if (dropId && !roster.active.includes(dropId) && !roster.ir.includes(dropId)) {
      await markClaim(leagueId, claim.id, "lost", batchId);
      lost++;
      continue;
    }
    const meta = teamMeta.get(teamId);
    if (waiverType === "faab") {
      const bid = Math.max(0, Math.floor(Number(claim.bid_amount ?? 0) || 0));
      const bal = meta?.faab ?? 0;
      if (bid > bal) {
        await markClaim(leagueId, claim.id, "lost", batchId);
        lost++;
        continue;
      }
    }

    let nextActive = [...roster.active];
    let nextIr = [...roster.ir];
    if (dropId) {
      nextActive = nextActive.filter((id) => id !== dropId);
      nextIr = nextIr.filter((id) => id !== dropId);
      ownerOf.delete(dropId);
    }
    if (nextActive.length >= capacity && !dropId) {
      await markClaim(leagueId, claim.id, "lost", batchId);
      lost++;
      continue;
    }
    nextActive = [...nextActive, addId];
    if (nextActive.length > capacity) {
      await markClaim(leagueId, claim.id, "lost", batchId);
      lost++;
      continue;
    }

    const nextVersion = roster.version + 1;
    await tidbExecute(
      `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = ?
       WHERE league_id = ? AND team_id = ?`,
      [JSON.stringify(nextActive), JSON.stringify(nextIr), nextVersion, leagueId, teamId],
    );
    await tidbExecute(
      `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
       VALUES (?, ?, ?, 'roster')
       ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
      [leagueId, addId, teamId],
    );
    if (dropId) {
      await tidbExecute(
        `DELETE FROM native_player_locks WHERE league_id = ? AND player_id = ? AND held_by_team_id = ?`,
        [leagueId, dropId, teamId],
      );
    }
    if (waiverType === "faab" && meta) {
      const bid = Math.max(0, Math.floor(Number(claim.bid_amount ?? 0) || 0));
      const nextBal = Math.max(0, (meta.faab ?? 0) - bid);
      meta.faab = nextBal;
      await tidbExecute(
        `UPDATE native_teams SET faab_balance = ?, adds_this_week = adds_this_week + 1,
           adds_this_season = adds_this_season + 1
         WHERE id = ? AND league_id = ?`,
        [nextBal, teamId, leagueId],
      );
    } else {
      await tidbExecute(
        `UPDATE native_teams SET adds_this_week = adds_this_week + 1,
           adds_this_season = adds_this_season + 1
         WHERE id = ? AND league_id = ?`,
        [teamId, leagueId],
      );
    }
    await tidbExecute(
      `INSERT INTO native_transactions
         (league_id, team_id, type, status, payload, created_by, processed_at)
       VALUES (?, ?, 'waiver_won', 'completed', ?, NULL, UTC_TIMESTAMP())`,
      [
        leagueId,
        teamId,
        JSON.stringify({
          addPlayerId: addId,
          dropPlayerId: dropId,
          bidAmount: claim.bid_amount,
          week,
          seasonYear,
          batchId,
        }),
      ],
    );
    await syncLineupAfterRosterChange({
      leagueId,
      teamId,
      seasonYear,
      week,
      nextPlayerIds: [...nextActive, ...nextIr],
      droppedPlayerId: dropId,
      addedPlayerId: addId,
    });
    await markClaim(leagueId, claim.id, "won", batchId);
    rosterByTeam.set(teamId, { active: nextActive, ir: nextIr, version: nextVersion });
    ownerOf.set(addId, teamId);
    awardedTeamsRolling.push(teamId);
    awarded++;
  }

  // Rolling: move awarded teams to end of priority order.
  if (waiverType === "rolling" && awardedTeamsRolling.length) {
    const ordered = [...teams].sort(
      (a, b) => Number(a.waiver_priority) - Number(b.waiver_priority),
    );
    const remaining = ordered.filter((t) => !awardedTeamsRolling.includes(Number(t.id)));
    const winners = awardedTeamsRolling
      .map((id) => ordered.find((t) => Number(t.id) === id))
      .filter((t): t is (typeof ordered)[number] => Boolean(t));
    const nextOrder = [...remaining, ...winners];
    let p = 1;
    for (const t of nextOrder) {
      await tidbExecute(
        `UPDATE native_teams SET waiver_priority = ? WHERE id = ? AND league_id = ?`,
        [p++, Number(t.id), leagueId],
      );
    }
  }

  // Reverse: rebuild from standings snap when present (worst priority first = highest number).
  if (waiverType === "reverse") {
    const snap = await tidbExecute<{ standings: unknown }>(
      `SELECT standings FROM native_season_standings_snap
       WHERE league_id = ? AND season_year = ?
       ORDER BY as_of_week DESC LIMIT 1`,
      [leagueId, seasonYear],
    );
    const standings = parseStandingsJson(snap[0]?.standings);
    if (standings.length) {
      // Worst record gets priority 1.
      const sorted = [...standings].sort((a, b) => {
        if (a.wins !== b.wins) return a.wins - b.wins;
        if (a.pointsFor !== b.pointsFor) return a.pointsFor - b.pointsFor;
        return a.teamId - b.teamId;
      });
      let p = 1;
      for (const row of sorted) {
        await tidbExecute(
          `UPDATE native_teams SET waiver_priority = ? WHERE id = ? AND league_id = ?`,
          [p++, row.teamId, leagueId],
        );
      }
    }
  }

  return { awarded, lost };
}

async function markClaim(
  leagueId: string,
  claimId: number,
  status: "won" | "lost",
  batchId: number,
): Promise<void> {
  await tidbExecute(
    `UPDATE native_waiver_claims
     SET status = ?, process_batch_id = ?, processed_at = UTC_TIMESTAMP()
     WHERE id = ? AND league_id = ?`,
    [status, batchId, claimId, leagueId],
  );
}

function parseStandingsJson(
  raw: unknown,
): Array<{ teamId: number; wins: number; losses: number; pointsFor: number }> {
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
    .map((row) => ({
      teamId: Number((row as { teamId?: number }).teamId),
      wins: Number((row as { wins?: number }).wins ?? 0),
      losses: Number((row as { losses?: number }).losses ?? 0),
      pointsFor: Number((row as { pointsFor?: number }).pointsFor ?? 0),
    }))
    .filter((r) => Number.isFinite(r.teamId) && r.teamId > 0);
}

// ─── Trades ─────────────────────────────────────────────────────────────────

export type NativeTradeRow = {
  id: number;
  proposerTeamId: number;
  acceptorTeamId: number;
  proposerName: string | null;
  acceptorName: string | null;
  status: string;
  legs: { teamId: number; playerIds: string[] }[];
  proposedAt: string;
  respondBy: string | null;
  vetoUntil: string | null;
  completedAt: string | null;
};

function parseTradeLegs(raw: unknown): { teamId: number; playerIds: string[] }[] {
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
    .map((leg) => ({
      teamId: Number((leg as { teamId?: number }).teamId),
      playerIds: Array.isArray((leg as { playerIds?: unknown }).playerIds)
        ? ((leg as { playerIds: unknown[] }).playerIds)
            .map((id) => String(id ?? "").trim())
            .filter(Boolean)
            .slice(0, 20)
        : [],
    }))
    .filter((l) => l.teamId > 0);
}

export async function listNativeTradesForLink(
  userId: string,
  linkId: string,
): Promise<{
  trades: NativeTradeRow[];
  myTeamId: number | null;
  canPropose: boolean;
  canVeto: boolean;
  tradeDeadlineWeek: number | null;
  tradeReviewHours: number;
  tradeVetoMode: string;
}> {
  const empty = {
    trades: [] as NativeTradeRow[],
    myTeamId: null as number | null,
    canPropose: false,
    canVeto: false,
    tradeDeadlineWeek: null as number | null,
    tradeReviewHours: 24,
    tradeVetoMode: "commissioner",
  };
  if (!tidbConfigured()) return empty;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return empty;
  const league = await loadLeague(membership.leagueId);
  if (!league) return empty;

  const rows = await tidbExecute<{
    id: number;
    proposer_team_id: number;
    acceptor_team_id: number;
    status: string;
    legs: unknown;
    proposed_at: string;
    respond_by: string | null;
    veto_until: string | null;
    completed_at: string | null;
    proposer_name: string | null;
    acceptor_name: string | null;
  }>(
    `SELECT tr.id, tr.proposer_team_id, tr.acceptor_team_id, tr.status, tr.legs,
            tr.proposed_at, tr.respond_by, tr.veto_until, tr.completed_at,
            tp.team_name AS proposer_name, ta.team_name AS acceptor_name
     FROM native_trades tr
     LEFT JOIN native_teams tp ON tp.id = tr.proposer_team_id AND tp.league_id = tr.league_id
     LEFT JOIN native_teams ta ON ta.id = tr.acceptor_team_id AND ta.league_id = tr.league_id
     WHERE tr.league_id = ?
     ORDER BY tr.proposed_at DESC, tr.id DESC
     LIMIT 60`,
    [membership.leagueId],
  );

  const week = Math.max(1, Number(league.current_week ?? 1) || 1);
  const deadline = league.trade_deadline_week == null ? null : Number(league.trade_deadline_week);
  const pastDeadline = deadline != null && week > deadline;
  return {
    trades: rows.map((r) => ({
      id: Number(r.id),
      proposerTeamId: Number(r.proposer_team_id),
      acceptorTeamId: Number(r.acceptor_team_id),
      proposerName: r.proposer_name,
      acceptorName: r.acceptor_name,
      status: String(r.status),
      legs: parseTradeLegs(r.legs),
      proposedAt: String(r.proposed_at),
      respondBy: r.respond_by,
      vetoUntil: r.veto_until,
      completedAt: r.completed_at,
    })),
    myTeamId: membership.teamId,
    canPropose:
      String(league.draft_status) === "complete" &&
      membership.teamId != null &&
      !pastDeadline,
    canVeto: isCommishRole(membership.role),
    tradeDeadlineWeek: deadline,
    tradeReviewHours: Number(league.trade_review_hours ?? 24) || 24,
    tradeVetoMode: String(league.trade_veto_mode ?? "commissioner"),
  };
}

export async function proposeNativeTradeForUser(
  userId: string,
  linkId: string,
  input: {
    acceptorTeamId: number;
    givePlayerIds: string[];
    receivePlayerIds: string[];
  },
): Promise<NativeMutationResult & { tradeId?: number }> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership || membership.teamId == null) return { ok: false, error: "Claim a team seat first" };
  const league = await loadLeague(membership.leagueId);
  if (!league) return { ok: false, error: "League not found" };
  if (String(league.draft_status) !== "complete") {
    return { ok: false, error: "Trades unlock after the draft is complete" };
  }
  const week = Math.max(1, Number(league.current_week ?? 1) || 1);
  const deadline = league.trade_deadline_week == null ? null : Number(league.trade_deadline_week);
  if (deadline != null && week > deadline) {
    return { ok: false, error: "Trade deadline has passed" };
  }

  const acceptorTeamId = Math.floor(Number(input.acceptorTeamId) || 0);
  if (!acceptorTeamId || acceptorTeamId === membership.teamId) {
    return { ok: false, error: "Select a different team to trade with" };
  }
  const give = [...new Set((input.givePlayerIds ?? []).map((id) => String(id).trim()).filter(Boolean))].slice(
    0,
    10,
  );
  const receive = [
    ...new Set((input.receivePlayerIds ?? []).map((id) => String(id).trim()).filter(Boolean)),
  ].slice(0, 10);
  if (!give.length || !receive.length) {
    return { ok: false, error: "Each side must include at least one player" };
  }

  if (league.max_trades_per_season != null) {
    const max = Math.floor(Number(league.max_trades_per_season));
    const countRows = await tidbExecute<{ c: number }>(
      `SELECT COUNT(*) AS c FROM native_trades
       WHERE league_id = ? AND status = 'completed'
         AND (proposer_team_id = ? OR acceptor_team_id = ?)`,
      [membership.leagueId, membership.teamId, membership.teamId],
    );
    if (Number(countRows[0]?.c ?? 0) >= max) {
      return { ok: false, error: `Season trade limit reached (${max})` };
    }
  }

  const rosters = await tidbExecute<{ team_id: number; player_ids: unknown; reserve_ir: unknown }>(
    `SELECT team_id, player_ids, reserve_ir FROM native_rosters
     WHERE league_id = ? AND team_id IN (?, ?)`,
    [membership.leagueId, membership.teamId, acceptorTeamId],
  );
  const mine = rosters.find((r) => Number(r.team_id) === membership.teamId);
  const theirs = rosters.find((r) => Number(r.team_id) === acceptorTeamId);
  if (!mine || !theirs) return { ok: false, error: "Roster not found" };
  const mineIds = new Set([
    ...parsePlayerIdList(mine.player_ids),
    ...parsePlayerIdList(mine.reserve_ir),
  ]);
  const theirIds = new Set([
    ...parsePlayerIdList(theirs.player_ids),
    ...parsePlayerIdList(theirs.reserve_ir),
  ]);
  for (const id of give) {
    if (!mineIds.has(id)) return { ok: false, error: "You can only trade players you own" };
  }
  for (const id of receive) {
    if (!theirIds.has(id)) return { ok: false, error: "Counterpart must own the players you receive" };
  }

  // Block players on trade_hold.
  const allPlayers = [...give, ...receive];
  const holds = await tidbExecute<{ player_id: string }>(
    `SELECT player_id FROM native_player_locks
     WHERE league_id = ? AND lock_reason = 'trade_hold'
       AND player_id IN (${allPlayers.map(() => "?").join(",")})`,
    [membership.leagueId, ...allPlayers],
  );
  if (holds.length) return { ok: false, error: "A player in this trade is already held in another trade" };

  const hours = Math.max(0, Math.min(168, Number(league.trade_review_hours ?? 24) || 24));
  const respondBy =
    hours > 0
      ? new Date(Date.now() + hours * 3600_000).toISOString().slice(0, 19).replace("T", " ")
      : null;

  const legs = [
    { teamId: membership.teamId, playerIds: give },
    { teamId: acceptorTeamId, playerIds: receive },
  ];

  await tidbExecute(
    `INSERT INTO native_trades
       (league_id, proposer_team_id, acceptor_team_id, status, legs, respond_by)
     VALUES (?, ?, ?, 'proposed', ?, ?)`,
    [membership.leagueId, membership.teamId, acceptorTeamId, JSON.stringify(legs), respondBy],
  );
  const inserted = await tidbExecute<{ id: number }>(
    `SELECT id FROM native_trades
     WHERE league_id = ? AND proposer_team_id = ? AND acceptor_team_id = ?
     ORDER BY id DESC LIMIT 1`,
    [membership.leagueId, membership.teamId, acceptorTeamId],
  );
  const tradeId = Number(inserted[0]?.id ?? 0);
  // Soft-hold players so they cannot be dropped/FA'd while proposed.
  for (const id of allPlayers) {
    const holder = give.includes(id) ? membership.teamId : acceptorTeamId;
    await tidbExecute(
      `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
       VALUES (?, ?, ?, 'trade_hold')
       ON DUPLICATE KEY UPDATE lock_reason = 'trade_hold'`,
      [membership.leagueId, id, holder],
    );
  }
  return tradeId > 0 ? { ok: true, tradeId } : { ok: true };
}

export async function respondNativeTradeForUser(
  userId: string,
  linkId: string,
  input: { tradeId: number; action: "accept" | "reject" | "cancel" | "veto" },
): Promise<NativeMutationResult> {
  if (!tidbConfigured()) return { ok: false, error: "Native leagues database is not configured" };
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return { ok: false, error: "League not found" };
  const league = await loadLeague(membership.leagueId);
  if (!league) return { ok: false, error: "League not found" };
  const tradeId = Math.floor(Number(input.tradeId) || 0);
  if (!tradeId) return { ok: false, error: "Invalid trade" };

  const rows = await tidbExecute<{
    id: number;
    proposer_team_id: number;
    acceptor_team_id: number;
    status: string;
    legs: unknown;
  }>(
    `SELECT id, proposer_team_id, acceptor_team_id, status, legs
     FROM native_trades WHERE id = ? AND league_id = ? LIMIT 1`,
    [tradeId, membership.leagueId],
  );
  const trade = rows[0];
  if (!trade) return { ok: false, error: "Trade not found" };
  const status = String(trade.status);
  const legs = parseTradeLegs(trade.legs);
  const allPlayers = legs.flatMap((l) => l.playerIds);

  if (input.action === "cancel") {
    if (Number(trade.proposer_team_id) !== membership.teamId && !isCommishRole(membership.role)) {
      return { ok: false, error: "Only the proposer can cancel" };
    }
    if (status !== "proposed" && status !== "veto_window") {
      return { ok: false, error: "Trade cannot be cancelled" };
    }
    await tidbExecute(
      `UPDATE native_trades SET status = 'cancelled' WHERE id = ? AND league_id = ?`,
      [tradeId, membership.leagueId],
    );
    await clearTradeHolds(membership.leagueId, allPlayers);
    return { ok: true };
  }

  if (input.action === "reject") {
    if (Number(trade.acceptor_team_id) !== membership.teamId) {
      return { ok: false, error: "Only the receiving team can reject" };
    }
    if (status !== "proposed") return { ok: false, error: "Trade is not pending" };
    await tidbExecute(
      `UPDATE native_trades SET status = 'rejected' WHERE id = ? AND league_id = ?`,
      [tradeId, membership.leagueId],
    );
    await clearTradeHolds(membership.leagueId, allPlayers);
    return { ok: true };
  }

  if (input.action === "veto") {
    if (!isCommishRole(membership.role)) return { ok: false, error: "Only commissioners can veto" };
    if (status !== "veto_window" && status !== "proposed" && status !== "accepted") {
      return { ok: false, error: "Trade cannot be vetoed" };
    }
    await tidbExecute(
      `UPDATE native_trades SET status = 'vetoed' WHERE id = ? AND league_id = ?`,
      [tradeId, membership.leagueId],
    );
    await clearTradeHolds(membership.leagueId, allPlayers);
    await tidbExecute(
      `INSERT INTO native_transactions
         (league_id, team_id, type, status, payload, created_by, processed_at)
       VALUES (?, NULL, 'trade_vetoed', 'completed', ?, ?, UTC_TIMESTAMP())`,
      [membership.leagueId, JSON.stringify({ tradeId }), userId],
    );
    return { ok: true };
  }

  // accept
  if (Number(trade.acceptor_team_id) !== membership.teamId) {
    return { ok: false, error: "Only the receiving team can accept" };
  }
  if (status !== "proposed") return { ok: false, error: "Trade is not pending" };

  const vetoMode = String(league.trade_veto_mode ?? "commissioner");
  const hours = Math.max(0, Math.min(168, Number(league.trade_review_hours ?? 24) || 24));

  if (vetoMode === "commissioner" && hours > 0) {
    const vetoUntil = new Date(Date.now() + hours * 3600_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    await tidbExecute(
      `UPDATE native_trades SET status = 'veto_window', veto_until = ? WHERE id = ? AND league_id = ?`,
      [vetoUntil, tradeId, membership.leagueId],
    );
    return { ok: true };
  }

  return commitNativeTrade(membership.leagueId, tradeId, legs, league);
}

async function clearTradeHolds(leagueId: string, playerIds: string[]): Promise<void> {
  if (!playerIds.length) return;
  await tidbExecute(
    `DELETE FROM native_player_locks
     WHERE league_id = ? AND lock_reason = 'trade_hold'
       AND player_id IN (${playerIds.map(() => "?").join(",")})`,
    [leagueId, ...playerIds],
  );
}

async function commitNativeTrade(
  leagueId: string,
  tradeId: number,
  legs: { teamId: number; playerIds: string[] }[],
  league: LeagueRow,
): Promise<NativeMutationResult> {
  if (legs.length < 2) return { ok: false, error: "Invalid trade legs" };
  const a = legs[0]!;
  const b = legs[1]!;
  const week = Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
  const seasonYear = Number(league.season_year);

  const rosters = await tidbExecute<{
    team_id: number;
    player_ids: unknown;
    reserve_ir: unknown;
    version: number;
  }>(
    `SELECT team_id, player_ids, reserve_ir, version FROM native_rosters
     WHERE league_id = ? AND team_id IN (?, ?)`,
    [leagueId, a.teamId, b.teamId],
  );
  const ra = rosters.find((r) => Number(r.team_id) === a.teamId);
  const rb = rosters.find((r) => Number(r.team_id) === b.teamId);
  if (!ra || !rb) return { ok: false, error: "Roster not found" };

  const applySwap = (
    active: string[],
    ir: string[],
    giving: string[],
    receiving: string[],
  ) => {
    let nextActive = active.filter((id) => !giving.includes(id));
    let nextIr = ir.filter((id) => !giving.includes(id));
    // Received players go to active (or BN via lineup sync).
    for (const id of receiving) {
      if (!nextActive.includes(id) && !nextIr.includes(id)) nextActive.push(id);
    }
    return { nextActive, nextIr };
  };

  const swapA = applySwap(
    parsePlayerIdList(ra.player_ids),
    parsePlayerIdList(ra.reserve_ir),
    a.playerIds,
    b.playerIds,
  );
  const swapB = applySwap(
    parsePlayerIdList(rb.player_ids),
    parsePlayerIdList(rb.reserve_ir),
    b.playerIds,
    a.playerIds,
  );

  await tidbExecute(
    `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = version + 1
     WHERE league_id = ? AND team_id = ?`,
    [JSON.stringify(swapA.nextActive), JSON.stringify(swapA.nextIr), leagueId, a.teamId],
  );
  await tidbExecute(
    `UPDATE native_rosters SET player_ids = ?, reserve_ir = ?, version = version + 1
     WHERE league_id = ? AND team_id = ?`,
    [JSON.stringify(swapB.nextActive), JSON.stringify(swapB.nextIr), leagueId, b.teamId],
  );

  // Update ownership locks.
  for (const id of a.playerIds) {
    await tidbExecute(
      `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
       VALUES (?, ?, ?, 'roster')
       ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
      [leagueId, id, b.teamId],
    );
  }
  for (const id of b.playerIds) {
    await tidbExecute(
      `INSERT INTO native_player_locks (league_id, player_id, held_by_team_id, lock_reason)
       VALUES (?, ?, ?, 'roster')
       ON DUPLICATE KEY UPDATE held_by_team_id = VALUES(held_by_team_id), lock_reason = 'roster'`,
      [leagueId, id, a.teamId],
    );
  }

  await tidbExecute(
    `UPDATE native_trades SET status = 'completed', completed_at = UTC_TIMESTAMP()
     WHERE id = ? AND league_id = ?`,
    [tradeId, leagueId],
  );
  await clearTradeHolds(leagueId, [...a.playerIds, ...b.playerIds]);

  await tidbExecute(
    `INSERT INTO native_transactions
       (league_id, team_id, type, status, payload, created_by, processed_at)
     VALUES (?, ?, 'trade', 'completed', ?, NULL, UTC_TIMESTAMP())`,
    [
      leagueId,
      a.teamId,
      JSON.stringify({
        tradeId,
        legs,
        week,
        seasonYear,
      }),
    ],
  );

  await syncLineupAfterRosterChange({
    leagueId,
    teamId: a.teamId,
    seasonYear,
    week,
    nextPlayerIds: [...swapA.nextActive, ...swapA.nextIr],
    droppedPlayerId: a.playerIds[0] ?? null,
    addedPlayerId: b.playerIds[0] ?? null,
  });
  await syncLineupAfterRosterChange({
    leagueId,
    teamId: b.teamId,
    seasonYear,
    week,
    nextPlayerIds: [...swapB.nextActive, ...swapB.nextIr],
    droppedPlayerId: b.playerIds[0] ?? null,
    addedPlayerId: a.playerIds[0] ?? null,
  });

  return { ok: true };
}

/** Cron: complete veto_window trades whose veto_until has passed. */
export async function processNativeTradeVetoWindowsCron(opts?: {
  limit?: number;
}): Promise<{ ok: boolean; completed: number; error?: string }> {
  if (!tidbConfigured()) return { ok: false, completed: 0, error: "TiDB not configured" };
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 40)));
  const rows = await tidbExecute<{
    id: number;
    league_id: string;
    legs: unknown;
  }>(
    `SELECT id, league_id, legs FROM native_trades
     WHERE status = 'veto_window' AND veto_until IS NOT NULL AND veto_until <= UTC_TIMESTAMP()
     ORDER BY veto_until ASC
     LIMIT ${limit}`,
  );
  let completed = 0;
  for (const row of rows) {
    const league = await loadLeague(String(row.league_id));
    if (!league) continue;
    const result = await commitNativeTrade(
      String(row.league_id),
      Number(row.id),
      parseTradeLegs(row.legs),
      league,
    );
    if (result.ok) completed++;
  }
  return { ok: true, completed };
}

// ─── Scoring + standings ────────────────────────────────────────────────────

export type NativeMatchupView = {
  week: number;
  seasonYear: number;
  matchupId: number;
  home: {
    teamId: number;
    teamName: string;
    points: number;
    playerPoints: Record<string, number>;
  };
  away: {
    teamId: number;
    teamName: string;
    points: number;
    playerPoints: Record<string, number>;
  };
};

export type NativeStandingRow = {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
};

export async function getNativeMatchupWeekForLink(
  userId: string,
  linkId: string,
  weekInput?: number,
): Promise<{
  week: number;
  seasonYear: number;
  matchups: NativeMatchupView[];
  myTeamId: number | null;
  /** League scoring map for client-side live overlay (native Matchup only). */
  scoringSettings: Record<string, number>;
  /** Starter sleeper ids by team id (from week lineups, else last scored snap). */
  startersByTeamId: Record<string, string[]>;
} | null> {
  if (!tidbConfigured()) return null;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return null;
  const league = await loadLeague(membership.leagueId);
  if (!league) return null;
  const week =
    weekInput != null && Number.isFinite(weekInput)
      ? Math.max(1, Math.min(18, Math.round(Number(weekInput))))
      : Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
  const seasonYear = Number(league.season_year);

  const [sched, results, teams, lineups] = await Promise.all([
    tidbExecute<{
      matchup_id: number;
      home_team_id: number;
      away_team_id: number;
    }>(
      `SELECT matchup_id, home_team_id, away_team_id FROM native_schedules
       WHERE league_id = ? AND season_year = ? AND week = ?
       ORDER BY matchup_id ASC`,
      [membership.leagueId, seasonYear, week],
    ),
    tidbExecute<{
      team_id: number;
      points: number;
      player_points: unknown;
      matchup_id: number | null;
      starters: unknown;
    }>(
      `SELECT team_id, points, player_points, matchup_id, starters FROM native_matchup_results
       WHERE league_id = ? AND season_year = ? AND week = ?`,
      [membership.leagueId, seasonYear, week],
    ),
    tidbExecute<{ id: number; team_name: string }>(
      `SELECT id, team_name FROM native_teams WHERE league_id = ?`,
      [membership.leagueId],
    ),
    tidbExecute<{ team_id: number; slots: unknown }>(
      `SELECT team_id, slots FROM native_lineups
       WHERE league_id = ? AND season_year = ? AND week = ?`,
      [membership.leagueId, seasonYear, week],
    ),
  ]);

  const nameById = new Map(teams.map((t) => [Number(t.id), String(t.team_name)]));
  const resultByTeam = new Map(
    results.map((r) => [
      Number(r.team_id),
      {
        points: Number(r.points ?? 0),
        playerPoints: parsePlayerPoints(r.player_points),
        starters: parseStarterIdList(r.starters),
      },
    ]),
  );
  const startersByTeamId: Record<string, string[]> = {};
  for (const row of lineups) {
    const ids = extractStarterIds(row.slots);
    if (ids.length) startersByTeamId[String(row.team_id)] = ids;
  }
  for (const [teamId, row] of resultByTeam) {
    if (!startersByTeamId[String(teamId)]?.length && row.starters.length) {
      startersByTeamId[String(teamId)] = row.starters;
    }
  }

  return {
    week,
    seasonYear,
    myTeamId: membership.teamId,
    scoringSettings: parseScoringSettingsJson(league.scoring_settings),
    startersByTeamId,
    matchups: sched.map((s) => {
      const homeId = Number(s.home_team_id);
      const awayId = Number(s.away_team_id);
      const home = resultByTeam.get(homeId) ?? { points: 0, playerPoints: {}, starters: [] };
      const away = resultByTeam.get(awayId) ?? { points: 0, playerPoints: {}, starters: [] };
      return {
        week,
        seasonYear,
        matchupId: Number(s.matchup_id),
        home: {
          teamId: homeId,
          teamName: nameById.get(homeId) ?? `Team ${homeId}`,
          points: home.points,
          playerPoints: home.playerPoints,
        },
        away: {
          teamId: awayId,
          teamName: nameById.get(awayId) ?? `Team ${awayId}`,
          points: away.points,
          playerPoints: away.playerPoints,
        },
      };
    }),
  };
}

function parseStarterIdList(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((id) => String(id ?? "").trim()).filter(Boolean);
}

function parsePlayerPoints(raw: unknown): Record<string, number> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export async function getNativeStandingsForLink(
  userId: string,
  linkId: string,
): Promise<{ week: number; standings: NativeStandingRow[] } | null> {
  if (!tidbConfigured()) return null;
  const membership = await assertMembershipLink(userId, linkId);
  if (!membership) return null;
  const league = await loadLeague(membership.leagueId);
  if (!league) return null;
  const seasonYear = Number(league.season_year);
  const week = Math.max(1, Number(league.current_week ?? 1) || 1);

  const snap = await tidbExecute<{ as_of_week: number; standings: unknown }>(
    `SELECT as_of_week, standings FROM native_season_standings_snap
     WHERE league_id = ? AND season_year = ?
     ORDER BY as_of_week DESC LIMIT 1`,
    [membership.leagueId, seasonYear],
  );
  if (snap[0]) {
    const rows = parseStandingsFull(snap[0].standings);
    if (rows.length) {
      return { week: Number(snap[0].as_of_week) || week, standings: rows };
    }
  }

  // Soft-empty standings from teams list when no snap yet.
  const teams = await tidbExecute<{ id: number; team_name: string }>(
    `SELECT id, team_name FROM native_teams WHERE league_id = ? ORDER BY draft_slot ASC`,
    [membership.leagueId],
  );
  return {
    week,
    standings: teams.map((t, i) => ({
      teamId: Number(t.id),
      teamName: String(t.team_name),
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      rank: i + 1,
    })),
  };
}

function parseStandingsFull(raw: unknown): NativeStandingRow[] {
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
    .map((row, i) => ({
      teamId: Number((row as { teamId?: number }).teamId),
      teamName: String((row as { teamName?: string }).teamName ?? ""),
      wins: Number((row as { wins?: number }).wins ?? 0),
      losses: Number((row as { losses?: number }).losses ?? 0),
      ties: Number((row as { ties?: number }).ties ?? 0),
      pointsFor: Number((row as { pointsFor?: number }).pointsFor ?? 0),
      pointsAgainst: Number((row as { pointsAgainst?: number }).pointsAgainst ?? 0),
      rank: Number((row as { rank?: number }).rank ?? i + 1),
    }))
    .filter((r) => r.teamId > 0);
}

/**
 * Cron modes for native scoring (live Matchup overlay is separate — snap-cdn).
 * - points: write week fantasy totals to TiDB (infrequent; not needed for live UI)
 * - standings: finalize W–L / PF / PA snap from stored week results (weekly)
 * - both: points then standings (Tue finalize / manual)
 */
export async function processNativeScoringCron(opts?: {
  leagueId?: string;
  week?: number;
  limit?: number;
  mode?: "points" | "standings" | "both";
}): Promise<{
  ok: boolean;
  leagues: number;
  teamsScored: number;
  standingsUpdated: number;
  mode: "points" | "standings" | "both";
  error?: string;
}> {
  const mode = opts?.mode === "standings" || opts?.mode === "both" ? opts.mode : "points";
  if (!tidbConfigured()) {
    return {
      ok: false,
      leagues: 0,
      teamsScored: 0,
      standingsUpdated: 0,
      mode,
      error: "TiDB not configured",
    };
  }
  const limit = Math.max(1, Math.min(40, Math.floor(opts?.limit ?? 15)));
  const leagues = opts?.leagueId
    ? await tidbExecute<LeagueRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues WHERE id = ? LIMIT 1`,
        [opts.leagueId],
      )
    : await tidbExecute<LeagueRow>(
        `SELECT ${LEAGUE_CORE_SELECT} FROM native_leagues
         WHERE draft_status = 'complete' AND status IN ('in_season','drafting')
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
      );

  let teamsScored = 0;
  let standingsUpdated = 0;
  const statsCache = new Map<string, Record<string, Record<string, number>>>();
  const writePoints = mode === "points" || mode === "both";
  const writeStandings = mode === "standings" || mode === "both";

  for (const league of leagues) {
    const week =
      opts?.week != null
        ? Math.max(1, Math.min(18, Math.round(Number(opts.week))))
        : Math.max(1, Math.min(18, Number(league.current_week ?? 1) || 1));
    const seasonYear = Number(league.season_year);

    if (writePoints) {
      const cacheKey = `${seasonYear}:${week}`;
      let stats = statsCache.get(cacheKey);
      if (!stats) {
        stats = await fetchSleeperWeekStatsServer(seasonYear, week);
        statsCache.set(cacheKey, stats);
      }
      teamsScored += await scoreLeagueWeek(league, week, stats);
    }

    if (writeStandings) {
      // Prefer a fresh points write when finalizing so W–L uses complete week totals.
      if (!writePoints) {
        const cacheKey = `${seasonYear}:${week}`;
        let stats = statsCache.get(cacheKey);
        if (!stats) {
          stats = await fetchSleeperWeekStatsServer(seasonYear, week);
          statsCache.set(cacheKey, stats);
        }
        teamsScored += await scoreLeagueWeek(league, week, stats);
      }
      await materializeStandingsSnap(league, week);
      standingsUpdated += 1;
    }
  }
  return { ok: true, leagues: leagues.length, teamsScored, standingsUpdated, mode };
}

async function scoreLeagueWeek(
  league: LeagueRow,
  week: number,
  statsByPlayer: Record<string, Record<string, number>>,
): Promise<number> {
  const leagueId = league.id;
  const seasonYear = Number(league.season_year);
  const scoring = parseScoringSettingsJson(league.scoring_settings) as ScoringMap;

  const [lineups, schedules, teams] = await Promise.all([
    tidbExecute<{ team_id: number; slots: unknown }>(
      `SELECT team_id, slots FROM native_lineups
       WHERE league_id = ? AND season_year = ? AND week = ?`,
      [leagueId, seasonYear, week],
    ),
    tidbExecute<{
      matchup_id: number;
      home_team_id: number;
      away_team_id: number;
    }>(
      `SELECT matchup_id, home_team_id, away_team_id FROM native_schedules
       WHERE league_id = ? AND season_year = ? AND week = ?`,
      [leagueId, seasonYear, week],
    ),
    tidbExecute<{ id: number }>(`SELECT id FROM native_teams WHERE league_id = ?`, [leagueId]),
  ]);

  const lineupByTeam = new Map(lineups.map((l) => [Number(l.team_id), l.slots]));
  const matchupOf = new Map<number, { matchupId: number; opponentId: number }>();
  for (const s of schedules) {
    matchupOf.set(Number(s.home_team_id), {
      matchupId: Number(s.matchup_id),
      opponentId: Number(s.away_team_id),
    });
    matchupOf.set(Number(s.away_team_id), {
      matchupId: Number(s.matchup_id),
      opponentId: Number(s.home_team_id),
    });
  }

  let scored = 0;
  for (const team of teams) {
    const teamId = Number(team.id);
    const slotsRaw = lineupByTeam.get(teamId);
    const starters = extractStarterIds(slotsRaw);
    const playerPoints: Record<string, number> = {};
    let total = 0;
    for (const playerId of starters) {
      const pts = scoreActualLine(statsByPlayer[playerId] ?? null, scoring) ?? 0;
      playerPoints[playerId] = pts;
      total += pts;
    }
    total = Math.round(total * 100) / 100;
    const meta = matchupOf.get(teamId);

    await tidbExecute(
      `UPDATE native_lineups
       SET team_total_points = ?, player_points = ?
       WHERE league_id = ? AND team_id = ? AND season_year = ? AND week = ?`,
      [total, JSON.stringify(playerPoints), leagueId, teamId, seasonYear, week],
    );

    await tidbExecute(
      `INSERT INTO native_matchup_results
         (league_id, season_year, week, team_id, matchup_id, points, projected_points,
          opponent_team_id, starters, player_points, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         points = VALUES(points),
         matchup_id = VALUES(matchup_id),
         opponent_team_id = VALUES(opponent_team_id),
         starters = VALUES(starters),
         player_points = VALUES(player_points),
         updated_at = UTC_TIMESTAMP()`,
      [
        leagueId,
        seasonYear,
        week,
        teamId,
        meta?.matchupId ?? null,
        total,
        meta?.opponentId ?? null,
        JSON.stringify(starters),
        JSON.stringify(playerPoints),
      ],
    );
    scored++;
  }
  return scored;
}

function extractStarterIds(slotsRaw: unknown): string[] {
  let slots: unknown = slotsRaw;
  if (typeof slotsRaw === "string") {
    try {
      slots = JSON.parse(slotsRaw);
    } catch {
      return [];
    }
  }
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return [];
  const out: string[] = [];
  for (const [key, bucket] of Object.entries(slots as Record<string, unknown>)) {
    if (key === "BN" || key === "IR" || key === "TAXI") continue;
    if (!Array.isArray(bucket)) continue;
    for (const id of bucket) {
      if (id) out.push(String(id));
    }
  }
  return out;
}

async function materializeStandingsSnap(league: LeagueRow, asOfWeek: number): Promise<void> {
  const leagueId = league.id;
  const seasonYear = Number(league.season_year);
  const allowTies = asBool(league.allow_matchup_ties, false);

  const [teams, results, schedules] = await Promise.all([
    tidbExecute<{ id: number; team_name: string }>(
      `SELECT id, team_name FROM native_teams WHERE league_id = ?`,
      [leagueId],
    ),
    tidbExecute<{
      week: number;
      team_id: number;
      points: number;
      opponent_team_id: number | null;
      matchup_id: number | null;
    }>(
      `SELECT week, team_id, points, opponent_team_id, matchup_id FROM native_matchup_results
       WHERE league_id = ? AND season_year = ? AND week <= ?`,
      [leagueId, seasonYear, asOfWeek],
    ),
    tidbExecute<{
      week: number;
      matchup_id: number;
      home_team_id: number;
      away_team_id: number;
    }>(
      `SELECT week, matchup_id, home_team_id, away_team_id FROM native_schedules
       WHERE league_id = ? AND season_year = ? AND week <= ?`,
      [leagueId, seasonYear, asOfWeek],
    ),
  ]);

  type Acc = {
    teamId: number;
    teamName: string;
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    pointsAgainst: number;
  };
  const acc = new Map<number, Acc>();
  for (const t of teams) {
    acc.set(Number(t.id), {
      teamId: Number(t.id),
      teamName: String(t.team_name),
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  const pts = new Map<string, number>();
  for (const r of results) {
    pts.set(`${r.week}:${r.team_id}`, Number(r.points ?? 0));
    const row = acc.get(Number(r.team_id));
    if (row) row.pointsFor += Number(r.points ?? 0);
  }

  for (const s of schedules) {
    const homeId = Number(s.home_team_id);
    const awayId = Number(s.away_team_id);
    const hp = pts.get(`${s.week}:${homeId}`);
    const ap = pts.get(`${s.week}:${awayId}`);
    if (hp == null || ap == null) continue;
    const home = acc.get(homeId);
    const away = acc.get(awayId);
    if (!home || !away) continue;
    home.pointsAgainst += ap;
    away.pointsAgainst += hp;
    if (hp > ap) {
      home.wins++;
      away.losses++;
    } else if (ap > hp) {
      away.wins++;
      home.losses++;
    } else if (allowTies) {
      home.ties++;
      away.ties++;
    } else {
      // No ties: leave as tie recorded in points only (0-0 for W/L) — treat as tie for standings.
      home.ties++;
      away.ties++;
    }
  }

  const tiebreaker = String(league.standings_tiebreaker ?? "points_for");
  const sorted = [...acc.values()].sort((a, b) => {
    const aw = a.wins + a.ties * 0.5;
    const bw = b.wins + b.ties * 0.5;
    if (bw !== aw) return bw - aw;
    if (tiebreaker === "points_for" || tiebreaker === "head_to_head" || tiebreaker === "division") {
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    }
    return a.teamId - b.teamId;
  });

  const standings: NativeStandingRow[] = sorted.map((row, i) => ({
    ...row,
    pointsFor: Math.round(row.pointsFor * 100) / 100,
    pointsAgainst: Math.round(row.pointsAgainst * 100) / 100,
    rank: i + 1,
  }));

  await tidbExecute(
    `INSERT INTO native_season_standings_snap
       (league_id, season_year, as_of_week, standings, updated_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE standings = VALUES(standings), updated_at = UTC_TIMESTAMP()`,
    [leagueId, seasonYear, asOfWeek, JSON.stringify(standings)],
  );
}

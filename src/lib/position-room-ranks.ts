import type { StartingSlotRanks } from "@/lib/standings-projections.server";

export const ROOM_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type RoomPos = (typeof ROOM_POSITIONS)[number];

type SlotTeam = StartingSlotRanks["teams"][number];

/** Competition ranking (1, 2, 2, 4), highest value first. */
export function rankValues(values: { id: number; value: number }[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const out = new Map<number, number>();
  sorted.forEach((row, index) => {
    const prev = sorted[index - 1];
    out.set(
      row.id,
      prev && Math.abs(prev.value - row.value) < 0.05 ? out.get(prev.id)! : index + 1,
    );
  });
  return out;
}

/** Projected rest-of-season PPG each position adds to a team's best lineup; a flex counts for whoever fills it. */
export function roomPpg(team: SlotTeam): Record<RoomPos, number> {
  const out: Record<RoomPos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const seat of team.seats) {
    if (seat.pos && (ROOM_POSITIONS as readonly string[]).includes(seat.pos)) {
      out[seat.pos as RoomPos] += seat.ppg;
    }
  }
  return out;
}

export type PositionRoomRanks = {
  ppg: Map<number, Record<RoomPos, number>>;
  ranks: Record<RoomPos, Map<number, number>>;
  teams: number;
};

/** League position ranks shared by Standings (Starting Position Mix) and the team Overview. */
export function positionRoomRanks(teams: SlotTeam[]): PositionRoomRanks {
  const ppg = new Map(teams.map((t) => [t.rosterId, roomPpg(t)]));
  const ranks = Object.fromEntries(
    ROOM_POSITIONS.map((pos) => [
      pos,
      rankValues(teams.map((t) => ({ id: t.rosterId, value: ppg.get(t.rosterId)![pos] }))),
    ]),
  ) as Record<RoomPos, Map<number, number>>;
  return { ppg, ranks, teams: teams.length };
}

/**
 * FantasyPros-style Top Needs: weakest offensive rooms first (worst league rank),
 * then optional streamer slots (K / DST) from a local fallback list.
 */
export function topNeedsForRoster(
  rosterId: number,
  rooms: PositionRoomRanks | null | undefined,
  streamerNeeds: string[] = [],
  limit = 3,
): string[] {
  if (!rooms || rooms.teams < 2) {
    return streamerNeeds.slice(0, limit);
  }

  const offensive = ROOM_POSITIONS.map((pos) => ({
    pos,
    rank: rooms.ranks[pos].get(rosterId) ?? rooms.teams,
    ppg: rooms.ppg.get(rosterId)?.[pos] ?? 0,
  })).sort((a, b) => b.rank - a.rank || a.ppg - b.ppg);

  // Prefer bottom-half rooms (true needs); fall back to the full weak-to-strong order.
  const bottomHalf = offensive.filter((r) => r.rank > Math.ceil(rooms.teams / 2));
  const ordered = (bottomHalf.length >= 2 ? bottomHalf : offensive).map((r) => r.pos);

  const out: string[] = [];
  for (const pos of ordered) {
    if (out.length >= limit) break;
    out.push(pos);
  }
  for (const pos of streamerNeeds) {
    if (out.length >= limit) break;
    const label = pos === "DEF" ? "DST" : pos;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Positions used when scoring team needs from season-to-date player pos ranks. */
export const NEED_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type NeedPos = (typeof NEED_POSITIONS)[number];

/**
 * Absolute YTD pos-rank ceilings for elite rooms. Elite talent is never listed as a
 * need (e.g. Purdy QB2), matching FantasyPros Trade Analyzer behavior.
 */
export const ELITE_POS_RANK_CEILING: Record<NeedPos, number> = {
  QB: 8,
  RB: 16,
  WR: 20,
  TE: 10,
  K: 10,
  DEF: 10,
};

/**
 * When a room's strength is below this fraction of the league's best room at the
 * same position, treat it as a need. FantasyPros indexes positional strength
 * against the strongest team — clear gaps vs #1 surface as weaknesses even if
 * the ordinal rank is mid-pack in a flat league.
 */
export const NEED_VS_LEADER_RATIO = 0.65;

export type SeasonPosRankPlayer = { id: string; pos: string };

/**
 * Strength of a roster room from season-to-date NFL position ranks (same source as
 * player popups). Higher is better. Empty starter slots score poorly.
 */
export function seasonRoomStrength(
  players: SeasonPosRankPlayer[],
  pos: NeedPos,
  starterSlots: number,
  posRankFor: (playerId: string) => number | null,
): number {
  const slots = Math.max(0, starterSlots);
  if (slots <= 0) return 0;
  const ranks = players
    .filter((p) => String(p.pos ?? "").toUpperCase() === pos)
    .map((p) => posRankFor(p.id))
    .filter((r): r is number => r != null && Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
    .slice(0, slots);

  let strength = 0;
  for (let i = 0; i < slots; i++) {
    const rank = ranks[i];
    // QB2 → strong; QB25 → weak; missing starter → very weak.
    strength += rank != null ? Math.max(0, 48 - rank) : -24;
  }
  return strength;
}

/** Best (lowest) season pos rank on the roster at a position, or null. */
export function bestSeasonPosRank(
  players: SeasonPosRankPlayer[],
  pos: NeedPos,
  posRankFor: (playerId: string) => number | null,
): number | null {
  let best: number | null = null;
  for (const p of players) {
    if (String(p.pos ?? "").toUpperCase() !== pos) continue;
    const rank = posRankFor(p.id);
    if (rank == null || !(rank > 0)) continue;
    if (best == null || rank < best) best = rank;
  }
  return best;
}

export type SeasonRoomRanks = {
  strength: Map<number, Record<NeedPos, number>>;
  ranks: Record<NeedPos, Map<number, number>>;
  teams: number;
};

/**
 * League room ranks from season-to-date position ranks (player-popup source),
 * not rest-of-season projection seats.
 */
export function seasonPositionRoomRanks(
  teams: { rosterId: number; players: SeasonPosRankPlayer[] }[],
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
): SeasonRoomRanks {
  const strength = new Map<number, Record<NeedPos, number>>();
  for (const team of teams) {
    const row = {} as Record<NeedPos, number>;
    for (const pos of NEED_POSITIONS) {
      const slots =
        starters[pos] ?? (pos === "QB" || pos === "TE" || pos === "K" || pos === "DEF" ? 1 : 0);
      row[pos] = seasonRoomStrength(team.players, pos, slots, posRankFor);
    }
    strength.set(team.rosterId, row);
  }

  const ranks = Object.fromEntries(
    NEED_POSITIONS.map((pos) => [
      pos,
      rankValues(
        teams.map((t) => ({
          id: t.rosterId,
          value: strength.get(t.rosterId)?.[pos] ?? 0,
        })),
      ),
    ]),
  ) as Record<NeedPos, Map<number, number>>;

  return { strength, ranks, teams: teams.length };
}

/** Flex depth after dedicated RB/WR/TE starters — used for FantasyPros-style FLX needs. */
export function flexRoomStrength(
  players: SeasonPosRankPlayer[],
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
): number {
  const flexSlots = Math.max(0, starters.FLEX ?? 0);
  if (flexSlots <= 0) return 0;

  const take = (pos: string, n: number) =>
    players
      .filter((p) => String(p.pos ?? "").toUpperCase() === pos)
      .map((p) => posRankFor(p.id))
      .filter((r): r is number => r != null && Number.isFinite(r) && r > 0)
      .sort((a, b) => a - b)
      .slice(n);

  // Players left after filling dedicated starter seats become the flex pool.
  const pool = [
    ...take("RB", starters.RB ?? 0),
    ...take("WR", starters.WR ?? 0),
    ...take("TE", starters.TE ?? 0),
  ].sort((a, b) => a - b);

  let strength = 0;
  for (let i = 0; i < flexSlots; i++) {
    const rank = pool[i];
    strength += rank != null ? Math.max(0, 48 - rank) : -24;
  }
  return strength;
}

/**
 * Absolute YTD ranks at/above this are clearly below starter quality (real need
 * even if the room is mid-pack in a shallow league).
 */
export const WEAK_POS_RANK_FLOOR: Record<NeedPos, number> = {
  QB: 18,
  RB: 28,
  WR: 36,
  TE: 18,
  K: 18,
  DEF: 18,
};

export type ScoredNeed = {
  label: string;
  needScore: number;
  leagueRank: number;
  best: number | null;
  /** Elite YTD talent — never list as a need (Purdy QB2). */
  elite: boolean;
  /**
   * Clear positional weakness: bottom-half vs league, vacant, or weak absolute
   * YTD rank. FantasyPros shows 1–3 of these; strong teams often only have 1–2.
   */
  isRealNeed: boolean;
};

/**
 * Whether a room qualifies as a FantasyPros-style need.
 *
 * FP League Analyzer / Trade Analyzer derive needs from positional rankings vs
 * the league (weakest rooms / gaps vs the best team), not a forced count of 3.
 * Strong teams often show only 1–2 badges; weaker teams fill up to 3.
 */
export function isQualifyingNeed(input: {
  leagueRank: number;
  teamCount: number;
  best: number | null;
  elite: boolean;
  pos: NeedPos | "FLEX";
  strength: number;
  /** Best room strength in the league at this position (FP index-vs-#1). */
  leaderStrength?: number | null;
}): boolean {
  if (input.elite) return false;
  // Vacant starter slot is always a need.
  if (input.best == null) return true;
  // Bottom half of the league at this position.
  if (input.teamCount >= 2 && input.leagueRank > Math.ceil(input.teamCount / 2)) return true;
  // Clear gap vs the league's strongest room (FP-style index against #1).
  const leader = input.leaderStrength;
  if (leader != null && leader > 0 && input.strength / leader < NEED_VS_LEADER_RATIO) {
    return true;
  }
  // Absolute YTD starter quality floor (weak even if mid-pack in a shallow league).
  if (input.pos !== "FLEX" && input.best >= WEAK_POS_RANK_FLOOR[input.pos]) return true;
  // Flex: no ranked depth after starters.
  if (input.pos === "FLEX" && input.strength <= 8) return true;
  return false;
}

/** Highest room strength at a position across the league (FP index baseline). */
function leaderStrengthAt(rooms: SeasonRoomRanks | null | undefined, pos: NeedPos): number | null {
  if (!rooms || rooms.teams < 2) return null;
  let max = -Infinity;
  for (const row of rooms.strength.values()) {
    const v = row[pos] ?? 0;
    if (v > max) max = v;
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * Score every starter room (and FLX) for need ranking.
 */
export function scoreSeasonNeeds(
  rosterId: number,
  players: SeasonPosRankPlayer[],
  rooms: SeasonRoomRanks | null | undefined,
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
): ScoredNeed[] {
  const teamCount = Math.max(1, rooms?.teams ?? 1);
  const scored: ScoredNeed[] = [];

  for (const pos of NEED_POSITIONS) {
    const slots = starters[pos] ?? 0;
    if (slots <= 0) continue;

    const best = bestSeasonPosRank(players, pos, posRankFor);
    const elite = best != null && best <= ELITE_POS_RANK_CEILING[pos];
    const leagueRank =
      rooms && rooms.teams >= 2
        ? (rooms.ranks[pos].get(rosterId) ?? rooms.teams)
        : best != null
          ? best
          : 99;
    const strength =
      rooms?.strength.get(rosterId)?.[pos] ?? seasonRoomStrength(players, pos, slots, posRankFor);
    const leaderStrength = leaderStrengthAt(rooms, pos);

    // Higher = more of a need. Blend league ordinal + absolute YTD + gap vs #1.
    const vsLeaderPenalty =
      leaderStrength != null && leaderStrength > 0
        ? Math.max(0, 1 - strength / leaderStrength) * 40
        : 0;
    const needScore =
      (leagueRank / teamCount) * 100 +
      (best != null ? best : 60) -
      strength * 0.35 +
      vsLeaderPenalty;

    scored.push({
      label: pos === "DEF" ? "DST" : pos,
      needScore,
      leagueRank,
      best,
      elite,
      isRealNeed: isQualifyingNeed({
        leagueRank,
        teamCount,
        best,
        elite,
        pos,
        strength,
        leaderStrength,
      }),
    });
  }

  const flexSlots = starters.FLEX ?? 0;
  if (flexSlots > 0) {
    const strength = flexRoomStrength(players, starters, posRankFor);
    // Treat thin flex like a mid/bottom league room when depth is weak.
    const leagueRank =
      strength <= 0
        ? teamCount
        : strength <= 8
          ? Math.ceil(teamCount * 0.75)
          : Math.max(1, Math.ceil(teamCount * 0.4));
    const needScore = (leagueRank / teamCount) * 100 + 40 - strength * 0.5;
    // null = vacant flex depth (always keep); otherwise a synthetic rank for scoring.
    const best = strength <= 0 ? null : 20;
    scored.push({
      label: "FLX",
      needScore,
      leagueRank,
      best,
      elite: false,
      isRealNeed: isQualifyingNeed({
        leagueRank,
        teamCount,
        best,
        elite: false,
        pos: "FLEX",
        strength,
        leaderStrength: null,
      }),
    });
  }

  return scored;
}

/**
 * FantasyPros-style Top Needs from season YTD positional strength.
 *
 * FantasyPros Trade Analyzer / League Analyzer:
 * - Rank each roster room vs the league (positional rankings indexed to #1).
 * - Surface only real weaknesses — strong clubs often show 1–2 needs, not 3.
 * - Cap at `limit` (usually 3); never pad with near-average rooms.
 * - Elite YTD talent (e.g. Purdy QB2) is never listed.
 * - Fully stacked rosters still get one relative weak spot (FP rarely shows —).
 */
export function topNeedsFromSeasonPosRanks(
  rosterId: number,
  players: SeasonPosRankPlayer[],
  rooms: SeasonRoomRanks | null | undefined,
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
  limit = 3,
): string[] {
  const scored = scoreSeasonNeeds(rosterId, players, rooms, starters, posRankFor);
  const byNeed = (a: ScoredNeed, b: ScoredNeed) =>
    b.needScore - a.needScore || b.leagueRank - a.leagueRank || a.label.localeCompare(b.label);

  const real = scored.filter((s) => s.isRealNeed).sort(byNeed);
  if (real.length > 0) {
    // Keep only clear weaknesses: drop trailing needs that are far milder than
    // the primary gap so top teams stop at 1–2 instead of always filling 3.
    const primary = real[0]!.needScore;
    const clear = real.filter((s, i) => i === 0 || s.needScore >= primary - 45 || s.best == null);
    return clear.slice(0, limit).map((s) => s.label);
  }

  // Stacked roster: one relative weak spot only (never pad; never elite).
  const mild = scored.filter((s) => !s.elite).sort(byNeed);
  return mild.slice(0, 1).map((s) => s.label);
}

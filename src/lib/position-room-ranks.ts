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
  /** Flex-depth strength after dedicated starters (FantasyPros FLX room). */
  flexStrength: Map<number, number>;
  /** League ordinal ranks for flex depth (1 = strongest flex). */
  flexRanks: Map<number, number>;
  teams: number;
};

/**
 * League room ranks from season-to-date position ranks (player-popup source),
 * not rest-of-season projection seats. Includes flex-depth ranks so FLX needs
 * compare league-relative like FantasyPros, instead of a synthetic score.
 */
export function seasonPositionRoomRanks(
  teams: { rosterId: number; players: SeasonPosRankPlayer[] }[],
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
): SeasonRoomRanks {
  const strength = new Map<number, Record<NeedPos, number>>();
  const flexStrength = new Map<number, number>();
  const flexSlots = Math.max(0, starters.FLEX ?? 0);

  for (const team of teams) {
    const row = {} as Record<NeedPos, number>;
    for (const pos of NEED_POSITIONS) {
      const slots =
        starters[pos] ?? (pos === "QB" || pos === "TE" || pos === "K" || pos === "DEF" ? 1 : 0);
      row[pos] = seasonRoomStrength(team.players, pos, slots, posRankFor);
    }
    strength.set(team.rosterId, row);
    flexStrength.set(
      team.rosterId,
      flexSlots > 0 ? flexRoomStrength(team.players, starters, posRankFor) : 0,
    );
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

  const flexRanks =
    flexSlots > 0
      ? rankValues(teams.map((t) => ({ id: t.rosterId, value: flexStrength.get(t.rosterId) ?? 0 })))
      : new Map<number, number>();

  return { strength, ranks, flexStrength, flexRanks, teams: teams.length };
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

/**
 * Soft need band (FantasyPros mid/bottom teams often fill to 3): worse than
 * roughly the top third of the league at a position, but not already a real need.
 */
export const SOFT_NEED_RANK_RATIO = 1 / 3;

export type ScoredNeed = {
  label: string;
  needScore: number;
  leagueRank: number;
  best: number | null;
  /** Elite YTD talent — never list as a need (Purdy QB2). */
  elite: boolean;
  /** Dedicated starter room (QB/RB/WR/TE/K/DST) vs FLX depth. */
  dedicated: boolean;
  /**
   * Clear positional weakness: bottom-half vs league, vacant, weak absolute
   * YTD, or (for FLX) bottom-half flex depth. FP shows 1–3 of these.
   */
  isRealNeed: boolean;
  /** Milder hole — used to fill toward 3 for mid/weak teams like FantasyPros. */
  isSoftNeed: boolean;
};

/**
 * Whether a room qualifies as a FantasyPros-style need.
 *
 * FP Trade Analyzer needs track positional rankings vs the league. Dedicated
 * rooms (QB–DST) drive the list; FLX only appears when flex depth is also
 * bottom-half league-relative — never as a synthetic catch-all.
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
  // Vacant starter / empty flex depth is always a need.
  if (input.best == null) return true;
  // Bottom half of the league at this position (incl. real FLX ranks).
  if (input.teamCount >= 2 && input.leagueRank > Math.ceil(input.teamCount / 2)) return true;
  // Clear gap vs the league's strongest room (FP-style index against #1).
  const leader = input.leaderStrength;
  if (
    input.pos !== "FLEX" &&
    leader != null &&
    leader > 0 &&
    input.strength / leader < NEED_VS_LEADER_RATIO
  ) {
    return true;
  }
  // Absolute YTD starter quality floor (dedicated rooms only).
  if (input.pos !== "FLEX" && input.best >= WEAK_POS_RANK_FLOOR[input.pos]) return true;
  return false;
}

/** Milder FP-style hole used when padding mid teams toward 3 badges. */
export function isSoftNeed(input: {
  leagueRank: number;
  teamCount: number;
  elite: boolean;
  dedicated: boolean;
}): boolean {
  if (input.elite || !input.dedicated) return false;
  if (input.teamCount < 2) return false;
  return input.leagueRank > Math.ceil(input.teamCount * SOFT_NEED_RANK_RATIO);
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
 *
 * Need score is driven by league ordinal rank (FantasyPros positional rankings),
 * then absolute YTD / gap vs #1. FLX uses real league flex ranks when available.
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

    // League ordinal dominates (FP positional rankings); absolute YTD breaks ties.
    const vsLeaderPenalty =
      leaderStrength != null && leaderStrength > 0
        ? Math.max(0, 1 - strength / leaderStrength) * 25
        : 0;
    const needScore =
      (leagueRank / teamCount) * 120 +
      (best != null ? best * 0.35 : 25) -
      strength * 0.2 +
      vsLeaderPenalty;

    const real = isQualifyingNeed({
      leagueRank,
      teamCount,
      best,
      elite,
      pos,
      strength,
      leaderStrength,
    });

    scored.push({
      label: pos === "DEF" ? "DST" : pos,
      needScore,
      leagueRank,
      best,
      elite,
      dedicated: true,
      isRealNeed: real,
      isSoftNeed: !real && isSoftNeed({ leagueRank, teamCount, elite, dedicated: true }),
    });
  }

  const flexSlots = starters.FLEX ?? 0;
  if (flexSlots > 0) {
    const strength =
      rooms?.flexStrength?.get(rosterId) ?? flexRoomStrength(players, starters, posRankFor);
    const leagueRank =
      rooms && rooms.teams >= 2 && (rooms.flexRanks?.size ?? 0) > 0
        ? (rooms.flexRanks.get(rosterId) ?? rooms.teams)
        : strength <= 0
          ? teamCount
          : Math.max(1, Math.ceil(teamCount * 0.45));
    // Slightly dampen FLX vs dedicated rooms so TE/WR/DST surface first (FP pattern).
    const needScore = (leagueRank / teamCount) * 100 + (strength <= 0 ? 30 : 12) - strength * 0.35;
    const best = strength <= 0 ? null : 20;
    const real = isQualifyingNeed({
      leagueRank,
      teamCount,
      best,
      elite: false,
      pos: "FLEX",
      strength,
      leaderStrength: null,
    });

    scored.push({
      label: "FLX",
      needScore,
      leagueRank,
      best,
      elite: false,
      dedicated: false,
      isRealNeed: real,
      isSoftNeed: false,
    });
  }

  return scored;
}

/**
 * FantasyPros-style Top Needs from season YTD positional strength.
 *
 * Matches Trade Analyzer TEAM|NEEDS patterns from FantasyPros:
 * - Dedicated rooms (QB/RB/WR/TE/K/DST) first — FP rarely shows FLX alone.
 * - FLX only after dedicated holes, when flex depth is also bottom-half.
 * - Strong clubs: 1–2 real needs. Mid/weak: soft-fill toward 3.
 * - Elite YTD talent (e.g. Purdy QB2) never listed.
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

  const dedicatedReal = scored.filter((s) => s.dedicated && s.isRealNeed).sort(byNeed);
  const soft = scored.filter((s) => s.dedicated && s.isSoftNeed).sort(byNeed);
  const flexReal = scored.find((s) => !s.dedicated && s.isRealNeed) ?? null;

  const out: ScoredNeed[] = [];
  const push = (row: ScoredNeed | null | undefined) => {
    if (!row || out.length >= limit) return;
    if (out.some((s) => s.label === row.label)) return;
    out.push(row);
  };

  for (const row of dedicatedReal) push(row);

  // FantasyPros mid/bottom teams usually show 3 badges — soft-fill dedicated holes.
  if (out.length < limit && soft.length > 0) {
    for (const row of soft) push(row);
  }

  // FLX last (FP shows it alongside TE/DST/WR, almost never alone).
  if (out.length < limit && flexReal) push(flexReal);

  if (out.length > 0) return out.slice(0, limit).map((s) => s.label);

  // Fully stacked: one relative dedicated weak spot (prefer TE/WR/RB over FLX).
  const mildDedicated = scored.filter((s) => s.dedicated && !s.elite).sort(byNeed);
  if (mildDedicated.length) return mildDedicated.slice(0, 1).map((s) => s.label);
  const mildAny = scored.filter((s) => !s.elite).sort(byNeed);
  return mildAny.slice(0, 1).map((s) => s.label);
}

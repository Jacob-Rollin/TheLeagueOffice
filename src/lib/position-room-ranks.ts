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
 * Absolute YTD pos-rank ceilings used to *soft-deprioritize* a room (not hard-exclude).
 * FantasyPros still always fills ~1–3 needs; elite rooms just rarely crack the top of the list.
 */
export const ELITE_POS_RANK_CEILING: Record<NeedPos, number> = {
  QB: 8,
  RB: 16,
  WR: 20,
  TE: 10,
  K: 10,
  DEF: 10,
};

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
 * FantasyPros-style Top Needs: always fill up to `limit` weakest rooms.
 *
 * Scores blend league-relative room rank + absolute YTD pos rank. Elite YTD
 * rooms (e.g. Purdy QB2) are heavily soft-deprioritized so they almost never
 * appear, but we never return an empty dash list when starter slots exist.
 */
export function topNeedsFromSeasonPosRanks(
  rosterId: number,
  players: SeasonPosRankPlayer[],
  rooms: SeasonRoomRanks | null | undefined,
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
  limit = 3,
): string[] {
  const teamCount = Math.max(1, rooms?.teams ?? 1);
  const scored: { label: string; needScore: number }[] = [];

  for (const pos of NEED_POSITIONS) {
    const slots = starters[pos] ?? 0;
    if (slots <= 0) continue;

    const best = bestSeasonPosRank(players, pos, posRankFor);
    const leagueRank =
      rooms && rooms.teams >= 2
        ? (rooms.ranks[pos].get(rosterId) ?? rooms.teams)
        : best != null
          ? best
          : 99;
    const strength =
      rooms?.strength.get(rosterId)?.[pos] ?? seasonRoomStrength(players, pos, slots, posRankFor);

    // Higher = more of a need (worst league rooms + worse NFL ranks).
    let needScore = (leagueRank / teamCount) * 100 + (best != null ? best : 60) - strength * 0.35;

    // Soft elite dampen — Purdy QB2 should not surface; do not hard-exclude.
    if (best != null && best <= ELITE_POS_RANK_CEILING[pos]) {
      needScore -= 180;
    }

    scored.push({
      label: pos === "DEF" ? "DST" : pos,
      needScore,
    });
  }

  const flexSlots = starters.FLEX ?? 0;
  if (flexSlots > 0) {
    const strength = flexRoomStrength(players, starters, posRankFor);
    // Approximate a "league rank" for flex from strength alone when rooms lack FLX.
    const needScore = 55 + flexSlots * 8 - strength * 0.5;
    scored.push({ label: "FLX", needScore });
  }

  return scored
    .sort((a, b) => b.needScore - a.needScore || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((r) => r.label);
}

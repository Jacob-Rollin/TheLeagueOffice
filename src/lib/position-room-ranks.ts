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

/** Absolute YTD pos-rank ceilings — at/under this, the room is not a need. */
export const ELITE_POS_RANK_CEILING: Record<NeedPos, number> = {
  QB: 10,
  RB: 24,
  WR: 30,
  TE: 12,
  K: 12,
  DEF: 12,
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

/**
 * Top needs from season YTD pos ranks: worst league rooms first, but never flag a
 * position when the roster already owns an elite YTD rank there (e.g. QB2 Purdy).
 */
export function topNeedsFromSeasonPosRanks(
  rosterId: number,
  players: SeasonPosRankPlayer[],
  rooms: SeasonRoomRanks | null | undefined,
  starters: Record<string, number>,
  posRankFor: (playerId: string) => number | null,
  limit = 3,
): string[] {
  const active = NEED_POSITIONS.filter((pos) => (starters[pos] ?? 0) > 0);
  const scored = active.map((pos) => {
    const best = bestSeasonPosRank(players, pos, posRankFor);
    const elite = best != null && best <= ELITE_POS_RANK_CEILING[pos];
    const leagueRank =
      rooms && rooms.teams >= 2
        ? (rooms.ranks[pos].get(rosterId) ?? rooms.teams)
        : best != null
          ? best
          : 99;
    const strength =
      rooms?.strength.get(rosterId)?.[pos] ??
      seasonRoomStrength(players, pos, starters[pos] ?? 1, posRankFor);
    return { pos, best, elite, leagueRank, strength };
  });

  // Drop elite rooms (Purdy QB2 must not surface as a QB need).
  const candidates = scored.filter((r) => !r.elite);
  const teamCount = rooms?.teams ?? 0;
  const bottomHalf =
    teamCount >= 2 ? candidates.filter((r) => r.leagueRank > Math.ceil(teamCount / 2)) : candidates;
  const ordered = (bottomHalf.length >= 1 ? bottomHalf : candidates)
    .sort(
      (a, b) =>
        b.leagueRank - a.leagueRank || a.strength - b.strength || (b.best ?? 99) - (a.best ?? 99),
    )
    .map((r) => (r.pos === "DEF" ? "DST" : r.pos));

  return ordered.slice(0, limit);
}

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

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
    out.set(row.id, prev && Math.abs(prev.value - row.value) < 0.05 ? out.get(prev.id)! : index + 1);
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

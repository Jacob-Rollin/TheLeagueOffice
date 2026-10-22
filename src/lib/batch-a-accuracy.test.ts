import { describe, expect, it } from "vitest";

import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { injuryBadgeInfo } from "@/lib/injury-badge";
import { scoreSeasonNeeds, seasonPositionRoomRanks } from "@/lib/position-room-ranks";
import { BASE_STARTERS, effectiveStarters, optimizeLineup } from "@/lib/trade-engine";

describe("resolveInjuryStatus (Batch A1)", () => {
  it("keeps Suspended distinct from NA", () => {
    expect(resolveInjuryStatus({ id: "1", injury_status: "Suspended" })).toBe("Suspended");
    expect(resolveInjuryStatus({ id: "1", injury_status: "sus" })).toBe("Suspended");
    expect(resolveInjuryStatus({ id: "1", injury_status: "Player Suspended" })).toBe("Suspended");
  });

  it("maps inactive tokens to NA only", () => {
    expect(resolveInjuryStatus({ id: "1", injury_status: "NA" })).toBe("NA");
    expect(resolveInjuryStatus({ id: "1", injury_status: "Inactive" })).toBe("NA");
    expect(resolveInjuryStatus({ id: "1", injury_status: "Exempt" })).toBe("NA");
  });

  it("badges Suspended as SUS, not Not Active", () => {
    const status = resolveInjuryStatus({ id: "1", injury_status: "Suspended" });
    const info = injuryBadgeInfo(status);
    expect(info?.letter).toBe("SUS");
    expect(info?.text).toBe("Suspended");
  });
});

describe("effectiveStarters / no-K leagues (Batch A2)", () => {
  it("does not fill missing K/DEF from BASE_STARTERS", () => {
    const league = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 };
    expect(effectiveStarters(league)).toEqual(league);
    expect(effectiveStarters(league).K).toBeUndefined();
    expect(effectiveStarters(league).DEF).toBeUndefined();
  });

  it("falls back to BASE only when the template is empty", () => {
    expect(effectiveStarters({})).toEqual(BASE_STARTERS);
    expect(effectiveStarters(null)).toEqual(BASE_STARTERS);
  });

  it("optimizeLineup ignores K/DEF when league omits them", () => {
    const lineup = optimizeLineup(
      [
        { id: "1", pos: "QB", weekly: 20 },
        { id: "2", pos: "RB", weekly: 15 },
        { id: "3", pos: "RB", weekly: 12 },
        { id: "4", pos: "WR", weekly: 14 },
        { id: "5", pos: "WR", weekly: 11 },
        { id: "6", pos: "TE", weekly: 9 },
        { id: "7", pos: "WR", weekly: 8 },
        { id: "8", pos: "K", weekly: 7 },
      ],
      { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
    );
    expect(lineup.vacancies.K ?? 0).toBe(0);
    expect(lineup.vacancies.DEF ?? 0).toBe(0);
    expect(lineup.bySlot.K ?? 0).toBe(0);
  });

  it("season needs skip K/DST when slots are absent", () => {
    const teams = [
      {
        rosterId: 1,
        players: [
          { id: "qb1", pos: "QB" },
          { id: "rb1", pos: "RB" },
          { id: "wr1", pos: "WR" },
          { id: "te1", pos: "TE" },
        ],
      },
      {
        rosterId: 2,
        players: [
          { id: "qb2", pos: "QB" },
          { id: "rb2", pos: "RB" },
          { id: "wr2", pos: "WR" },
          { id: "te2", pos: "TE" },
        ],
      },
    ];
    const ranks = new Map<string, number>([
      ["qb1", 20],
      ["qb2", 5],
      ["rb1", 30],
      ["rb2", 8],
      ["wr1", 25],
      ["wr2", 10],
      ["te1", 18],
      ["te2", 4],
    ]);
    const starters = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 };
    const rooms = seasonPositionRoomRanks(teams, starters, (id) => ranks.get(id) ?? null);
    const scored = scoreSeasonNeeds(
      1,
      teams[0]!.players,
      rooms,
      starters,
      (id) => ranks.get(id) ?? null,
    );
    expect(scored.some((n) => n.label === "K" || n.label === "DST")).toBe(false);
  });
});

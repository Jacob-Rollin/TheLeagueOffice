import { describe, expect, it } from "vitest";

import type { Player } from "@/lib/draft";
import { buildTruePowerRankingsDetailed } from "@/lib/power-rankings";

function stubPlayer(id: string, half = 100): Player {
  return {
    id,
    name: id,
    pos: "WR",
    team: "KC",
    adp: 50,
    posRank: 10,
    proj: { std: half, half, ppr: half },
  } as unknown as Player;
}

describe("buildTruePowerRankingsDetailed freezeScale", () => {
  it("keeps after-trade strength on the before-trade min/max axes", () => {
    const teams = [
      {
        slot: 1,
        team: "A",
        owner: "",
        players: [stubPlayer("a1", 200), stubPlayer("a2", 180)],
        wins: 5,
        losses: 2,
        ties: 0,
        pointsFor: 900,
      },
      {
        slot: 2,
        team: "B",
        owner: "",
        players: [stubPlayer("b1", 120), stubPlayer("b2", 100)],
        wins: 3,
        losses: 4,
        ties: 0,
        pointsFor: 700,
      },
    ];

    const brain = {
      a1: { value: 8000 },
      a2: { value: 7000 },
      b1: { value: 4000 },
      b2: { value: 3000 },
      star: { value: 9000 },
    } as never;

    const projectFor = (id: string) => {
      const map: Record<string, number> = {
        a1: 18,
        a2: 16,
        b1: 12,
        b2: 10,
        star: 22,
      };
      return map[id] ?? 0;
    };

    const before = buildTruePowerRankingsDetailed(teams, {
      brain,
      projectFor,
      rosterPositions: ["WR", "WR", "FLEX"],
    });

    const afterTeams = [
      {
        ...teams[0]!,
        players: [stubPlayer("a1", 200), stubPlayer("star", 220)],
      },
      teams[1]!,
    ];

    const afterFrozen = buildTruePowerRankingsDetailed(afterTeams, {
      brain,
      projectFor,
      rosterPositions: ["WR", "WR", "FLEX"],
      freezeScale: before.scale,
    });
    const afterRenorm = buildTruePowerRankingsDetailed(afterTeams, {
      brain,
      projectFor,
      rosterPositions: ["WR", "WR", "FLEX"],
    });

    const beforeA = before.rows.find((r) => r.slot === 1)!.strengthScore;
    const frozenA = afterFrozen.rows.find((r) => r.slot === 1)!.strengthScore;
    const renormA = afterRenorm.rows.find((r) => r.slot === 1)!.strengthScore;

    // Upgrade should raise strength on the frozen scale.
    expect(frozenA).toBeGreaterThan(beforeA);
    // Re-normalizing after the trade can crush or inflate the same move.
    expect(frozenA).not.toBe(renormA);
  });
});

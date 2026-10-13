import { describe, expect, it } from "vitest";

import type { AiLineupPlayerMeta } from "@/lib/native-league-ai-lineup";
import {
  canFillStartingLineup,
  planAiStreamerClaims,
} from "@/lib/native-league-ai-waivers";

const standardNeeds = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
};

describe("planAiStreamerClaims", () => {
  it("claims a FA kicker when roster K is on bye", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kBye: { pos: "K", bye: 5, weeklyProj: 0, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 8, rank: 80 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", bye: 12, weeklyProj: 9, rank: 120 } },
        { id: "kFaBye", meta: { pos: "K", bye: 5, weeklyProj: 10, rank: 110 } },
      ],
      starterNeeds: standardNeeds,
      requiresDrop: true,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      pos: "K",
      addPlayerId: "kFa",
      dropPlayerId: "kBye",
      reason: "bye",
    });
  });

  it("claims a FA TE when the only TE is on bye", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      teBye: { pos: "TE", bye: 5, weeklyProj: 0, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 7, rank: 80 },
      bnWr: { pos: "WR", weeklyProj: 3, rank: 200 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "teFa", meta: { pos: "TE", bye: 10, weeklyProj: 7, rank: 90 } },
        { id: "teFaBye", meta: { pos: "TE", bye: 5, weeklyProj: 8, rank: 85 } },
      ],
      starterNeeds: standardNeeds,
      requiresDrop: true,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      pos: "TE",
      addPlayerId: "teFa",
      dropPlayerId: "teBye",
      reason: "bye",
    });
  });

  it("claims DEF when missing and drops worst bye piece if full", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      rbBye: { pos: "RB", bye: 5, weeklyProj: 0, rank: 40 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [{ id: "defFa", meta: { pos: "DEF", bye: 8, weeklyProj: 7, rank: 90 } }],
      starterNeeds: standardNeeds,
      requiresDrop: true,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.pos).toBe("DEF");
    expect(plans[0]?.addPlayerId).toBe("defFa");
    expect(plans[0]?.dropPlayerId).toBe("rbBye");
  });

  it("never drops a kickoff-locked player", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kBye: { pos: "K", bye: 5, weeklyProj: 0, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 8, rank: 80 },
      bnLow: { pos: "WR", weeklyProj: 1, rank: 300 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [{ id: "kFa", meta: { pos: "K", bye: 12, weeklyProj: 9, rank: 120 } }],
      starterNeeds: standardNeeds,
      requiresDrop: true,
      lockedPlayerIds: new Set(["kBye"]),
    });
    expect(plans.every((p) => p.dropPlayerId !== "kBye")).toBe(true);
    expect(plans.some((p) => p.addPlayerId === "kFa" && p.dropPlayerId === "bnLow")).toBe(
      true,
    );
  });

  it("skips when startable roster already covers every starter slot", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 7, rank: 80 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [{ id: "kFa", meta: { pos: "K", weeklyProj: 9, rank: 120 } }],
      starterNeeds: standardNeeds,
      requiresDrop: true,
    });
    expect(plans).toEqual([]);
  });

  it("protects next-week depth: drops low WR instead of only startable next-week TE", () => {
    // Week 5: TE on bye → need TE FA. Roster also has a weak WR. The TE returns week 6;
    // dropping that TE would leave week 6 with 0 TEs. Prefer dropping the weak WR.
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      teBye: { pos: "TE", bye: 5, weeklyProj: 0, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 7, rank: 80 },
      // Extra WR — droppable without hurting week 5 or week 6 starters.
      wrDeep: { pos: "WR", weeklyProj: 2, rank: 250 },
    };
    // Lock the bye TE so planner must drop someone else (simulates already-started).
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [{ id: "teFa", meta: { pos: "TE", bye: 11, weeklyProj: 6, rank: 95 } }],
      starterNeeds: standardNeeds,
      requiresDrop: true,
      lockedPlayerIds: new Set(["teBye"]),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.addPlayerId).toBe("teFa");
    expect(plans[0]?.dropPlayerId).toBe("wrDeep");
  });

  it("canFillStartingLineup is false when TE is on bye with no backup", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qb1: { pos: "QB", weeklyProj: 20 },
      rb1: { pos: "RB", weeklyProj: 15 },
      rb2: { pos: "RB", weeklyProj: 12 },
      wr1: { pos: "WR", weeklyProj: 14 },
      wr2: { pos: "WR", weeklyProj: 11 },
      teBye: { pos: "TE", bye: 5, weeklyProj: 0 },
      flexRb: { pos: "RB", weeklyProj: 8 },
      kOk: { pos: "K", weeklyProj: 8 },
      defOk: { pos: "DEF", weeklyProj: 7 },
    };
    expect(
      canFillStartingLineup(Object.keys(metaById), metaById, standardNeeds, 5),
    ).toBe(false);
    expect(
      canFillStartingLineup(
        [...Object.keys(metaById), "teOk"],
        { ...metaById, teOk: { pos: "TE", weeklyProj: 7 } },
        standardNeeds,
        5,
      ),
    ).toBe(true);
  });
});

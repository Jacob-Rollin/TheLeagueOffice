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

/** Assign a real NFL team so `hasNoNflTeam` does not mark fixtures unstartable. */
function withTeams(
  metaById: Record<string, AiLineupPlayerMeta>,
): Record<string, AiLineupPlayerMeta> {
  const teams = [
    "BUF",
    "SF",
    "DET",
    "MIA",
    "PHI",
    "BAL",
    "CHI",
    "DAL",
    "CLE",
    "KC",
    "GB",
    "MIN",
  ];
  let i = 0;
  const out: Record<string, AiLineupPlayerMeta> = {};
  for (const [id, meta] of Object.entries(metaById)) {
    out[id] = {
      ...meta,
      team: meta.team ?? teams[i % teams.length]!,
    };
    i += 1;
  }
  return out;
}

describe("planAiStreamerClaims", () => {
  it("claims a FA kicker when roster K is on bye", () => {
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kBye: { pos: "K", bye: 5, weeklyProj: 0, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 8, rank: 80 },
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", team: "NYJ", bye: 12, weeklyProj: 9, rank: 120 } },
        { id: "kFaBye", meta: { pos: "K", team: "LAR", bye: 5, weeklyProj: 10, rank: 110 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      pos: "K",
      addPlayerId: "kFa",
      dropPlayerId: "kBye",
      reason: "bye",
    });
  });

  it("streams both K and DST when both are on bye the same week", () => {
    // Full roster with two holes: a single swap cannot fill the whole lineup,
    // but each streamer swap must still be accepted so AI can replace both.
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kBye: { pos: "K", bye: 5, weeklyProj: 0, rank: 100 },
      defBye: { pos: "DEF", bye: 5, weeklyProj: 0, rank: 90 },
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", team: "NYJ", bye: 12, weeklyProj: 9, rank: 120 } },
        { id: "defFa", meta: { pos: "DEF", team: "NYG", bye: 8, weeklyProj: 7, rank: 110 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
    });
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.pos).sort()).toEqual(["DEF", "K"]);
    expect(plans.find((p) => p.pos === "K")).toMatchObject({
      addPlayerId: "kFa",
      dropPlayerId: "kBye",
      reason: "bye",
    });
    expect(plans.find((p) => p.pos === "DEF")).toMatchObject({
      addPlayerId: "defFa",
      dropPlayerId: "defBye",
      reason: "bye",
    });
  });

  it("claims a FA TE when the only TE is on bye", () => {
    const metaById = withTeams({
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
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "teFa", meta: { pos: "TE", team: "ATL", bye: 10, weeklyProj: 7, rank: 90 } },
        { id: "teFaBye", meta: { pos: "TE", team: "TB", bye: 5, weeklyProj: 8, rank: 85 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
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
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      rbBye: { pos: "RB", bye: 5, weeklyProj: 0, rank: 40 },
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "defFa", meta: { pos: "DEF", team: "NYG", bye: 8, weeklyProj: 7, rank: 90 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.pos).toBe("DEF");
    expect(plans[0]?.addPlayerId).toBe("defFa");
    expect(plans[0]?.dropPlayerId).toBe("rbBye");
  });

  it("never drops a kickoff-locked player", () => {
    const metaById = withTeams({
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
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", team: "NYJ", bye: 12, weeklyProj: 9, rank: 120 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
      lockedPlayerIds: new Set(["kBye"]),
    });
    expect(plans.every((p) => p.dropPlayerId !== "kBye")).toBe(true);
    expect(plans.some((p) => p.addPlayerId === "kFa" && p.dropPlayerId === "bnLow")).toBe(
      true,
    );
  });

  it("skips when startable roster already covers every starter slot", () => {
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      rb2: { pos: "RB", weeklyProj: 12, rank: 30 },
      wr1: { pos: "WR", weeklyProj: 14, rank: 25 },
      wr2: { pos: "WR", weeklyProj: 11, rank: 35 },
      te1: { pos: "TE", weeklyProj: 9, rank: 40 },
      flexRb: { pos: "RB", weeklyProj: 8, rank: 50 },
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 7, rank: 80 },
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", team: "NYJ", weeklyProj: 9, rank: 120 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
    });
    expect(plans).toEqual([]);
  });

  it("requires a drop once open roster slots are exhausted", () => {
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
      rb1: { pos: "RB", weeklyProj: 15, rank: 20 },
      // Missing WR/TE/K/DEF starters — need multiple adds, only 1 open slot.
      wrBye: { pos: "WR", bye: 5, weeklyProj: 0, rank: 40 },
    });
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "wrFa", meta: { pos: "WR", team: "ATL", bye: 10, weeklyProj: 10, rank: 50 } },
        { id: "teFa", meta: { pos: "TE", team: "TB", bye: 11, weeklyProj: 7, rank: 60 } },
        { id: "kFa", meta: { pos: "K", team: "NYJ", bye: 12, weeklyProj: 6, rank: 100 } },
        { id: "defFa", meta: { pos: "DEF", team: "NYG", bye: 8, weeklyProj: 5, rank: 90 } },
      ],
      starterNeeds: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1 },
      // 3 rostered, capacity 4 → first add may omit drop; later adds must drop.
      activeRosterCount: 3,
      rosterCapacity: 4,
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0]?.dropPlayerId).toBeNull();
    expect(plans.slice(1).every((p) => p.dropPlayerId != null)).toBe(true);
  });

  it("protects next-week depth: drops low WR instead of only startable next-week TE", () => {
    // Week 5: TE on bye → need TE FA. Roster also has a weak WR. The TE returns week 6;
    // dropping that TE would leave week 6 with 0 TEs. Prefer dropping the weak WR.
    const metaById = withTeams({
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
    });
    // Lock the bye TE so planner must drop someone else (simulates already-started).
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      freeAgents: [
        { id: "teFa", meta: { pos: "TE", team: "ATL", bye: 11, weeklyProj: 6, rank: 95 } },
      ],
      starterNeeds: standardNeeds,
      activeRosterCount: Object.keys(metaById).length,
      rosterCapacity: Object.keys(metaById).length,
      lockedPlayerIds: new Set(["teBye"]),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.addPlayerId).toBe("teFa");
    expect(plans[0]?.dropPlayerId).toBe("wrDeep");
  });

  it("canFillStartingLineup is false when TE is on bye with no backup", () => {
    const metaById = withTeams({
      qb1: { pos: "QB", weeklyProj: 20 },
      rb1: { pos: "RB", weeklyProj: 15 },
      rb2: { pos: "RB", weeklyProj: 12 },
      wr1: { pos: "WR", weeklyProj: 14 },
      wr2: { pos: "WR", weeklyProj: 11 },
      teBye: { pos: "TE", bye: 5, weeklyProj: 0 },
      flexRb: { pos: "RB", weeklyProj: 8 },
      kOk: { pos: "K", weeklyProj: 8 },
      defOk: { pos: "DEF", weeklyProj: 7 },
    });
    expect(
      canFillStartingLineup(Object.keys(metaById), metaById, standardNeeds, 5),
    ).toBe(false);
    expect(
      canFillStartingLineup(
        [...Object.keys(metaById), "teOk"],
        { ...metaById, teOk: { pos: "TE", team: "ATL", weeklyProj: 7 } },
        standardNeeds,
        5,
      ),
    ).toBe(true);
  });
});

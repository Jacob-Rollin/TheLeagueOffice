import { describe, expect, it } from "vitest";

import { buildAiLineupSlots, type AiLineupPlayerMeta } from "@/lib/native-league-ai-lineup";

describe("buildAiLineupSlots", () => {
  it("optimizes starters by weekly projection over ADP when both are healthy", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbA: { pos: "QB", team: "KC", rank: 1, weeklyProj: 12 },
      qbB: { pos: "QB", team: "BUF", rank: 40, weeklyProj: 22 },
      rb1: { pos: "RB", team: "SF", rank: 5, weeklyProj: 18 },
      rb2: { pos: "RB", team: "DET", rank: 20, weeklyProj: 14 },
      wr1: { pos: "WR", team: "MIA", rank: 8, weeklyProj: 16 },
      wr2: { pos: "WR", team: "PHI", rank: 25, weeklyProj: 11 },
      te1: { pos: "TE", team: "BAL", rank: 12, weeklyProj: 9 },
      k1: { pos: "K", team: "DAL", rank: 100, weeklyProj: 8 },
      def1: { pos: "DEF", team: "CLE", rank: 90, weeklyProj: 7 },
      bn1: { pos: "RB", team: "CHI", rank: 60, weeklyProj: 6 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 0, K: 1, DEF: 1, BN: 2 },
      week: 5,
    });
    expect(slots.QB?.[0]).toBe("qbB"); // higher weekly proj beats better ADP
    expect(new Set(slots.RB)).toEqual(new Set(["rb1", "rb2"]));
  });

  it("keeps kickoff-locked players in their previous slots", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbLocked: { pos: "QB", team: "KC", weeklyProj: 5, rank: 80 },
      qbBench: { pos: "QB", team: "BUF", weeklyProj: 22, rank: 10 },
      rb1: { pos: "RB", team: "SF", weeklyProj: 18, rank: 5 },
      rb2: { pos: "RB", team: "DET", weeklyProj: 14, rank: 20 },
      wr1: { pos: "WR", team: "MIA", weeklyProj: 16, rank: 8 },
      wr2: { pos: "WR", team: "PHI", weeklyProj: 11, rank: 25 },
      te1: { pos: "TE", team: "BAL", weeklyProj: 9, rank: 12 },
      k1: { pos: "K", team: "DAL", weeklyProj: 8, rank: 100 },
      def1: { pos: "DEF", team: "CLE", weeklyProj: 7, rank: 90 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 2 },
      week: 5,
      immovableIds: new Set(["qbLocked"]),
      previousSlots: {
        QB: ["qbLocked"],
        RB: ["rb1", "rb2"],
        WR: ["wr1", "wr2"],
        TE: ["te1"],
        K: ["k1"],
        DEF: ["def1"],
        BN: ["qbBench", null],
      },
    });
    expect(slots.QB?.[0]).toBe("qbLocked");
    expect(slots.BN ?? []).toContain("qbBench");
  });

  it("still benches bye / Out players when a healthier option exists", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbBye: { pos: "QB", team: "KC", bye: 5, rank: 1, weeklyProj: 30 },
      qbOk: { pos: "QB", team: "BUF", bye: 7, rank: 50, weeklyProj: 14 },
      rb1: { pos: "RB", team: "SF", rank: 5, weeklyProj: 18 },
      rb2: { pos: "RB", team: "DET", rank: 20, weeklyProj: 14 },
      wr1: { pos: "WR", team: "MIA", rank: 8, weeklyProj: 16 },
      wr2: { pos: "WR", team: "PHI", rank: 25, weeklyProj: 11 },
      te1: { pos: "TE", team: "BAL", rank: 12, weeklyProj: 9 },
      k1: { pos: "K", team: "DAL", rank: 100, weeklyProj: 8 },
      def1: { pos: "DEF", team: "CLE", rank: 90, weeklyProj: 7 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 2 },
      week: 5,
    });
    expect(slots.QB?.[0]).toBe("qbOk");
    expect(slots.BN ?? []).toContain("qbBye");
  });

  it("never starts a bye-week player even when they are the only option at the slot", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbBye: { pos: "QB", team: "KC", bye: 5, weeklyProj: 30 },
      rb1: { pos: "RB", team: "SF", weeklyProj: 18 },
      rb2: { pos: "RB", team: "DET", weeklyProj: 14 },
      wr1: { pos: "WR", team: "MIA", weeklyProj: 16 },
      wr2: { pos: "WR", team: "PHI", weeklyProj: 11 },
      te1: { pos: "TE", team: "BAL", weeklyProj: 9 },
      k1: { pos: "K", team: "DAL", weeklyProj: 8 },
      def1: { pos: "DEF", team: "CLE", weeklyProj: 7 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 2 },
      week: 5,
    });
    expect(slots.QB?.[0] ?? null).toBeNull();
    expect(slots.BN ?? []).toContain("qbBye");
  });

  it("never starts a free agent with no NFL team", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbFa: { pos: "QB", team: "FA", weeklyProj: 25 },
      qbOk: { pos: "QB", team: "BUF", weeklyProj: 14 },
      rb1: { pos: "RB", team: "SF", weeklyProj: 18 },
      rb2: { pos: "RB", team: "DET", weeklyProj: 14 },
      wr1: { pos: "WR", team: "MIA", weeklyProj: 16 },
      wr2: { pos: "WR", team: "PHI", weeklyProj: 11 },
      te1: { pos: "TE", team: "BAL", weeklyProj: 9 },
      k1: { pos: "K", team: "DAL", weeklyProj: 8 },
      def1: { pos: "DEF", team: "CLE", weeklyProj: 7 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 2 },
      week: 5,
    });
    expect(slots.QB?.[0]).toBe("qbOk");
    expect(slots.BN ?? []).toContain("qbFa");
  });

  it("unpins bye starters even when marked immovable from a prior lineup", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      qbBye: { pos: "QB", team: "KC", bye: 5, weeklyProj: 5 },
      qbOk: { pos: "QB", team: "BUF", weeklyProj: 22 },
      rb1: { pos: "RB", team: "SF", weeklyProj: 18 },
      rb2: { pos: "RB", team: "DET", weeklyProj: 14 },
      wr1: { pos: "WR", team: "MIA", weeklyProj: 16 },
      wr2: { pos: "WR", team: "PHI", weeklyProj: 11 },
      te1: { pos: "TE", team: "BAL", weeklyProj: 9 },
      k1: { pos: "K", team: "DAL", weeklyProj: 8 },
      def1: { pos: "DEF", team: "CLE", weeklyProj: 7 },
    };
    const slots = buildAiLineupSlots({
      rosterPlayerIds: Object.keys(metaById),
      metaById,
      counts: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 2 },
      week: 5,
      immovableIds: new Set(["qbBye"]),
      previousSlots: {
        QB: ["qbBye"],
        RB: ["rb1", "rb2"],
        WR: ["wr1", "wr2"],
        TE: ["te1"],
        K: ["k1"],
        DEF: ["def1"],
        BN: ["qbOk", null],
      },
    });
    expect(slots.QB?.[0]).toBe("qbOk");
    expect(slots.BN ?? []).toContain("qbBye");
  });
});

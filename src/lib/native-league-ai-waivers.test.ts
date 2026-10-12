import { describe, expect, it } from "vitest";

import type { AiLineupPlayerMeta } from "@/lib/native-league-ai-lineup";
import { planAiStreamerClaims } from "@/lib/native-league-ai-waivers";

describe("planAiStreamerClaims", () => {
  it("claims a FA kicker when roster K is on bye", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      kBye: { pos: "K", bye: 5, weeklyProj: 0, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 8, rank: 80 },
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: ["kBye", "defOk", "qb1"],
      metaById,
      freeAgents: [
        { id: "kFa", meta: { pos: "K", bye: 12, weeklyProj: 9, rank: 120 } },
        { id: "kFaBye", meta: { pos: "K", bye: 5, weeklyProj: 10, rank: 110 } },
      ],
      needK: 1,
      needDef: 1,
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

  it("claims DEF when missing and drops worst bye piece if full", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      rbBye: { pos: "RB", bye: 5, weeklyProj: 0, rank: 40 },
      qb1: { pos: "QB", weeklyProj: 20, rank: 10 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: ["kOk", "rbBye", "qb1"],
      metaById,
      freeAgents: [{ id: "defFa", meta: { pos: "DEF", bye: 8, weeklyProj: 7, rank: 90 } }],
      needK: 1,
      needDef: 1,
      requiresDrop: true,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.pos).toBe("DEF");
    expect(plans[0]?.addPlayerId).toBe("defFa");
    expect(plans[0]?.dropPlayerId).toBe("rbBye");
  });

  it("skips when startable K/DEF already cover slots", () => {
    const metaById: Record<string, AiLineupPlayerMeta> = {
      kOk: { pos: "K", bye: 12, weeklyProj: 8, rank: 100 },
      defOk: { pos: "DEF", bye: 9, weeklyProj: 7, rank: 80 },
    };
    const plans = planAiStreamerClaims({
      week: 5,
      rosterPlayerIds: ["kOk", "defOk"],
      metaById,
      freeAgents: [{ id: "kFa", meta: { pos: "K", weeklyProj: 9, rank: 120 } }],
      needK: 1,
      needDef: 1,
      requiresDrop: true,
    });
    expect(plans).toEqual([]);
  });
});

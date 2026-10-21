import { describe, expect, it } from "vitest";

import {
  planIrViolationResolutions,
  playerEligibleForIr,
} from "@/lib/native-league-lineup";

describe("playerEligibleForIr", () => {
  it("allows IR / Suspended / NA when configured", () => {
    expect(playerEligibleForIr("IR", ["IR"])).toBe(true);
    expect(playerEligibleForIr("Injured Reserve", ["IR"])).toBe(true);
    expect(playerEligibleForIr("Suspended", ["IR", "Suspended"])).toBe(true);
    expect(playerEligibleForIr("NA", ["NA"])).toBe(true);
  });

  it("never allows Questionable, Doubtful, Out, or healthy", () => {
    expect(playerEligibleForIr("Questionable", ["IR", "NA", "Suspended"])).toBe(false);
    expect(playerEligibleForIr("Q", ["IR"])).toBe(false);
    expect(playerEligibleForIr("Doubtful", ["IR"])).toBe(false);
    expect(playerEligibleForIr("Out", ["IR"])).toBe(false);
    expect(playerEligibleForIr(null, ["IR"])).toBe(false);
    expect(playerEligibleForIr("", ["IR"])).toBe(false);
  });
});

describe("planIrViolationResolutions", () => {
  it("activates an ineligible IR player when the active roster has room", () => {
    const result = planIrViolationResolutions({
      activePlayerIds: ["a1", "a2"],
      irPlayerIds: ["q1"],
      injuryById: { q1: "Questionable", a1: null, a2: null },
      capacity: 5,
    });
    expect(result.actions).toEqual([
      { playerId: "q1", action: "activate", dropPlayerId: null, injury: "Questionable" },
    ]);
    expect(result.irPlayerIds).toEqual([]);
    expect(result.activePlayerIds).toContain("q1");
  });

  it("activates + drops the least valuable unlocked player when full", () => {
    const result = planIrViolationResolutions({
      activePlayerIds: ["star", "scrub"],
      irPlayerIds: ["q1"],
      injuryById: { q1: "Questionable", star: null, scrub: null },
      metaById: {
        star: { weeklyProj: 20 },
        scrub: { weeklyProj: 2 },
        q1: { weeklyProj: 12 },
      },
      capacity: 2,
    });
    expect(result.actions).toEqual([
      {
        playerId: "q1",
        action: "activate_drop",
        dropPlayerId: "scrub",
        injury: "Questionable",
      },
    ]);
    expect(result.activePlayerIds).toEqual(["star", "q1"]);
    expect(result.irPlayerIds).toEqual([]);
  });

  it("drops the IR violator when every active player is kickoff-locked", () => {
    const result = planIrViolationResolutions({
      activePlayerIds: ["locked1", "locked2"],
      irPlayerIds: ["q1"],
      injuryById: { q1: "Q", locked1: null, locked2: null },
      capacity: 2,
      lockedPlayerIds: new Set(["locked1", "locked2"]),
    });
    expect(result.actions).toEqual([
      { playerId: "q1", action: "drop", dropPlayerId: null, injury: "Q" },
    ]);
    expect(result.irPlayerIds).toEqual([]);
    expect(result.activePlayerIds).toEqual(["locked1", "locked2"]);
  });

  it("leaves truly IR-eligible sitters alone", () => {
    const result = planIrViolationResolutions({
      activePlayerIds: ["a1"],
      irPlayerIds: ["ir1"],
      injuryById: { ir1: "IR", a1: null },
      capacity: 5,
    });
    expect(result.actions).toEqual([]);
    expect(result.irPlayerIds).toEqual(["ir1"]);
  });

  it("onlyPlayerIds scopes force-resolve to locked humans", () => {
    const result = planIrViolationResolutions({
      activePlayerIds: ["a1"],
      irPlayerIds: ["qLocked", "qGrace"],
      injuryById: { qLocked: "Questionable", qGrace: "Questionable", a1: null },
      capacity: 5,
      onlyPlayerIds: new Set(["qLocked"]),
    });
    expect(result.actions.map((a) => a.playerId)).toEqual(["qLocked"]);
    expect(result.irPlayerIds).toEqual(["qGrace"]);
  });
});

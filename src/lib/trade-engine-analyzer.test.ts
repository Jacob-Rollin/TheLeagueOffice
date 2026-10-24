import { describe, expect, it } from "vitest";

import { starterRequirements } from "@/lib/power-rankings";
import {
  analyzerGradeAdjustments,
  blendAnalyzerGrade,
  fantasyCalcCurrentValuesUrl,
  needFitAdjustment,
  needQualityFromWeekly,
  optimizeLineup,
  powerDeltaToGradePct,
  qbRosterCapacity,
  headlineVerdict,
} from "@/lib/trade-engine";

describe("superflex / QB capacity", () => {
  it("maps SUPER_FLEX to SFLEX (not W/R/T FLEX)", () => {
    const req = starterRequirements(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"]);
    expect(req["SFLEX"]).toBe(1);
    expect(req["FLEX"]).toBe(1);
    expect(req["QB"]).toBe(1);
  });

  it("lets a second QB start in SFLEX", () => {
    const lineup = optimizeLineup(
      [
        { id: "q1", pos: "QB", weekly: 22 },
        { id: "q2", pos: "QB", weekly: 18 },
        { id: "rb1", pos: "RB", weekly: 14 },
        { id: "rb2", pos: "RB", weekly: 12 },
        { id: "wr1", pos: "WR", weekly: 13 },
        { id: "wr2", pos: "WR", weekly: 11 },
        { id: "te1", pos: "TE", weekly: 8 },
        { id: "wr3", pos: "WR", weekly: 7 },
      ],
      { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 1 },
    );
    expect(lineup.bySlot["QB"]).toBe(22);
    expect(lineup.bySlot["SFLEX"]).toBe(18);
    expect(lineup.vacancies["SFLEX"] ?? 0).toBe(0);
  });

  it("raises QB capacity in superflex leagues", () => {
    expect(qbRosterCapacity({ QB: 1, SFLEX: 1 })).toBe(3);
    expect(qbRosterCapacity({ QB: 1 })).toBe(2);
  });
});

describe("analyzer grade helpers", () => {
  it("blends 50/35/15 when power is present", () => {
    const g = blendAnalyzerGrade({ powerPct: 10, lineupPct: 10, needFitPct: 10 });
    expect(g.usedPower).toBe(true);
    expect(g.pct).toBe(10);
  });

  it("reweights without power", () => {
    const g = blendAnalyzerGrade({ powerPct: null, lineupPct: 10, needFitPct: 0 });
    expect(g.usedPower).toBe(false);
    expect(g.pct).toBe(7);
  });

  it("power delta uses relative change", () => {
    expect(powerDeltaToGradePct(50, 55)).toBe(10);
    expect(powerDeltaToGradePct(null, 55)).toBeNull();
  });

  it("scales need fit by quality", () => {
    const plain = needFitAdjustment({
      topNeeds: ["WR"],
      getPositions: ["WR"],
      givePositions: [],
    });
    const weak = needFitAdjustment({
      topNeeds: ["WR"],
      getPositions: ["WR"],
      givePositions: [],
      getQualityByPos: { WR: 0.25 },
    });
    expect(plain).toBe(8);
    expect(weak).toBe(2);
  });

  it("maps weekly vs replacement into quality bands", () => {
    expect(needQualityFromWeekly(12, 10)).toBe(1);
    expect(needQualityFromWeekly(6, 10)).toBe(0.25);
  });

  it("applies soft injury / drop / rival adjustments", () => {
    const adj = analyzerGradeAdjustments({
      injuryDiff: 2,
      dropCount: 1,
      dropPenaltyWeekly: 4,
      rivalLineupDelta: -2,
      giveCount: 1,
      getCount: 1,
      lineupDelta: 2,
    });
    expect(adj).toBeLessThan(0);
  });

  it("uses cleaner headline copy", () => {
    expect(headlineVerdict({ ready: true, pct: 0 })).toBe("Even deal");
    expect(headlineVerdict({ ready: true, pct: 20 })).toBe("Accept this deal");
  });

  it("builds FantasyCalc URLs for SF / dynasty", () => {
    expect(fantasyCalcCurrentValuesUrl({ numQbs: 2 })).toContain("numQbs=2");
    expect(fantasyCalcCurrentValuesUrl({ isDynasty: true })).toContain("isDynasty=true");
  });
});

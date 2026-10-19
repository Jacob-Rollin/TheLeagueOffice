import { describe, expect, it } from "vitest";

import {
  isRedZonePlayType,
  isRushPlayType,
  isTwoPointTry,
  officialPassAttemptDelta,
  rushAttemptDelta,
} from "@/lib/redzone-counting";

/**
 * FantasyPros Josh Allen inside-20, weeks 1–4 (2026): 9/16/54 pass, 10/19/6 rush.
 * Drift came from counting sacks + 2PT as Att and skipping qb_kneel rushes.
 */
describe("redzone-counting vs FantasyPros rules", () => {
  it("counts pass, run, and kneel play types only", () => {
    expect(isRedZonePlayType("pass")).toBe(true);
    expect(isRedZonePlayType("run")).toBe(true);
    expect(isRedZonePlayType("qb_kneel")).toBe(true);
    expect(isRedZonePlayType("qb_spike")).toBe(false);
    expect(isRedZonePlayType("no_play")).toBe(false);
  });

  it("treats kneels as rushes", () => {
    expect(isRushPlayType("qb_kneel")).toBe(true);
    expect(isRushPlayType("run")).toBe(true);
    expect(isRushPlayType("pass")).toBe(false);
  });

  it("drops two-point conversion tries", () => {
    expect(isTwoPointTry(1)).toBe(true);
    expect(isTwoPointTry(0)).toBe(false);
  });

  it("excludes sacks from official pass attempts", () => {
    expect(officialPassAttemptDelta(1, 0)).toBe(1);
    expect(officialPassAttemptDelta(1, 1)).toBe(0);
    expect(officialPassAttemptDelta(0, 0)).toBe(0);
  });

  it("reproduces Allen weeks 1–4 Att gap (20 raw → 16 official)", () => {
    // Raw nflverse pass_attempt sum inside-20 weeks 1–4 was 20.
    // Minus 2 sacks and 2 two-point tries → FantasyPros 16.
    const plays = [
      { twoPoint: 0, sack: 0, passAttempt: 1 }, // ×14 completions/incompletions
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 0, passAttempt: 1 },
      { twoPoint: 0, sack: 1, passAttempt: 1 },
      { twoPoint: 0, sack: 1, passAttempt: 1 },
      { twoPoint: 1, sack: 0, passAttempt: 1 },
      { twoPoint: 1, sack: 0, passAttempt: 1 },
    ];
    expect(plays).toHaveLength(20);
    let att = 0;
    for (const p of plays) {
      if (isTwoPointTry(p.twoPoint)) continue;
      att += officialPassAttemptDelta(p.passAttempt, p.sack);
    }
    expect(att).toBe(16);
  });

  it("counts kneel yards toward rush totals", () => {
    // Allen weeks 1–4: 9 run snaps (20 yds) + 1 kneel (-1) → FantasyPros 10/19.
    const rushes = [
      { type: "run", att: 1, yds: 20 },
      { type: "qb_kneel", att: 1, yds: -1 },
    ];
    // Collapse the 9 runs into one row for the assertion; att still uses 9+1.
    const att = 9 + rushAttemptDelta(rushes[1]!.att);
    const yds = rushes
      .filter((r) => isRushPlayType(r.type))
      .reduce((s, r) => s + r.yds, 0);
    expect(att).toBe(10);
    expect(yds).toBe(19);
  });
});


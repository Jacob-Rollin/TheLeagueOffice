import { describe, expect, it } from "vitest";

import {
  activeRosterCount,
  leagueRosterCapFromPositions,
} from "@/lib/power-rankings";
import { rosterConstraint } from "@/lib/trade-engine";

describe("leagueRosterCapFromPositions", () => {
  it("counts BN when present in the positions list", () => {
    const positions = [
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "FLEX",
      "K",
      "DEF",
      ...Array(6).fill("BN"),
    ];
    expect(leagueRosterCapFromPositions(positions, 15)).toBe(15);
  });

  it("adds benchSlots when BN was stripped upstream (starter-only template)", () => {
    const startersOnly = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
    // Bug that showed +8: treating 9 starter slots as the full cap.
    expect(leagueRosterCapFromPositions(startersOnly, 15)).toBe(9);
    expect(leagueRosterCapFromPositions(startersOnly, 15, 6)).toBe(15);
  });

  it("never counts IR toward active capacity (taxi still counts)", () => {
    const withIr = ["QB", "RB", "WR", "TE", "BN", "BN", "IR", "IR", "TAXI"];
    // 4 starters + 2 BN + 1 TAXI = 7; IR excluded.
    expect(leagueRosterCapFromPositions(withIr, 15)).toBe(7);
  });
});

describe("activeRosterCount", () => {
  it("excludes IR ids from the active body count", () => {
    const players = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(activeRosterCount(players, ["c"])).toBe(2);
    expect(activeRosterCount(players, [])).toBe(3);
  });
});

describe("rosterConstraint 1-for-2", () => {
  it("requires one drop on a full 15-man roster — not eight", () => {
    const starters = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
    const cap = leagueRosterCapFromPositions(starters, 15, 6);
    // 15 active + 1 IR parked (IR excluded from count).
    const active = activeRosterCount(
      Array.from({ length: 16 }, (_, i) => ({ id: `p${i}` })),
      ["p15"],
    );
    expect(active).toBe(15);
    expect(cap).toBe(15);

    const constraint = rosterConstraint({
      rosterCount: active,
      rosterCap: cap,
      giveCount: 1,
      getCount: 2,
      bench: [
        { name: "BenchA", weekly: 4, pos: "WR" },
        { name: "BenchB", weekly: 3, pos: "RB" },
        { name: "BenchC", weekly: 2, pos: "WR" },
      ],
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    });
    expect(constraint.overflow).toBe(true);
    expect(constraint.dropCount).toBe(1);
  });

  it("requires zero drops when the roster has an open active spot", () => {
    const constraint = rosterConstraint({
      rosterCount: 14,
      rosterCap: 15,
      giveCount: 1,
      getCount: 2,
      bench: [{ name: "BenchA", weekly: 4, pos: "WR" }],
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    });
    expect(constraint.overflow).toBe(false);
    expect(constraint.dropCount).toBe(0);
  });

  it("reproduces the old starter-cap bug as a regression guard", () => {
    // Starter-only cap (9) + full active roster (16 incl IR counted) → +8.
    const bad = rosterConstraint({
      rosterCount: 16,
      rosterCap: 9,
      giveCount: 1,
      getCount: 2,
      bench: [{ name: "X", weekly: 1, pos: "WR" }],
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    });
    expect(bad.dropCount).toBe(8);
  });
});

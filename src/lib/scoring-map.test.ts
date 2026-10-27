import { describe, expect, it } from "vitest";

import {
  projectionPoints,
  scoreActualLine,
  scoreStats,
  type ScoringMap,
} from "@/lib/scoring-map";

/** Typical Sleeper DST PA buckets (std/half/ppr leagues). */
const DST_MAP: ScoringMap = {
  sack: 1,
  int: 2,
  fum_rec: 2,
  ff: 1,
  safe: 2,
  blk_kick: 2,
  def_td: 6,
  def_st_td: 6,
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
};

describe("DST pts_allow tier injection", () => {
  // KC DEF-style week: 1 INT (+2) + PA in 14–20 (+1) = 3. Trimmed game-log
  // bags often keep only aggregate pts_allow, which scoreStats used to skip
  // when the league has bucket rules — leaving popup FPTS at 2 vs matchup 3.
  const aggregateOnly = {
    int: 1,
    pts_allow: 17,
  };

  it("scoreActualLine injects pts_allow_14_20 from aggregate pts_allow", () => {
    expect(scoreActualLine(aggregateOnly, DST_MAP)).toBe(3);
  });

  it("scoreStats injects the same tier (shared by projectionPoints)", () => {
    expect(scoreStats(aggregateOnly, DST_MAP)).toBe(3);
    expect(projectionPoints(aggregateOnly, DST_MAP, "half")).toBe(3);
  });

  it("does not double-count when a bucket flag is already present", () => {
    expect(
      scoreActualLine(
        { int: 1, pts_allow: 17, pts_allow_14_20: 1 },
        DST_MAP,
      ),
    ).toBe(3);
  });

  it("scores shutout aggregate pts_allow:0 as pts_allow_0", () => {
    // hasScorableProjectionStats ignores all-zero bags; a real shutout line
    // still has another counting key (or the explicit pts_allow_0 flag).
    expect(scoreActualLine({ sack: 1, pts_allow: 0 }, DST_MAP)).toBe(11);
  });

  it("leaves continuous pts_allow alone when the league has no buckets", () => {
    const continuous: ScoringMap = { sack: 1, pts_allow: -0.5 };
    // 17 PA * -0.5 = -8.5; no tier injection.
    expect(scoreActualLine({ sack: 1, pts_allow: 17 }, continuous)).toBe(-7.5);
  });
});

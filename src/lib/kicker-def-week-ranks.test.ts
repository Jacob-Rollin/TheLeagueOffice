import { describe, expect, it } from "vitest";

import { computeKickerDefWeekRanks } from "@/lib/sleeper-client";

describe("computeKickerDefWeekRanks", () => {
  it("ranks kickers by published half-PPR points", () => {
    const ranks = computeKickerDefWeekRanks(
      {
        "6083": { xpm: 5, fgm: 1, fgm_50_59: 1, pts_std: 10, pts_half_ppr: 10, pts_ppr: 10 },
        "650": { xpm: 2, fgm: 1, pts_std: 5, pts_half_ppr: 5, pts_ppr: 5 },
        "9999": { rush_yd: 80, pts_half_ppr: 12 }, // skill — ignored
      },
      "K",
    );
    expect(ranks.get("6083")?.half).toBe(1);
    expect(ranks.get("650")?.half).toBe(2);
    expect(ranks.has("9999")).toBe(false);
  });

  it("ranks DST by team abbreviation rows", () => {
    const ranks = computeKickerDefWeekRanks(
      {
        HOU: { pts_allow: 10, sack: 4, pts_std: 15, pts_half_ppr: 15, pts_ppr: 15 },
        LV: { pts_allow: 28, sack: 1, pts_std: 2, pts_half_ppr: 2, pts_ppr: 2 },
        "6083": { xpm: 3, pts_half_ppr: 9 }, // kicker — ignored for DEF
      },
      "DEF",
    );
    expect(ranks.get("HOU")?.half).toBe(1);
    expect(ranks.get("LV")?.half).toBe(2);
    expect(ranks.has("6083")).toBe(false);
  });
});

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

  it("excludes TEAM_* offense bags that stamp fgm (week-8 pollution)", () => {
    // Real Sleeper shape: TEAM_DEN has fgm + ~120 team pts; kickers have ~10–20.
    const ranks = computeKickerDefWeekRanks(
      {
        TEAM_DEN: { fgm: 1, pts_half_ppr: 119.98, pts_std: 119.98, pts_ppr: 119.98 },
        TEAM_GB: { fgm: 2, pts_half_ppr: 116.3, pts_std: 116.3, pts_ppr: 116.3 },
        "650": { fgm: 3, xpm: 2, pts_half_ppr: 12, pts_std: 12, pts_ppr: 12 },
        "2020": { fgm: 3, xpm: 1, pts_half_ppr: 10, pts_std: 10, pts_ppr: 10 },
        "5189": { xpm: 1, xpa: 1, pts_half_ppr: 1, pts_std: 1, pts_ppr: 1 },
        "9999": { fgm: 0, xpm: 0, pts_half_ppr: 0 }, // zero attempts — ignored
      },
      "K",
    );
    expect(ranks.size).toBe(3);
    expect(ranks.has("TEAM_DEN")).toBe(false);
    expect(ranks.has("TEAM_GB")).toBe(false);
    // 12 pts should be 1st among these three — not buried under TEAM_ rows as ~3rd+/27th.
    expect(ranks.get("650")?.half).toBe(1);
    expect(ranks.get("2020")?.half).toBe(2);
    expect(ranks.get("5189")?.half).toBe(3);
  });

  it("ranks DST by team abbreviation rows only", () => {
    const ranks = computeKickerDefWeekRanks(
      {
        HOU: { pts_allow: 10, sack: 4, pts_std: 15, pts_half_ppr: 15, pts_ppr: 15 },
        LV: { pts_allow: 28, sack: 1, pts_std: 2, pts_half_ppr: 2, pts_ppr: 2 },
        TEAM_HOU: { pts_allow: 10, sack: 4, pts_half_ppr: 98 }, // offense bag — ignored
        "6083": { xpm: 3, pts_half_ppr: 9 }, // kicker — ignored for DEF
      },
      "DEF",
    );
    expect(ranks.get("HOU")?.half).toBe(1);
    expect(ranks.get("LV")?.half).toBe(2);
    expect(ranks.has("TEAM_HOU")).toBe(false);
    expect(ranks.has("6083")).toBe(false);
  });
});

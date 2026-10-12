import { describe, expect, it } from "vitest";

import { parseSleeperWeekStatMap, parseSleeperWeekStatRows } from "@/lib/sleeper-week-stats";

describe("parseSleeperWeekStatRows", () => {
  it("parses flat Sleeper dict playerId → stat line", () => {
    const rows = {
      "4046": { pass_yd: 250, pass_td: 2, pass_int: 0 },
      "1234": {},
      "9999": { rush_yd: 80, rush_td: 1 },
    };
    const parsed = parseSleeperWeekStatRows(rows);
    expect(Object.keys(parsed).sort()).toEqual(["4046", "9999"]);
    expect(parsed["4046"]).toEqual({ pass_yd: 250, pass_td: 2, pass_int: 0 });
    expect(parsed["9999"]).toEqual({ rush_yd: 80, rush_td: 1 });
  });

  it("parses nested stats objects", () => {
    const rows = {
      "4046": { stats: { pass_yd: 100, pts_ppr: 12.5 }, team: "KC" },
    };
    const parsed = parseSleeperWeekStatRows(rows);
    expect(parsed["4046"]).toEqual({ pass_yd: 100, pts_ppr: 12.5 });
  });

  it("parses array rows with player_id + stats", () => {
    const rows = [
      { player_id: "4046", stats: { rec: 5, rec_yd: 60 } },
      { player_id: "x", stats: {} },
    ];
    const parsed = parseSleeperWeekStatRows(rows);
    expect(parsed["4046"]).toEqual({ rec: 5, rec_yd: 60 });
    expect(parsed["x"]).toBeUndefined();
  });

  it("returns a Map via parseSleeperWeekStatMap", () => {
    const map = parseSleeperWeekStatMap({
      "1": { rush_yd: 10 },
    });
    expect(map.get("1")).toEqual({ rush_yd: 10 });
  });
});

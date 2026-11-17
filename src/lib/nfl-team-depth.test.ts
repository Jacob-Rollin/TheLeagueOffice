import { describe, expect, it } from "vitest";

import {
  isDepthChartDesignated,
  promoteDesignatedOntoDepthRow,
} from "@/lib/nfl-team-depth";

describe("isDepthChartDesignated", () => {
  it("keeps Out / IR / PUP on the chart", () => {
    expect(isDepthChartDesignated("Out")).toBe(true);
    expect(isDepthChartDesignated("IR")).toBe(true);
    expect(isDepthChartDesignated("PUP")).toBe(true);
    expect(isDepthChartDesignated("Doubtful")).toBe(true);
  });

  it("does not treat healthy or Questionable as designated", () => {
    expect(isDepthChartDesignated(null)).toBe(false);
    expect(isDepthChartDesignated("")).toBe(false);
    expect(isDepthChartDesignated("Questionable")).toBe(false);
  });
});

describe("promoteDesignatedOntoDepthRow", () => {
  it("appends Out teammates when the snap still has open slots", () => {
    const rows = [
      { id: "1", injury: null as string | null },
      { id: "2", injury: null },
    ];
    const extras = [{ id: "wilson", injury: "Out" }];
    const out = promoteDesignatedOntoDepthRow(
      rows,
      extras,
      (r) => isDepthChartDesignated(r.injury),
      3,
    );
    expect(out.map((r) => r.id)).toEqual(["1", "2", "wilson"]);
  });

  it("promotes Out into the last slot when the snap row is already full", () => {
    const rows = [
      { id: "swift", injury: null as string | null },
      { id: "roschon", injury: null },
      { id: "brown", injury: "IR" },
    ];
    const extras = [{ id: "monangai", injury: "Out" }];
    const out = promoteDesignatedOntoDepthRow(
      rows,
      extras,
      (r) => isDepthChartDesignated(r.injury),
      3,
    );
    expect(out.map((r) => r.id)).toEqual(["swift", "roschon", "monangai"]);
    expect(out).toHaveLength(3);
  });

  it("never replaces the starter when promoting Out", () => {
    const rows = [
      { id: "charbonnet", injury: null as string | null },
      { id: "price", injury: null },
      { id: "holani", injury: "Out" },
    ];
    const extras = [{ id: "wilson", injury: "Out" }];
    const out = promoteDesignatedOntoDepthRow(
      rows,
      extras,
      (r) => isDepthChartDesignated(r.injury),
      3,
    );
    expect(out.map((r) => r.id)).toEqual(["charbonnet", "price", "wilson"]);
  });
});

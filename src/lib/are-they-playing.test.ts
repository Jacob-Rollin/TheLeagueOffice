import { describe, expect, it } from "vitest";

import {
  chanceToPlay,
  designationFromStatus,
  isDesignatedToReturn,
  type InjuryReportLine,
} from "@/lib/are-they-playing";

function line(partial: Partial<InjuryReportLine>): InjuryReportLine {
  return {
    name: "Jordan Mason",
    team: "MIN",
    pos: "RB",
    injury: "Thumb",
    days: [
      { day: "Wed", mark: "FP" },
      { day: "Thu", mark: null },
      { day: "Fri", mark: null },
    ],
    gameStatus: null,
    final: false,
    ...partial,
  };
}

describe("designationFromStatus", () => {
  it("maps official game statuses", () => {
    expect(designationFromStatus("Questionable")).toBe("Questionable");
    expect(designationFromStatus("Doubtful")).toBe("Doubtful");
    expect(designationFromStatus("Out")).toBe("Out");
    expect(designationFromStatus("Suspended")).toBe("Out");
  });

  it("does not treat IR / IR-R / PUP as Out", () => {
    expect(designationFromStatus("IR")).toBeNull();
    expect(designationFromStatus("Injured Reserve")).toBeNull();
    expect(designationFromStatus("IR-R")).toBeNull();
    expect(designationFromStatus("PUP")).toBeNull();
    expect(designationFromStatus("NFI")).toBeNull();
  });
});

describe("isDesignatedToReturn", () => {
  it("detects IR-R and designated-to-return copy", () => {
    expect(isDesignatedToReturn("IR-R")).toBe(true);
    expect(isDesignatedToReturn("IRR")).toBe(true);
    expect(isDesignatedToReturn("Designated to Return")).toBe(true);
    expect(isDesignatedToReturn("IR")).toBe(false);
    expect(isDesignatedToReturn("Out")).toBe(false);
  });
});

describe("chanceToPlay", () => {
  it("grades IR returnees from midweek practice (not 0% Out)", () => {
    // Same shape as snap-cdn for Mason: Wed FP, no game status, Sleeper still IR.
    const report = line({});
    const withSleeperIrFallback = line({
      gameStatus: designationFromStatus("IR"),
    });
    expect(withSleeperIrFallback.gameStatus).toBeNull();
    expect(chanceToPlay(report)).toBe(96);
    expect(chanceToPlay(withSleeperIrFallback)).toBe(96);
  });

  it("still zeroes true Out designations", () => {
    expect(chanceToPlay(line({ gameStatus: "Out", final: true }))).toBe(0);
  });

  it("uses Questionable + FP final rate", () => {
    expect(
      chanceToPlay(
        line({
          gameStatus: "Questionable",
          final: true,
          days: [
            { day: "Wed", mark: "FP" },
            { day: "Thu", mark: "FP" },
            { day: "Fri", mark: "FP" },
          ],
        }),
      ),
    ).toBe(77);
  });
});

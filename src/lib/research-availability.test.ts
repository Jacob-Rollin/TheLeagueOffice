import { describe, expect, it } from "vitest";

import {
  matchesResearchAvailability,
  researchOwnershipRowClass,
  resolveResearchOwnership,
} from "@/lib/research-availability";

describe("resolveResearchOwnership", () => {
  it("prefers my team over taken", () => {
    const mine = new Set(["a"]);
    const rostered = new Set(["a", "b"]);
    expect(resolveResearchOwnership("a", mine, rostered)).toBe("roster");
    expect(resolveResearchOwnership("b", mine, rostered)).toBe("taken");
    expect(resolveResearchOwnership("c", mine, rostered)).toBe("available");
  });
});

describe("matchesResearchAvailability", () => {
  it("My Team ignores pool", () => {
    expect(
      matchesResearchAvailability("roster", { pool: "available", myTeamOnly: true }),
    ).toBe(true);
    expect(
      matchesResearchAvailability("taken", { pool: "all", myTeamOnly: true }),
    ).toBe(false);
  });

  it("Rostered keeps my team + taken, drops available", () => {
    const state = { pool: "rostered" as const, myTeamOnly: false };
    expect(matchesResearchAvailability("roster", state)).toBe(true);
    expect(matchesResearchAvailability("taken", state)).toBe(true);
    expect(matchesResearchAvailability("available", state)).toBe(false);
  });

  it("Available is free agents only", () => {
    const state = { pool: "available" as const, myTeamOnly: false };
    expect(matchesResearchAvailability("available", state)).toBe(true);
    expect(matchesResearchAvailability("roster", state)).toBe(false);
  });
});

describe("researchOwnershipRowClass", () => {
  it("keeps emerald for available even when zebra", () => {
    expect(researchOwnershipRowClass("available")).toContain("emerald");
    expect(researchOwnershipRowClass("available", true)).toContain("emerald");
  });

  it("zebras taken only", () => {
    expect(researchOwnershipRowClass("taken", true)).toBe("bg-slate-50/50");
    expect(researchOwnershipRowClass("roster", true)).toContain("sky");
  });
});

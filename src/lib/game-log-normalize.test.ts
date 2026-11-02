import { describe, expect, it } from "vitest";

import { normalizeFumbleRaw, normalizeKickerRaw } from "@/lib/game-log-normalize";
import { scoreActualLine, type ScoringMap } from "@/lib/scoring-map";

describe("normalizeFumbleRaw", () => {
  it("keeps Sleeper fum when present (Carnell Tate week 4: 2 fum / 1 lost)", () => {
    expect(normalizeFumbleRaw({ fum: 2, fum_lost: 1 })).toEqual({ fum: 2, fum_lost: 1 });
  });

  it("fills fum from fum_lost when fum is missing", () => {
    expect(normalizeFumbleRaw({ fum_lost: 1 })).toEqual({ fum: 1, fum_lost: 1 });
  });

  it("raises fum up to fum_lost when inconsistent", () => {
    expect(normalizeFumbleRaw({ fum: 0, fum_lost: 1 })).toEqual({ fum: 1, fum_lost: 1 });
  });

  it("leaves rows without lost fumbles unchanged", () => {
    expect(normalizeFumbleRaw({ rec: 5, fum: 0 })).toEqual({ rec: 5, fum: 0 });
    expect(normalizeFumbleRaw({ rec: 5 })).toEqual({ rec: 5 });
  });
});

describe("normalizeKickerRaw", () => {
  it("derives fgm from fga − fgmiss", () => {
    expect(normalizeKickerRaw({ fga: 4, fgmiss: 1 })).toMatchObject({ fgm: 3, fgmiss: 1 });
  });

  it("collapses 50-59 + 60+ into fgm_50p for the display column", () => {
    expect(normalizeKickerRaw({ fgm_50_59: 1, fgm_60p: 1 })["fgm_50p"]).toBe(2);
  });

  it("preserves existing fgm_50p", () => {
    expect(normalizeKickerRaw({ fgm_50p: 1, fgm_50_59: 1 })["fgm_50p"]).toBe(1);
  });
});

/** Typical Sleeper half-PPR kicker distance map (flat fgm unused when distances set). */
const SLEEPERISH_K_MAP: ScoringMap = {
  xpm: 1,
  xpmiss: -1,
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50_59: 5,
  fgm_60p: 5,
  fgmiss: -1,
};

describe("kicker game-log FPTS bags (Matt Gay 2026)", () => {
  it("week 6: 3 XP + 2×20-29 + 1×30-39 = 12", () => {
    const raw = normalizeKickerRaw({
      xpm: 3,
      xpa: 3,
      fgm: 3,
      fga: 3,
      fgm_20_29: 2,
      fgm_30_39: 1,
    });
    expect(scoreActualLine(raw, SLEEPERISH_K_MAP)).toBe(12);
  });

  it("week 7: 3 FG makes + 1 miss = 8 (not flat fgm-only)", () => {
    const raw = normalizeKickerRaw({
      fgm: 3,
      fga: 4,
      fgmiss: 1,
      fgm_20_29: 1,
      fgm_30_39: 2,
    });
    expect(scoreActualLine(raw, SLEEPERISH_K_MAP)).toBe(8);
  });

  it("week 8: 5 XP + one 50-59 = 10 (fgm_50p alone is not enough)", () => {
    const trimmedOnly50p = normalizeKickerRaw({ xpm: 5, xpa: 5, fgm: 1, fga: 1, fgm_50p: 1 });
    // League scores fgm_50_59 — aggregate fgm_50p must not invent that bucket.
    expect(scoreActualLine(trimmedOnly50p, SLEEPERISH_K_MAP)).toBe(5);

    const full = normalizeKickerRaw({
      xpm: 5,
      xpa: 5,
      fgm: 1,
      fga: 1,
      fgm_50_59: 1,
      fgm_50p: 1,
    });
    expect(scoreActualLine(full, SLEEPERISH_K_MAP)).toBe(10);
  });
});

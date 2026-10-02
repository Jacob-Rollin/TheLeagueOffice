import { defaultScoringMap, scoreStats, type ScoringMap } from "../../src/lib/scoring-map";

import { POINTS_ALLOWED_SD } from "./config";
import type { Pos, Pts, Stats } from "./types";

/**
 * Canonical rules every track is graded with: Sleeper's default standard /
 * half / PPR scoring, including its kicker distance and defense tiers.
 */
const KICKER_AND_DEFENSE: ScoringMap = {
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50p: 5,
  fgmiss: -1,
  xpmiss: -1,
  blk_kick: 2,
  ff: 1,
  def_st_td: 6,
  st_td: 0,
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
};

const MAPS = {
  std: { ...defaultScoringMap("std"), ...KICKER_AND_DEFENSE },
  half: { ...defaultScoringMap("half"), ...KICKER_AND_DEFENSE },
  ppr: { ...defaultScoringMap("ppr"), ...KICKER_AND_DEFENSE },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** [standard, half PPR, full PPR] points for a stat line, or null when empty. */
export function points(stats: Stats | null | undefined): Pts | null {
  if (!stats) return null;
  const std = scoreStats(stats, MAPS.std);
  const half = scoreStats(stats, MAPS.half);
  const ppr = scoreStats(stats, MAPS.ppr);
  if (std == null || half == null || ppr == null) return null;
  return [round2(std), round2(half), round2(ppr)];
}

export const PA_BUCKETS = [
  "pts_allow_0",
  "pts_allow_1_6",
  "pts_allow_7_13",
  "pts_allow_14_20",
  "pts_allow_21_27",
  "pts_allow_28_34",
  "pts_allow_35p",
] as const;

const PA_EDGES = [0.5, 6.5, 13.5, 20.5, 27.5, 34.5];

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Probability of each points-allowed tier around an expected points allowed. */
export function paBuckets(mean: number, sd = POINTS_ALLOWED_SD): Stats {
  const cdf = PA_EDGES.map((edge) => normalCdf((edge - mean) / sd));
  const out: Stats = {};
  let prev = 0;
  PA_BUCKETS.forEach((key, i) => {
    const upto = i < cdf.length ? cdf[i]! : 1;
    out[key] = Math.max(0, upto - prev);
    prev = upto;
  });
  return out;
}

const KEEP = new Set([
  "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "pass_2pt",
  "rush_att", "rush_yd", "rush_td", "rush_2pt",
  "rec_tgt", "rec", "rec_yd", "rec_td", "rec_2pt", "fum_lost",
  "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p", "fgmiss", "xpm", "xpmiss",
  "sack", "int", "fum_rec", "ff", "safe", "def_td", "def_st_td", "blk_kick", "pts_allow", "yds_allow",
  ...PA_BUCKETS,
]);

/**
 * Normalize any source's line to one vocabulary: aggregate kicker misses and
 * 50+ makes, fold special-teams TDs into def_st_td, drop metadata, and give
 * defenses tier probabilities when a source only publishes a points-allowed mean.
 */
export function cleanLine(raw: Stats | null | undefined, pos: Pos): Stats | null {
  if (!raw) return null;
  const s: Stats = { ...raw };
  if (pos === "K") {
    if (s.fgmiss == null) {
      const misses = Object.entries(s)
        .filter(([k]) => k.startsWith("fgmiss_"))
        .reduce((sum, [, v]) => sum + Number(v || 0), 0);
      if (misses) s.fgmiss = misses;
    }
    if (s.fgm_50p == null && (s.fgm_50_59 != null || s.fgm_60p != null)) {
      s.fgm_50p = Number(s.fgm_50_59 ?? 0) + Number(s.fgm_60p ?? 0);
    }
  }
  if (pos === "DEF") {
    if (s.st_td != null) s.def_st_td = Number(s.def_st_td ?? 0) + Number(s.st_td);
    if (s.pts_allow_35_p != null && s.pts_allow_35p == null) s.pts_allow_35p = s.pts_allow_35_p;
    const hasBuckets = PA_BUCKETS.some((k) => s[k] != null);
    if (!hasBuckets && s.pts_allow != null) Object.assign(s, paBuckets(Number(s.pts_allow)));
    if (hasBuckets) for (const k of PA_BUCKETS) s[k] = Number(s[k] ?? 0);
  }
  const out: Stats = {};
  for (const [k, v] of Object.entries(s)) {
    const n = Number(v);
    if (KEEP.has(k) && Number.isFinite(n)) out[k] = Math.round(n * 1000) / 1000;
  }
  return Object.keys(out).length ? out : null;
}

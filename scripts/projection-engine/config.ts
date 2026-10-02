import os from "node:os";
import path from "node:path";

import type { Pos, SourceKey } from "./types";

export const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Positional weights for the blended engine line (spec section 3). */
export const WEIGHTS: Record<Pos, Partial<Record<SourceKey, number>>> = {
  QB: { espn: 0.3, sleeper: 0.25, cbs: 0.25, model: 0.2 },
  RB: { espn: 0.4, sleeper: 0.25, cbs: 0.2, model: 0.15 },
  WR: { sleeper: 0.35, model: 0.3, cbs: 0.2, espn: 0.15 },
  TE: { sleeper: 0.35, model: 0.35, cbs: 0.15, espn: 0.15 },
  K: { sleeper: 0.4, model: 0.4, espn: 0.1, cbs: 0.1 },
  DEF: { sleeper: 0.4, model: 0.3, espn: 0.15, cbs: 0.15 },
};

export const PUBLISHED: SourceKey[] = ["sleeper", "espn", "cbs"];
export const ALL_SOURCES: SourceKey[] = ["sleeper", "espn", "cbs", "model", "baseline"];

/** Grading pool size per position (consensus top N covered by every track). */
export const POOL: Record<Pos, number> = { QB: 24, RB: 48, WR: 60, TE: 24, K: 16, DEF: 16 };

export const TIMEOUT_MS = 5_000;
/** Large static files (player database, nflverse dumps) get a longer window. */
export const BULK_TIMEOUT_MS = 30_000;

/** Spread of points allowed around a defense's expected value, for tier odds. */
export const POINTS_ALLOWED_SD = 9.5;

export const GIST_FILES = {
  projections: "projections-current.json",
  locks: (season: number) => `locks-${season}.json`,
  accuracy: (season: number) => `accuracy-${season}.json`,
  dashboard: "accuracy-dashboard.md",
} as const;

export const CACHE_DIR =
  process.env.PE_CACHE_DIR ?? path.join(os.tmpdir(), "projection-engine-cache");
export const OUT_DIR = process.env.PE_OUT_DIR ?? path.join(os.tmpdir(), "projection-engine-out");

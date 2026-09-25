/**
 * Cross-platform fantasy scoring maps.
 *
 * Every host platform (Sleeper, ESPN, Yahoo) exposes its scoring rules in a
 * different shape. We normalize all of them into Sleeper's stat-key vocabulary
 * so a single raw weekly projection row can be scored against any league.
 *
 * Sleeper league projections must be: projection.stats[key] * scoring_settings[key]
 * for every key present in both — matching the Sleeper matchup board exactly.
 *
 * K / DEF need extra bridging: projection rows often use aggregate or legacy
 * bucket keys (`fgm_50p`, `fgmiss_30_39`, `pts_allow`) while league settings use
 * the split buckets (`fgm_50_59` / `fgm_60p`) or flat miss penalties.
 *
 * When a projection includes distance FG makes but the league only configured
 * flat `fgm`, Sleeper scores the 0–49 distance schedule (3/3/3/4) — never
 * `fgm * flat_rate`, and never a synthetic 50+ rate unless the league set one.
 */

export type ScoringMap = Record<string, number>;
export type ScoringFormat = "std" | "half" | "ppr";

const BASE: ScoringMap = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum_lost: -2,
  fgm: 3,
  xpm: 1,
  def_td: 6,
  def_st_td: 6,
  st_td: 6,
  sack: 1,
  int: 2,
  fum_rec: 2,
  safe: 2,
};

/**
 * When a league only configured flat `fgm`, Sleeper's projection UI scores the
 * 0–49 distance makes from the projection row at the standard chart rates.
 * It does NOT invent a 50+ rate for projection `fgm_50p` unless the league
 * actually configured `fgm_50p` / `fgm_50_59` / `fgm_60p`.
 */
const DEFAULT_FG_DISTANCE_FLAT_FALLBACK: ScoringMap = {
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
};

/** Baseline rule set for a plain scoring format, used when a host is silent. */
export function defaultScoringMap(format: ScoringFormat): ScoringMap {
  return { ...BASE, rec: format === "ppr" ? 1 : format === "half" ? 0.5 : 0 };
}

/** ESPN scoring-item statId -> Sleeper stat key. */
export const ESPN_STAT_MAP: Record<number, string> = {
  0: "pass_att",
  1: "pass_cmp",
  3: "pass_yd",
  4: "pass_td",
  19: "pass_2pt",
  20: "pass_int",
  23: "rush_att",
  24: "rush_yd",
  25: "rush_td",
  26: "rush_2pt",
  42: "rec_yd",
  43: "rec_td",
  44: "rec_2pt",
  53: "rec",
  58: "rec_tgt",
  72: "fum_lost",
  74: "fgm",
  86: "xpm",
};

/** Canonical Sleeper projection / settings keys (no naming aliases here). */
const FG_DISTANCE_KEYS = [
  "fgm_0_19",
  "fgm_20_29",
  "fgm_30_39",
  "fgm_40_49",
  "fgm_50_59",
  "fgm_50p",
  "fgm_60p",
] as const;

const FG_MISS_DISTANCE_KEYS = [
  "fgmiss_0_19",
  "fgmiss_20_29",
  "fgmiss_30_39",
  "fgmiss_40_49",
  "fgmiss_50_59",
  "fgmiss_50p",
  "fgmiss_60p",
] as const;

const PTS_ALLOW_BUCKET_KEYS = [
  "pts_allow_0",
  "pts_allow_1_6",
  "pts_allow_7_13",
  "pts_allow_14_20",
  "pts_allow_21_27",
  "pts_allow_28_34",
  "pts_allow_35p",
] as const;

/** Projection metadata / precomputed totals — never multiply as raw counting stats. */
function isNonScoringProjectionKey(key: string): boolean {
  if (key.startsWith("adp_") || key.startsWith("pos_adp_")) return true;
  // pts_allow_* buckets ARE scoring keys; only skip generic pts_std / pts_ppr / …
  if (key.startsWith("pts_") && !key.startsWith("pts_allow")) return true;
  return key === "cmp_pct" || key === "gp" || key === "rank" || key === "pos_rank";
}

function ruleValue(map: ScoringMap, key: string): number | null {
  const n = Number(map[key]);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function hasNonZeroRule(map: ScoringMap, keys: readonly string[]): boolean {
  return keys.some((k) => ruleValue(map, k) != null);
}

function hasKey(map: ScoringMap, keys: readonly string[]): boolean {
  return keys.some((k) => map[k] != null && Number.isFinite(Number(map[k])));
}

function hasDistanceFgRules(map: ScoringMap): boolean {
  return hasNonZeroRule(map, FG_DISTANCE_KEYS) || ruleValue(map, "fgm_50_p") != null;
}

function hasDistanceFgMakes(stats: Record<string, number>): boolean {
  return FG_DISTANCE_KEYS.some((k) => {
    const n = Number(stats[k]);
    return Number.isFinite(n);
  }) || Number.isFinite(Number(stats["fgm_50_p"]));
}

function hasPtsAllowBuckets(map: ScoringMap): boolean {
  return (
    hasKey(map, PTS_ALLOW_BUCKET_KEYS) ||
    (map["pts_allow_35_p"] != null && Number.isFinite(Number(map["pts_allow_35_p"])))
  );
}

function readStat(
  stats: Record<string, number>,
  key: string,
): number | null {
  const direct = Number(stats[key]);
  if (Number.isFinite(direct)) return direct;

  // Common Sleeper / DB naming aliases (fgm_50p ↔ fgm_50_p, xpm ↔ pat_made, …).
  const aliases: Record<string, readonly string[]> = {
    fgm_50_p: ["fgm_50p"],
    fgm_50p: ["fgm_50_p"],
    fgmiss_50_p: ["fgmiss_50p"],
    fgmiss_50p: ["fgmiss_50_p"],
    pts_allow_35_p: ["pts_allow_35p"],
    pts_allow_35p: ["pts_allow_35_p"],
    xpm: ["pat_made"],
    pat_made: ["xpm"],
    xpmiss: ["pat_miss"],
    pat_miss: ["xpmiss"],
  };
  for (const alt of aliases[key] ?? []) {
    const n = Number(stats[alt]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sumStats(
  stats: Record<string, number>,
  keys: readonly string[],
): number | null {
  let total = 0;
  let any = false;
  for (const key of keys) {
    const v = readStat(stats, key);
    if (v == null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

/**
 * Build the effective scoring map for one stat row.
 * When distance FG makes exist but the league only set flat `fgm`, inject
 * Sleeper's 0–49 projection chart and drop flat `fgm` (Sleeper UI parity).
 */
function effectiveScoringMap(
  stats: Record<string, number>,
  map: ScoringMap,
): ScoringMap {
  const out: ScoringMap = { ...map };
  if (!hasDistanceFgMakes(stats)) return out;

  // Never also multiply aggregate `fgm` when distance makes are present.
  out.fgm = 0;

  if (!hasDistanceFgRules(map)) {
    for (const [key, rate] of Object.entries(DEFAULT_FG_DISTANCE_FLAT_FALLBACK)) {
      // Only fill keys the league omitted — never overwrite an explicit 0.
      if (out[key] === undefined) out[key] = rate;
    }
  }
  return out;
}

/**
 * Resolve the projected counting stat for one scoring_settings key.
 * Handles K/DEF projection↔settings mismatches Sleeper's matchup board bridges.
 */
function projectedStatForSetting(
  key: string,
  stats: Record<string, number>,
  map: ScoringMap,
): number | null {
  // Prefer distance FG buckets over flat `fgm` when distance makes exist or
  // the league scores by distance.
  if (
    key === "fgm" &&
    (hasDistanceFgMakes(stats) || hasDistanceFgRules(map))
  ) {
    return null;
  }

  // Prefer PA / YA buckets over continuous allowed totals when buckets exist.
  if (key === "pts_allow" && hasPtsAllowBuckets(map)) return null;
  if (
    key === "yds_allow" &&
    Object.keys(map).some((k) => k.startsWith("yds_allow_"))
  ) {
    return null;
  }

  // Flat miss penalty with distance miss projections (settings fgmiss_* are 0).
  // Do NOT bridge projection `fgm_50p` onto `fgm_50_59` — Sleeper leaves
  // aggregate 50+ projections unmatched when the league zeros `fgm_50p` and
  // only scores the split 50-59 / 60+ keys on actuals.
  if (key === "fgmiss" && readStat(stats, "fgmiss") == null) {
    const distanceMissRules = hasNonZeroRule(map, FG_MISS_DISTANCE_KEYS);
    if (!distanceMissRules) {
      return sumStats(stats, FG_MISS_DISTANCE_KEYS);
    }
  }

  return readStat(stats, key);
}

/** Sleeper's published weekly total for a plain std / half / ppr slate. */
export function publishedProjectionPts(
  stats: Record<string, number> | null | undefined,
  format: ScoringFormat,
): number | null {
  if (!stats) return null;
  const key = format === "ppr" ? "pts_ppr" : format === "std" ? "pts_std" : "pts_half_ppr";
  const n = Number(stats[key]);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when a Sleeper projection row has real weekly counting stats (or a
 * published pts_* total). ADP-only / empty / all-zero rows are how Sleeper
 * represents "—" (no projection) for bye, inactive, FA, or unprojected players.
 *
 * Zero-filled counting keys must NOT count — otherwise research boards list
 * practice-squad FAs with 0.0 Proj while player popups correctly show "—".
 */
export function hasScorableProjectionStats(
  stats: Record<string, number> | null | undefined,
): boolean {
  if (!stats) return false;
  for (const [key, raw] of Object.entries(stats)) {
    if (isNonScoringProjectionKey(key)) continue;
    if (key === "gp" || key === "cmp_pct") continue;
    const n = Number(raw);
    // Require a non-zero counting stat (matches popup "—" for empty lines).
    if (Number.isFinite(n) && n !== 0) return true;
  }
  const published = [stats.pts_ppr, stats.pts_half_ppr, stats.pts_std]
    .map((v) => Number(v))
    .find((n) => Number.isFinite(n) && n > 0);
  return published != null;
}

/** Research / popup display gate: real fantasy points, not a 0.0 placeholder. */
export function hasDisplayableProjection(
  proj: number | null | undefined,
): proj is number {
  return proj != null && Number.isFinite(proj) && proj > 0;
}

/**
 * Score one raw Sleeper projection/stat row with a league scoring map.
 * Iterates scoring keys (Sleeper's model): settings[key] * stats[key].
 */
export function scoreStats(
  stats: Record<string, number> | null | undefined,
  map: ScoringMap,
): number | null {
  if (!stats || !map) return null;
  if (!hasScorableProjectionStats(stats)) return null;
  const effective = effectiveScoringMap(stats, map);
  let total = 0;
  let touched = false;
  for (const [key, ruleRaw] of Object.entries(effective)) {
    if (isNonScoringProjectionKey(key)) continue;
    const rule = Number(ruleRaw);
    if (!Number.isFinite(rule) || rule === 0) continue;
    const value = projectedStatForSetting(key, stats, effective);
    if (value == null || !Number.isFinite(value)) continue;
    total += value * rule;
    touched = true;
  }
  return touched ? total : null;
}

/**
 * Weekly fantasy points for a projection row in league scoring.
 * Always applies the league map when present (Sleeper matchup parity).
 * Falls back to published pts_* only when no usable scoring map exists.
 * Returns null when Sleeper has no weekly projection line (UI "—").
 */
export function projectionPoints(
  stats: Record<string, number> | null | undefined,
  map: ScoringMap,
  format: ScoringFormat,
): number | null {
  if (!stats || !hasScorableProjectionStats(stats)) return null;
  const scored = scoreStats(stats, map);
  if (scored != null) {
    const rounded = Math.round(scored * 100) / 100;
    // Treat a pure-zero line as no projection (popup depth / research parity).
    if (rounded === 0) return null;
    return rounded;
  }
  const published = publishedProjectionPts(stats, format);
  if (published != null && published > 0) {
    return Math.round(published * 100) / 100;
  }
  return null;
}

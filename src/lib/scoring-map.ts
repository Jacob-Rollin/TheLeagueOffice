/**
 * Cross-platform fantasy scoring maps.
 *
 * Every host platform (Sleeper, ESPN, Yahoo) exposes its scoring rules in a
 * different shape. We normalize all of them into Sleeper's stat-key vocabulary
 * so a single raw weekly projection row can be scored against any league.
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

/** Score one raw Sleeper stat row against a normalized rule map. */
export function scoreStats(
  stats: Record<string, number> | null | undefined,
  map: ScoringMap,
): number | null {
  if (!stats) return null;
  let total = 0;
  let touched = false;
  for (const [key, value] of Object.entries(stats)) {
    const rule = map[key];
    if (rule == null || !Number.isFinite(value)) continue;
    total += value * rule;
    touched = true;
  }
  return touched ? total : null;
}

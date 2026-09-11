/**
 * Asymmetric trade grading engine.
 *
 * Handles unequal packages (2-for-1, 3-for-2, …) by discounting the wider
 * side of the deal, which is the mathematical expression of the consolidation
 * premium: value concentrated in one elite asset is worth more than the same
 * raw total spread across roster filler.
 *
 * Also hosts the live FantasyCalc market-value loader used by Market Radar
 * trade / waiver ranking (public unauthenticated REST).
 */

import { scoreStats, type ScoringMap } from "./scoring-map";

/** Discount applied to the aggregate score of the side sending more bodies. */
export const CONSOLIDATION_DISCOUNT = 0.15;

/** Exponential power-curve exponent: elite assets bend the curve upward. */
export const VALUE_CURVE_POWER = 1.18;
/** Geometric decay applied to each successive (lesser) asset in a package. */
export const PACKAGE_DECAY = 0.82;

/**
 * Case-insensitive player-name key shared with news / identity matching.
 * Strips punctuation and generational suffixes so "A.J. Brown" ≡ "AJ Brown".
 */
export function sanitizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|iii|ii|iv)$/g, "")
    .trim();
}

/** Redraft PPR current-values track on FantasyCalc's free public API. */
export const FANTASYCALC_CURRENT_VALUES_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1";

export type FantasyCalcMarketEntry = {
  value: number;
  trend: number;
};

/** Player-id → FantasyCalc value / 30-day trend. */
export type FantasyCalcMarketMap = Record<string, FantasyCalcMarketEntry>;

type FantasyCalcApiRow = {
  value?: number;
  trend30Day?: number | null;
  player?: {
    sleeperId?: string | number | null;
    name?: string | null;
    position?: string | null;
  };
};

let fantasyCalcRowCache: { at: number; rows: FantasyCalcApiRow[] } | null = null;
const FANTASYCALC_TTL_MS = 30 * 60 * 1000;

/** Raw FantasyCalc JSON rows with a short in-memory TTL. */
export async function fetchFantasyCalcRows(): Promise<FantasyCalcApiRow[]> {
  const now = Date.now();
  if (fantasyCalcRowCache && now - fantasyCalcRowCache.at < FANTASYCALC_TTL_MS) {
    return fantasyCalcRowCache.rows;
  }
  const res = await fetch(FANTASYCALC_CURRENT_VALUES_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`FantasyCalc request failed (${res.status})`);
  }
  const json = (await res.json()) as FantasyCalcApiRow[];
  const rows = Array.isArray(json) ? json : [];
  fantasyCalcRowCache = { at: now, rows };
  return rows;
}

/**
 * Live FantasyCalc → internal player-id lookup.
 * Prefer sleeperId matches; fall back to sanitizePlayerName name alignment.
 *
 * Failsafe: if the network request fails, is CORS-blocked, or yields 0 keys,
 * seed every player from local weekly / season projections so trade math never
 * runs against an empty market map.
 */
export type FantasyCalcSeedPlayer = {
  id: string;
  name: string;
  /** Active-week projected points when available. */
  weekly?: number | null;
  /** Season-long projection (e.g. catalog `proj.half`). */
  seasonProj?: number | null;
  /** Optional pre-hydrated market value (brain / warehouse). */
  value?: number | null;
  trend?: number | null;
};

/** Projection-backed market seed used when FantasyCalc is unreachable. */
export function seedMarketValueFromProjection(p: FantasyCalcSeedPlayer): number {
  const known = Number(p.value ?? 0);
  if (Number.isFinite(known) && known > 0) return known;
  const weekly = Number(p.weekly ?? 0);
  if (Number.isFinite(weekly) && weekly > 0) return weekly * 10;
  const season = Number(p.seasonProj ?? 0);
  if (Number.isFinite(season) && season > 0) return (season / 17) * 10;
  return 0;
}

export async function loadFantasyCalcMarketMap(
  players: FantasyCalcSeedPlayer[],
): Promise<FantasyCalcMarketMap> {
  const rows = await fetchFantasyCalcRows().catch((err) => {
    console.log(
      "DEBUG FantasyCalc - fetch failed, will seed from local projections:",
      err instanceof Error ? err.message : err,
    );
    return [] as FantasyCalcApiRow[];
  });
  const bySleeper = new Map<string, FantasyCalcMarketEntry>();
  const byName = new Map<string, FantasyCalcMarketEntry>();

  for (const entry of rows) {
    const value = Number(entry?.value ?? 0) || 0;
    const trend = Number(entry?.trend30Day ?? 0) || 0;
    if (!(value > 0) && !(trend !== 0)) continue;
    const payload: FantasyCalcMarketEntry = { value, trend };
    const sleeperId =
      entry?.player?.sleeperId != null && String(entry.player.sleeperId).trim()
        ? String(entry.player.sleeperId)
        : "";
    if (sleeperId) bySleeper.set(sleeperId, payload);
    const key = sanitizePlayerName(String(entry?.player?.name ?? ""));
    if (key && !byName.has(key)) byName.set(key, payload);
  }

  const out: FantasyCalcMarketMap = {};
  for (const p of players) {
    if (!p?.id) continue;
    const hit = bySleeper.get(p.id) ?? byName.get(sanitizePlayerName(p.name));
    if (hit) out[p.id] = hit;
  }

  const liveKeys = Object.keys(out).length;
  if (liveKeys === 0) {
    console.log(
      "DEBUG FantasyCalc - map keys: 0 after API parse; seeding fallback from local projections. Catalog size:",
      players.length,
    );
    for (const p of players) {
      if (!p?.id) continue;
      const value = seedMarketValueFromProjection(p);
      if (!(value > 0)) continue;
      out[p.id] = {
        value,
        trend: Number(p.trend ?? 0) || 0,
      };
    }
  } else {
    // Fill gaps for rostered / catalog players FantasyCalc omitted.
    let filled = 0;
    for (const p of players) {
      if (!p?.id || out[p.id]) continue;
      const value = seedMarketValueFromProjection(p);
      if (!(value > 0)) continue;
      out[p.id] = {
        value,
        trend: Number(p.trend ?? 0) || 0,
      };
      filled += 1;
    }
    if (filled > 0) {
      console.log(
        "DEBUG FantasyCalc - live keys:",
        liveKeys,
        "projection-filled gaps:",
        filled,
      );
    }
  }

  console.log("DEBUG FantasyCalc - final map keys:", Object.keys(out).length);
  return out;
}

/**
 * Synchronous failsafe for Market Radar: if callers pass an empty value map,
 * seed from FitPlayer weekly projections (×10) so package scoring stays alive.
 */
export function ensureMarketValueMap(
  marketValueById: Record<string, number> | null | undefined,
  pools: FitPlayer[][],
): Record<string, number> {
  const out: Record<string, number> = { ...(marketValueById ?? {}) };
  if (Object.keys(out).length > 0) {
    // Still backfill missing rostered ids from weekly projections.
    for (const pool of pools) {
      for (const p of pool) {
        if (!p.id || out[p.id]) continue;
        const seeded = Math.max(0, Number(p.weekly) || 0) * 10;
        if (seeded > 0) out[p.id] = seeded;
      }
    }
    return out;
  }
  console.log(
    "DEBUG TRADE RADAR - empty marketValueById; seeding from roster weekly projections",
  );
  for (const pool of pools) {
    for (const p of pool) {
      if (!p.id) continue;
      const seeded = Math.max(0, Number(p.weekly) || 0) * 10;
      if (seeded > 0) out[p.id] = seeded;
    }
  }
  console.log("DEBUG TRADE RADAR - seeded market map keys:", Object.keys(out).length);
  return out;
}

/**
 * Star-weighted aggregate using an exponential power curve (KTC / Rototrade
 * style): each value is raised to a superlinear exponent, successive assets
 * decay geometrically, and the result is mapped back into value units.
 */
export function starWeighted(values: number[]): number {
  const curved = [...values]
    .map((v) => Math.max(0, v))
    .sort((a, b) => b - a)
    .reduce(
      (sum, v, i) => sum + Math.pow(v, VALUE_CURVE_POWER) * Math.pow(PACKAGE_DECAY, i),
      0,
    );
  return curved <= 0 ? 0 : Math.pow(curved, 1 / VALUE_CURVE_POWER);
}


/**
 * Aggregate score for one side of the deal, after the consolidation modifier.
 * The wider package takes a 15% discount per extra body (capped at 45%), and
 * the side consolidating into fewer, better assets takes a matching 15%
 * premium (capped at 45%) to reflect starting-lineup value over bench bloat.
 */
export function packageScore(values: number[], opposingCount: number): number {
  const raw = starWeighted(values);
  const diff = values.length - opposingCount;
  if (diff === 0) return raw;
  const steps = Math.min(3, Math.abs(diff));
  const modifier = CONSOLIDATION_DISCOUNT * steps;
  return diff > 0 ? raw * (1 - modifier) : raw * (1 + modifier);
}

export type FitPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type FitPlayer = { pos: string; weekly: number; id?: string };

/**
 * Active league scoring inheritance.
 *
 * When a league is synced, its custom `scoring_settings` multipliers (pass_td,
 * rec, rush_yd, …) are normalized onto Sleeper's stat vocabulary and applied to
 * each player's raw weekly projected stat line, so lineup deltas are computed
 * in the exact point format the host league uses. Sandbox / unsynced desks pass
 * no context and keep the generic projection fallback untouched.
 */
export type LeagueScoringContext = {
  /** Normalized rule map: stat key -> points per unit. */
  map?: ScoringMap | null;
  /** Raw weekly projected stat lines keyed by player id. */
  stats?: Map<string, Record<string, number>> | null;
  /** Pre-scored resolver; takes precedence over map × stats. */
  weeklyFor?: ((id: string) => number | null) | undefined;
};

/** League-format weekly points for one player, falling back to the generic projection. */
export function leagueWeekly(p: FitPlayer, ctx?: LeagueScoringContext | null): number {
  const fallback = Number.isFinite(p.weekly) ? Number(p.weekly) : 0;
  if (!ctx || !p.id) return fallback;
  const direct = ctx.weeklyFor?.(p.id);
  if (direct != null && Number.isFinite(direct)) return Number(direct);
  if (ctx.map) {
    const scored = scoreStats(ctx.stats?.get(p.id), ctx.map);
    if (scored != null && Number.isFinite(scored)) return scored;
  }
  return fallback;
}

/** Re-express a player pool in the active league's scoring format. */
export function applyLeagueScoring(
  list: FitPlayer[],
  ctx?: LeagueScoringContext | null,
): FitPlayer[] {
  if (!ctx) return list;
  return list.map((p) => ({ ...p, weekly: leagueWeekly(p, ctx) }));
}


export type RosterFit = {
  /** Percentage shift applied to the production grade (-25 … +25). */
  pct: number;
  /** Positions the incoming package fills a real starting deficit at. */
  fills: string[];
  /** Positions where the deal deepens an existing bench surplus. */
  clogs: string[];
  note: string;
};

/** Strict starting-lineup benchmarks when the league config omits them. */
export const BASE_STARTERS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
  FLEX: 1,
};

const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

export type Lineup = {
  /** Weekly points produced by the optimized starting lineup. */
  points: number;
  /** Weekly points produced by each starting slot group (FLEX included). */
  bySlot: Record<string, number>;
  /** Starting slots left unfilled, by position (FLEX included). */
  vacancies: Record<string, number>;
  /** Total unfilled starting slots. */
  vacancyCount: number;
  /** Players who did not crack the starting lineup. */
  benchCount: number;
};

/**
 * Two-pass optimizer: dedicated starting slots first, then the single best
 * remaining RB/WR/TE fills each FLEX spot. Bench totals are irrelevant — only
 * starting-lineup fulfillment counts.
 */
export function optimizeLineup(
  players: FitPlayer[],
  starters: Record<string, number>,
  scoring?: LeagueScoringContext | null,
): Lineup {
  const req = { ...BASE_STARTERS, ...starters };
  // League scoring inheritance: re-price every projection in the host format.
  players = applyLeagueScoring(players, scoring);
  // Airtight isolation: clone every entry so sandbox / live roster objects are
  // never mutated by the optimizer's internal slot bookkeeping.
  const pool = players
    .filter((p): p is FitPlayer => Boolean(p) && typeof p.pos === "string")
    .map((p) => ({
      pos: String(p.pos ?? "").toUpperCase(),
      weekly: Number.isFinite(p.weekly) ? Number(p.weekly) : 0,
      _used: false,
    }))
    .sort((a, b) => b.weekly - a.weekly);

  const vacancies: Record<string, number> = {};
  const bySlot: Record<string, number> = {};
  let points = 0;
  let used = 0;

  // Pass A/B pass 1 — dedicated slots, highest projection first.
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
    const need = Math.max(0, req[pos] ?? 0);
    let filled = 0;
    bySlot[pos] = 0;
    for (let i = 0; i < pool.length && filled < need; i++) {
      const p = pool[i]!;
      if (p.pos !== pos || p._used) continue;
      p._used = true;
      points += p.weekly;
      bySlot[pos] = (bySlot[pos] ?? 0) + p.weekly;
      filled++;
      used++;
    }
    if (filled < need) vacancies[pos] = need - filled;
  }

  // Pass 2 — dynamic flex optimization from the surplus RB/WR/TE pool.
  const flexNeed = Math.max(0, req['FLEX'] ?? 0);
  let flexFilled = 0;
  bySlot['FLEX'] = 0;
  for (const p of pool) {
    if (flexFilled >= flexNeed) break;
    if (p._used) continue;
    if (!FLEX_ELIGIBLE.includes(p.pos)) continue;
    p._used = true;
    points += p.weekly;
    bySlot['FLEX'] = (bySlot['FLEX'] ?? 0) + p.weekly;
    flexFilled++;
    used++;
  }
  if (flexFilled < flexNeed) vacancies['FLEX'] = flexNeed - flexFilled;

  return {
    points,
    bySlot,
    vacancies,
    vacancyCount: Object.values(vacancies).reduce((a, b) => a + b, 0),
    benchCount: Math.max(0, players.length - used),
  };
}

export type MarginalImpact = {
  /** Optimized weekly starting points before the deal. */
  before: number;
  /** Optimized weekly starting points after the deal. */
  after: number;
  /** Marginal lineup margin: after − before, in weekly points. */
  delta: number;
  /** Per-slot weekly point shift (QB, RB, WR, TE, K, DEF, FLEX). */
  slotDelta: Record<string, number>;
};

/** Build the post-trade roster pool (remove give, insert get). */
function applyTrade(roster: FitPlayer[], give: FitPlayer[], get: FitPlayer[]): FitPlayer[] {
  const after: FitPlayer[] = [];
  const pending = [...give];
  for (const p of roster) {
    const idx = pending.findIndex((g) => g.pos === p.pos && Math.abs(g.weekly - p.weekly) < 1e-6);
    if (idx >= 0) {
      pending.splice(idx, 1);
      continue;
    }
    after.push(p);
  }
  after.push(...get);
  return after;
}

/**
 * Marginal Starting Lineup Impact simulation.
 *
 * Pass A simulates the highest-scoring lineup from the current roster; Pass B
 * re-optimizes after swapping the packages, so a superior incoming asset
 * automatically benches the weaker starter it replaces. Raw value sums and
 * static roster counts play no part in the result.
 */
export function marginalImpact(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
}): MarginalImpact {
  const req = { ...BASE_STARTERS, ...input.starters };
  const roster = applyLeagueScoring(input.roster, input.scoring);
  const give = applyLeagueScoring(input.give, input.scoring);
  const get = applyLeagueScoring(input.get, input.scoring);
  const before = optimizeLineup(roster, req);
  const after = optimizeLineup(applyTrade(roster, give, get), req);
  const slotDelta: Record<string, number> = {};
  for (const slot of ["QB", "RB", "WR", "TE", "K", "DEF", "FLEX"])
    slotDelta[slot] = (after.bySlot[slot] ?? 0) - (before.bySlot[slot] ?? 0);
  return {
    before: before.points,
    after: after.points,
    delta: after.points - before.points,
    slotDelta,
  };
}

/**
 * Roster fit measured strictly by the marginal starting-lineup margin: if the
 * incoming assets physically raise the weekly point floor of the active
 * starting slots, the trade scores favorably regardless of package size.
 *
 * Synced-league gate: recommendations are suppressed (`eligible: false`) when
 * the incoming package neither projects into an active starter/FLEX slot nor
 * fills a vacancy under the league's starter configuration.
 */
export function rosterFit(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
}): RosterFit & { impact: MarginalImpact; eligible: boolean } {
  const req = { ...BASE_STARTERS, ...input.starters };
  const roster = applyLeagueScoring(input.roster, input.scoring);
  const give = applyLeagueScoring(input.give, input.scoring);
  const get = applyLeagueScoring(input.get, input.scoring);
  const before = optimizeLineup(roster, req);
  const now = optimizeLineup(applyTrade(roster, give, get), req);
  const impact = marginalImpact(input);
  const gate = tradeStarterEligible(input);

  const fills: string[] = [];
  const clogs: string[] = [];
  let pct = 0;

  const slots = ["QB", "RB", "WR", "TE", "K", "DEF", "FLEX"].filter((k) => (req[k] ?? 0) > 0);
  for (const slot of slots) {
    const vb = before.vacancies[slot] ?? 0;
    const va = now.vacancies[slot] ?? 0;
    if (vb > va) fills.push(slot);
    else if (va > vb) pct -= (va - vb) * 6;
    const d = impact.slotDelta[slot] ?? 0;
    if (d > 0.5 && !fills.includes(slot)) fills.push(slot);
  }

  // Core signal: marginal weekly margin, normalised against the current lineup.
  const base = Math.max(before.points, 1);
  pct += Math.max(-25, Math.min(25, (impact.delta / base) * 140));

  // A genuine starting upgrade overrules package-size dilution.
  if (impact.delta > 0.25) pct = Math.max(pct, 8);
  if (impact.delta > 2) pct = Math.max(pct, 15);

  // Incoming bodies that never crack the optimized lineup are bench depth.
  if (impact.delta <= 0 || !gate.eligible) {
    for (const p of input.get) if (!fills.includes(p.pos) && !clogs.includes(p.pos)) clogs.push(p.pos);
  }

  if (!gate.eligible) {
    // Hard structural suppressions (QB capacity / depth bleed) return 0% fit.
    const hardZero =
      gate.reason.includes("QB capacity") || gate.reason.includes("RB/WR depth");
    pct = hardZero ? 0 : Math.min(pct, -8);
  }

  pct = Math.max(-25, Math.min(25, Math.round(pct)));

  const d = impact.delta;
  const note = !input.get.length
    ? "No incoming players to fit."
    : !gate.eligible
      ? gate.reason
      : d > 0.25
        ? `Marginal lineup margin +${d.toFixed(1)} pts/wk — the incoming assets start for you at ${fills.join(", ") || "flex"}.`
        : d < -0.25
          ? `Marginal lineup margin ${d.toFixed(1)} pts/wk — your optimized starting lineup gets weaker${clogs.length ? ` and the return is bench depth at ${clogs.join(", ")}` : ""}.`
          : "Neutral fit — the optimized starting lineup output is unchanged.";

  return { pct, fills, clogs, note, impact, eligible: gate.eligible };
}

/** Same-id / same-pos+weekly identity used by trade simulation bookkeeping. */
function sameFitPlayer(a: FitPlayer, b: FitPlayer): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.pos === b.pos && Math.abs(a.weekly - b.weekly) < 1e-6;
}

/** Hard cap on rostered quarterbacks for Market Radar / fit evaluations. */
export const MAX_QB_ROSTER_CAPACITY = 2;

const SKILL_DEPTH_POSITIONS = new Set(["RB", "WR"]);
/** Single-starter (or low-starter) positions that must not bleed RB/WR depth. */
const SINGLE_STARTER_BENCH_POSITIONS = new Set(["QB", "TE", "K", "DEF"]);

function fitPos(p: FitPlayer): string {
  return String(p.pos ?? "").toUpperCase();
}

export function countRosterPos(roster: FitPlayer[], pos: string): number {
  const needle = pos.toUpperCase();
  return roster.filter((p) => fitPos(p) === needle).length;
}

/** Projected headcount at a position after removing `give` and inserting `get`. */
export function projectedPosCount(
  roster: FitPlayer[],
  give: FitPlayer[],
  get: FitPlayer[],
  pos: string,
): number {
  return countRosterPos(roster, pos) - countRosterPos(give, pos) + countRosterPos(get, pos);
}

/** True when a deal would push the roster past the hard 2-QB capacity. */
export function exceedsQbRosterCapacity(
  roster: FitPlayer[],
  give: FitPlayer[],
  get: FitPlayer[],
): boolean {
  return projectedPosCount(roster, give, get, "QB") > MAX_QB_ROSTER_CAPACITY;
}

/**
 * Depth-bleed clause: never surrender RB/WR depth to acquire a QB/TE/K/DEF
 * bench asset in either trade or waiver evaluations.
 */
export function isDepthBleedExchange(give: FitPlayer[], get: FitPlayer[]): boolean {
  const givesSkill = give.some((p) => SKILL_DEPTH_POSITIONS.has(fitPos(p)));
  const getsSingle = get.some((p) => SINGLE_STARTER_BENCH_POSITIONS.has(fitPos(p)));
  return givesSkill && getsSingle;
}

/**
 * True when an incoming asset cracks the optimized starting lineup (dedicated
 * slot or FLEX) under the league's synced starter configuration, or fills a
 * previously vacant starting requirement.
 *
 * Hard gates:
 * - Max QB roster capacity is 2 — a third QB is always suppressed.
 * - Incoming assets must still project into a starter/FLEX slot or fill a vacancy.
 */
export function tradeStarterEligible(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
}): { eligible: boolean; reason: string; fillsVacancy: boolean; cracksLineup: boolean } {
  const req = { ...BASE_STARTERS, ...input.starters };
  const roster = applyLeagueScoring(input.roster, input.scoring);
  const give = applyLeagueScoring(input.give, input.scoring);
  const get = applyLeagueScoring(input.get, input.scoring);
  if (!get.length) {
    return {
      eligible: false,
      reason: "No incoming players to evaluate against starter slots.",
      fillsVacancy: false,
      cracksLineup: false,
    };
  }

  if (exceedsQbRosterCapacity(roster, give, get)) {
    return {
      eligible: false,
      reason: `Suppressed — roster already at the ${MAX_QB_ROSTER_CAPACITY}-QB capacity limit.`,
      fillsVacancy: false,
      cracksLineup: false,
    };
  }

  if (isDepthBleedExchange(give, get)) {
    return {
      eligible: false,
      reason:
        "Suppressed — cannot surrender RB/WR depth to acquire a single-starter bench asset (QB, TE, K, or DEF).",
      fillsVacancy: false,
      cracksLineup: false,
    };
  }

  const before = optimizeLineup(roster, req);
  const afterRoster = applyTrade(roster, give, get);
  const after = optimizeLineup(afterRoster, req);
  const fillsVacancy = after.vacancyCount < before.vacancyCount;

  let cracksLineup = false;
  for (const incoming of get) {
    const without = afterRoster.filter((p) => !sameFitPlayer(p, incoming));
    const withoutPts = optimizeLineup(without, req).points;
    if (after.points - withoutPts > 0.05) {
      cracksLineup = true;
      break;
    }
  }

  const upgradesStarter = after.points - before.points > 0.15;
  const eligible = fillsVacancy || (cracksLineup && upgradesStarter);

  return {
    eligible,
    fillsVacancy,
    cracksLineup,
    reason: eligible
      ? "Incoming assets project into an active starter or FLEX slot under league roster settings."
      : "Suppressed — incoming target does not project higher than an active starter or fill an eligible starting/FLEX slot under synced league roster settings.",
  };
}

export type RosterConstraint = {
  overflow: boolean;
  dropCount: number;
  penalty: number;
  dropName: string | null;
  dropNames: string[];
  shielded: boolean;
};

/**
 * Bench-vacancy verification with Self-Healing Fallback processing.
 */
export function rosterConstraint(input: {
  rosterCount: number;
  rosterCap: number;
  giveCount: number;
  getCount: number;
  bench: { name: string; weekly: number; pos?: string }[];
  starters?: Record<string, number>;
}): RosterConstraint {
  const none: RosterConstraint = {
    overflow: false,
    dropCount: 0,
    penalty: 0,
    dropName: null,
    dropNames: [],
    shielded: false,
  };
  
  const net = input.getCount - input.giveCount;
  if (net <= 0 || input.rosterCap <= 0) return none;

  const projected = input.rosterCount - input.giveCount + input.getCount;
  const over = projected - input.rosterCap;
  if (over <= 0) return none;

  const starters = { ...BASE_STARTERS, ...(input.starters ?? {}) };
  const remaining: Record<string, number> = {};
  for (const p of input.bench) {
    const pos = p.pos ?? "";
    remaining[pos] = (remaining[pos] ?? 0) + 1;
  }

  const candidates = [...input.bench].sort((a, b) => a.weekly - b.weekly);
  const picked: { name: string; weekly: number; pos?: string | undefined }[] = [];
  let shielded = false;

  for (const c of candidates) {
    if (picked.length >= over) break;
    const pos = c.pos ?? "";
    const required = starters[pos] ?? 0;
    
    if (required > 0 && (remaining[pos] ?? 0) <= required) {
      shielded = true;
      continue; 
    }
    remaining[pos] = (remaining[pos] ?? 1) - 1;
    picked.push({ name: c.name, weekly: c.weekly, pos: c.pos });
  }

  if (picked.length < over && candidates.length > 0) {
    for (const fallback of candidates) {
      if (picked.length >= over) break;
      if (picked.some(p => p.name === fallback.name)) continue;
      picked.push({ name: fallback.name, weekly: fallback.weekly, pos: fallback.pos });
    }
  }

  const penalty = picked.reduce((s, p) => s + p.weekly, 0);
  const primaryDropName = picked.length > 0 ? (picked[0]?.name ?? null) : null;
  
  return {
    overflow: true,
    dropCount: over,
    penalty,
    dropName: primaryDropName,
    dropNames: picked.map((p) => p.name),
    shielded: shielded && picked.length < over,
  };
}

const SLOT_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  FLEX: "flex",
};

/**
 * High-End Executive Summary Engine with Two-Sided Opponent Evaluation.
 */
export function executiveSummary(input: {
  ready: boolean;
  pct: number;
  giveCount: number;
  getCount: number;
  overflow: boolean;
  impact?: MarginalImpact;
  opponentImpact?: MarginalImpact | null;
}): string {
  if (!input.ready) return "Add players to both sides to run the valuation model.";
  
  const impact = input.impact;
  
  // 🟢 THE FIX: Premium, descriptive Sandbox summary that aligns perfectly with the visual slider bar direction
  if (!impact || !impact.before || impact.before === 0) {
    const valueTrendDiff = input.pct;
    if (Math.abs(valueTrendDiff) <= 5) {
      return "TRADE PROPOSAL ANALYSIS: Balanced asset exchange. Both packages map cleanly on our valuation matrix with identical historical value distributions.";
    }
    return valueTrendDiff > 0 
      ? `TRADE PROPOSAL ANALYSIS: Highly Favorable. This proposal tilts significantly in your direction (+${valueTrendDiff.toFixed(1)}% asset premium) based on consensus market value index feeds.` 
      : `TRADE PROPOSAL ANALYSIS: Disadvantageous Asset Drain. This proposal tilts heavily to the rival side (${valueTrendDiff.toFixed(1)}% loss). You are surrendering an elite high-value starter for an inadequate return packages. Recommendation: DECLINE DEAL.`;
  }

  const consolidating = input.getCount < input.giveCount;
  const spreading = input.getCount > input.giveCount;

  // Attached evaluation function checking rival starting lineups dynamically
  const withRival = (baseMsg: string) => {
    if (input.opponentImpact && input.opponentImpact.delta < -0.25) {
      return `${baseMsg} RIVAL ACCEPTANCE PROBABILITY: LOW. This deal reduces the opponent's active weekly starting floor by ${Math.abs(input.opponentImpact.delta).toFixed(1)} pts/wk.`;
    }
    return baseMsg;
  };

  // Explicit type configuration mapping for structural array objects
  const shifts: Array<{ slot: string; delta: number }> = Object.entries(impact.slotDelta)
    .map((entry) => ({ slot: String(entry[0]), delta: Number(entry[1]) }))
    .filter((s) => Math.abs(s.delta) >= 0.25)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    
  const ups = shifts.filter((s) => s.delta > 0);
  const downs = shifts.filter((s) => s.delta < 0);
  const label = (slot: string) => SLOT_LABEL[slot] ?? slot;
  const fmt = (s: { slot: string; delta: number }) =>
    `${label(s.slot)} tier floor (${s.delta > 0 ? "+" : ""}${s.delta.toFixed(1)} pts/wk)`;

  if (impact.delta > 0.25) {
    const top = ups[0];
    const bottom = downs[0];
    const lead = top ? fmt(top) : "weekly starting floor";
    const tail = bottom
      ? ` while giving back ${bottom.delta.toFixed(1)} pts/wk at ${label(bottom.slot)}`
      : ", while holding positional parity everywhere else";
    const scale = impact.delta >= 2 ? "significantly upgrades" : "upgrades";
    return withRival(`TRADE PROPOSAL ANALYSIS: This deal ${scale} your starting ${lead}${tail}. Net marginal lineup margin: +${impact.delta.toFixed(1)} pts/wk${spreading ? ", and that starting upgrade outweighs the bench depth you dilute." : "."}`);
  }
  
  if (impact.delta < -0.25) {
    const worst = downs[0];
    const best = ups[0];
    const lead = worst ? fmt(worst) : "weekly starting floor";
    const tail = best ? ` The only gain is ${fmt(best)}.` : "";
    return `TRADE PROPOSAL ANALYSIS: This deal downgrades your starting ${lead}. Net marginal lineup margin: ${impact.delta.toFixed(1)} pts/wk.${tail}`;
  }

  return withRival(`TRADE PROPOSAL ANALYSIS: Your optimized starting lineup projects the same output either way (${impact.delta >= 0 ? "+" : ""}${impact.delta.toFixed(1)} pts/wk). ${consolidating ? "You consolidate bodies without changing weekly production." : "Decide this one on schedule, bye weeks, and long-term outlook."}`);
}

/**
 * Two-sided fairness: the same marginal starting-lineup simulation, run on the opposing roster.
 */
export function opponentImpact(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
}): MarginalImpact {
  return marginalImpact({
    roster: input.roster,
    give: input.get,
    get: input.give,
    starters: input.starters,
    scoring: input.scoring ?? null,
  });
}

/* ------------------------------------------------------------------ *
 * Dashboard analytics: headline verdicts, pros/cons bullets,
 * positional depth deltas and injury vulnerability comparisons.
 * Pure math + string building — no UI, no data fetching.
 * ------------------------------------------------------------------ */

/** Human-readable package descriptor driven by the actual asset count. */
function packagePhrase(count: number): string {
  if (count <= 1) return "";
  if (count === 2) return " inside a 2-player package";
  return ` inside a ${count}-player bundle`;
}

/** Raw market values are stored in hundredths; the UI shows clean decimals. */
export const VALUE_SCALE = 100;

/** Scale a raw brain market value into the readable 0-100+ display scale. */
export function scaleValue(raw: number): number {
  return Math.round((Math.max(0, raw) / VALUE_SCALE) * 10) / 10;
}

/** Punchy conversational verdict paired with the letter grade. */
export function headlineVerdict(input: { ready: boolean; pct: number }): string {
  if (!input.ready) return "Load both sides";
  const p = input.pct;
  if (p >= 25) return "Yes, by all means";
  if (p >= 15) return "Accept this deal";
  if (p >= 8) return "Worth doing";
  if (p > -8) return "Fair and balanced";
  if (p > -15) return "Push for more";
  return "Walk away from this deal";
}

/** Prominent warning label for unequal packages that force bench drops. */
export function benchSlotWarning(count: number): string {
  if (count <= 0) return "";
  return `⚠️ +${count} BENCH SLOT${count > 1 ? "S" : ""} REQUIRED`;
}

/** Roster statuses that freeze a player's active availability. */
const FROZEN_STATUS: Record<string, string> = {
  EXEMPT: "roster-exempt list",
  SUSPENDED: "suspension",
  PUP: "PUP list",
  IR: "injured reserve",
  NA: "inactive roster designation",
  DNR: "did-not-report list",
};

export type BulletAsset = {
  name: string;
  pos: string;
  /** Raw (unscaled) market value. */
  value: number;
  /** 30-day market trend, raw units. */
  trend: number;
  injuryStatus: string;
  /** Weekly projected points. */
  weekly: number;
};

export type Bullet = { tone: "pro" | "con" | "critical"; text: string };

const WEEKS_LEFT = 17;

/**
 * Context-aware bullet generation for one side of the deal. `side` decides
 * whether an asset leaving or arriving is framed as a gain or a loss.
 */
export function sideBullets(input: {
  side: "give" | "get";
  assets: BulletAsset[];
  /** Marginal starting-lineup impact; omitted for value-only desks. */
  impact?: MarginalImpact | null;
  /** Bench weekly-point differential; omitted for value-only desks. */
  benchDelta?: number | null;
  /** Extra bench slots the receiving package forces the user to clear. */
  dropSlots?: number;
}): Bullet[] {
  const out: Bullet[] = [];
  const incoming = input.side === "get";

  for (const a of input.assets) {
    const status = (a.injuryStatus ?? "").trim().toUpperCase();
    const frozen = FROZEN_STATUS[status];
    if (frozen) {
      out.push({
        tone: incoming ? "con" : "pro",
        text: incoming
          ? `${a.name} arrives on the ${frozen} — a frozen roster spot with no weekly output until reinstated.`
          : `${a.name} leaves on the ${frozen}, clearing a frozen roster spot off your books.`,
      });
    } else if (status && status !== "HEALTHY" && status !== "ACTIVE") {
      out.push({
        tone: incoming ? "con" : "pro",
        text: incoming
          ? `${a.name} carries a ${status.toLowerCase()} tag into your lineup.`
          : `You offload ${a.name}'s ${status.toLowerCase()} tag.`,
      });
    }

    const t = scaleValue(Math.abs(a.trend));
    if (Math.abs(a.trend) >= 200) {
      const rising = a.trend > 0;
      out.push({
        tone: incoming === rising ? "pro" : "con",
        text: `${a.name} is ${rising ? "up" : "down"} ${t.toFixed(1)} on the 30-day market — ${
          rising ? "momentum is climbing" : "value is bleeding"
        }.`,
      });
    }
  }

  const top = [...input.assets].sort((a, b) => b.value - a.value)[0];
  if (top && top.value > 0) {
    out.push({
      tone: incoming ? "pro" : "con",
      text: `${incoming ? "Headline return" : "Headline cost"}: ${top.name} at ${scaleValue(
        top.value,
      ).toFixed(1)} market value${packagePhrase(input.assets.length)}.`,
    });
  }

  if (incoming && input.impact) {
    const d = input.impact.delta;
    if (d > 0.25) {
      out.push({
        tone: "pro",
        text: `Starting Lineup Boost: Increases your projected active scoring by ${d.toFixed(
          1,
        )} pts/week (${(d * WEEKS_LEFT).toFixed(1)} pts over season).`,
      });
    } else if (d < -0.25) {
      out.push({
        tone: "con",
        text: `Starting Lineup Drop: Reduces your projected active scoring by ${Math.abs(d).toFixed(
          1,
        )} pts/week (${Math.abs(d * WEEKS_LEFT).toFixed(1)} pts over season).`,
      });
    }
    const b = input.benchDelta ?? 0;
    if (Math.abs(b) >= 0.25) {
      out.push({
        tone: b > 0 ? "pro" : "con",
        text: `Bench Depth Differential: Modifies bench totals by ${b > 0 ? "+" : ""}${b.toFixed(
          1,
        )} pts/week (${b > 0 ? "+" : ""}${(b * WEEKS_LEFT).toFixed(1)} pts over season).`,
      });
    }
  }

  if (incoming && input.dropSlots && input.dropSlots > 0) {
    out.push({
      tone: "critical",
      text: `Roster Impact: Completing this ${input.assets.length}-for-${
        input.assets.length - input.dropSlots
      } or multi-player deal will require manually dropping ${input.dropSlots} bench asset${
        input.dropSlots > 1 ? "s" : ""
      } to clear active roster cap constraints.`,
    });
  }

  if (!out.length) {
    out.push({
      tone: "con",
      text: incoming
        ? "No incoming assets selected yet."
        : "No outgoing assets selected yet.",
    });
  }

  // Force all green positives (+) to the top, then red negatives (-) below.
  const toneOrder: Record<Bullet["tone"], number> = { pro: 0, con: 1, critical: 2 };
  out.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

  return out;
}

export type PositionalDepthRow = { pos: string; delta: number };

/** Net scaled value gained or lost at each individual position slot. */
export function positionalDepth(
  give: { pos: string; value: number }[],
  get: { pos: string; value: number }[],
): PositionalDepthRow[] {
  const totals: Record<string, number> = {};
  for (const p of give) {
    const pos = String(p.pos ?? "").toUpperCase();
    if (!pos) continue;
    totals[pos] = (totals[pos] ?? 0) - Math.max(0, p.value);
  }
  for (const p of get) {
    const pos = String(p.pos ?? "").toUpperCase();
    if (!pos) continue;
    totals[pos] = (totals[pos] ?? 0) + Math.max(0, p.value);
  }
  return Object.entries(totals)
    .map(([pos, raw]) => ({ pos, delta: Math.round((raw / VALUE_SCALE) * 10) / 10 }))
    .filter((r) => Math.abs(r.delta) > 0.05)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export type InjuryRisk = {
  level: "INCREASED" | "REDUCED" | "NEUTRAL";
  incoming: number;
  outgoing: number;
  note: string;
};

const RISK_WEIGHT: Record<string, number> = {
  IR: 4,
  PUP: 4,
  SUSPENDED: 4,
  EXEMPT: 3,
  NA: 3,
  DOUBTFUL: 3,
  OUT: 3,
  QUESTIONABLE: 2,
  PROBABLE: 1,
  DTD: 1,
};

function riskScore(list: { injuryStatus: string }[]): number {
  return list.reduce(
    (s, p) => s + (RISK_WEIGHT[(p.injuryStatus ?? "").trim().toUpperCase()] ?? 0),
    0,
  );
}

/** Compare the medical exposure of the incoming package against the outgoing. */
export function injuryRisk(
  give: { injuryStatus: string }[],
  get: { injuryStatus: string }[],
): InjuryRisk {
  const outgoing = riskScore(give);
  const incoming = riskScore(get);
  const diff = incoming - outgoing;
  const level = diff > 0 ? "INCREASED" : diff < 0 ? "REDUCED" : "NEUTRAL";
  const note =
    diff > 0
      ? "The incoming package carries more active medical exposure than the players you send out."
      : diff < 0
        ? "You shed more medical exposure than you take on — the roster gets healthier."
        : "Medical exposure is unchanged on both sides of this deal.";
  return { level, incoming, outgoing, note };
}

/* ------------------------------------------------------------------ *
 * Market Radar: net-value waiver adds with positional capacity guards.
 * ------------------------------------------------------------------ */

export type WaiverFitPlayer = FitPlayer & {
  /** Display name for UI consumers (optional for pure math). */
  name?: string;
  /** NFL team abbreviation for schedule / kickoff lock checks. */
  team?: string;
  /** Sleeper / catalog injury token (`Out`, `Questionable`, `IR`, …). */
  injury_status?: string | null;
  injuryStatus?: string | null;
  /** Explicit schedule phase: `pre` | `in` | `post` (or Sleeper status strings). */
  gamePhase?: string | null;
  /** Raw kickoff / Sleeper game status token when phase is unavailable. */
  gameStatus?: string | null;
};

export type WaiverDropAddSuggestion = {
  add: WaiverFitPlayer;
  drop: WaiverFitPlayer;
  addProj: number;
  dropProj: number;
  /** Net Value = add projected points − drop projected points. */
  netValue: number;
};

/**
 * True when the player's NFL game has kicked off, is live, or is finished —
 * those players must never populate Market Radar waiver adds.
 */
export function isWaiverGameLocked(input: {
  gamePhase?: string | null;
  gameStatus?: string | null;
}): boolean {
  const hay = `${input.gamePhase ?? ""} ${input.gameStatus ?? ""}`.toLowerCase().trim();
  if (!hay) return false;
  // Explicit unplayed / pre-kickoff tokens stay eligible.
  if (
    /\b(pre|scheduled|preview|not[_\s-]?started|upcoming)\b/.test(hay) &&
    !/\b(in_progress|in-progress|live|playing|done|final|post|complete)\b/.test(hay)
  ) {
    return false;
  }
  return /\b(in_progress|in-progress|live|playing|done|final|post|complete|in)\b/.test(hay);
}

const WAIVER_INJURY_BLACKLIST = new Set([
  "OUT",
  "O",
  "DOUBTFUL",
  "IR",
  "INJURED RESERVE",
  "PUP",
  "SUSPENDED",
  "NA",
  "EXEMPT",
  "QUESTIONABLE",
  "Q",
  "DTD",
]);

/**
 * True when the free agent carries an active injury / inactive designation
 * that should suppress Market Radar waiver recommendations.
 */
export function isWaiverInjuryBlacklisted(
  injury: string | null | undefined,
): boolean {
  const raw = (injury ?? "").trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (
    upper === "HEALTHY" ||
    upper === "ACTIVE" ||
    upper === "NONE" ||
    upper === "PROBABLE"
  ) {
    return false;
  }
  if (WAIVER_INJURY_BLACKLIST.has(upper)) return true;
  // Mid-game / free-text injury notes (e.g. "Hip", "Left Ankle - Out").
  if (/\b(out|doubtful|injured|injury|ir|pup|hip|knee|ankle|concussion)\b/i.test(raw)) {
    return true;
  }
  return false;
}

function waiverPlayerEligible(p: WaiverFitPlayer): boolean {
  if (
    isWaiverGameLocked({
      gamePhase: p.gamePhase ?? null,
      gameStatus: p.gameStatus ?? null,
    })
  ) {
    return false;
  }
  const injury = p.injury_status ?? p.injuryStatus ?? null;
  if (isWaiverInjuryBlacklisted(injury)) return false;
  return true;
}

/**
 * Anti-vacancy safety: never drop a player when it would leave a required
 * starting position uncovered (e.g. sole Defense or Kicker), or when the
 * post-drop optimized lineup would gain starter vacancies.
 */
export function isDropProtected(
  candidate: FitPlayer,
  roster: FitPlayer[],
  starters: Record<string, number>,
  scoring?: LeagueScoringContext | null,
): boolean {
  const req = { ...BASE_STARTERS, ...starters };
  const pool = applyLeagueScoring(roster, scoring);
  const target = applyLeagueScoring([candidate], scoring)[0]!;
  const pos = fitPos(target);
  const need = Math.max(0, req[pos] ?? 0);
  const peers = pool.filter((p) => fitPos(p) === pos);

  // Standalone essential starters (DEF / K / any sole required slot).
  if (need > 0 && peers.length <= need) return true;

  const before = optimizeLineup(pool, req);
  const after = optimizeLineup(
    pool.filter((p) => !sameFitPlayer(p, target)),
    req,
  );
  if (after.vacancyCount > before.vacancyCount) return true;

  return false;
}

/**
 * Rank free-agent adds paired with the safest lowest-value bench drop.
 *
 * Hard rules:
 * - Net Value = add proj − drop proj must be positive.
 * - Never exceed MAX_QB_ROSTER_CAPACITY (2) after the swap.
 * - Never drop RB/WR depth to add QB/TE/K/DEF (depth-bleed clause).
 * - Never open starter vacancies under synced league slot settings.
 * - Free agents are ranked with FantasyCalc value/trend + optional Sleeper
 *   trending-add momentum before pairing drops.
 * - Game-lock: skip players whose NFL game is live / finished.
 * - Injury blacklist: skip active injury designations.
 */
export function suggestWaiverTransactions(input: {
  roster: FitPlayer[];
  /** Preferred drop pool — typically bench slots. Falls back to roster. */
  bench?: FitPlayer[];
  freeAgents: WaiverFitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
  limit?: number;
  /**
   * Cross-referenced market signals keyed by player id:
   * FantasyCalc `value` / `trend`, plus Sleeper trending-add `count`.
   */
  marketById?: Record<
    string,
    { value?: number; trend?: number; sleeperAdds?: number }
  >;
  /** Optional NFL team → schedule phase (`pre` | `in` | `post`). */
  gamePhaseByTeam?: Record<string, string>;
  /** Optional player id → injury status override. */
  injuryById?: Record<string, string>;
}): WaiverDropAddSuggestion[] {
  const req = { ...BASE_STARTERS, ...input.starters };
  const roster = applyLeagueScoring(input.roster, input.scoring);
  const dropPoolRaw = input.bench?.length ? input.bench : input.roster;
  const dropPool = applyLeagueScoring(dropPoolRaw, input.scoring);
  const marketById = input.marketById ?? {};
  const gamePhaseByTeam = input.gamePhaseByTeam ?? {};
  const injuryById = input.injuryById ?? {};

  const enrich = (p: FitPlayer): WaiverFitPlayer => {
    const w = p as WaiverFitPlayer;
    const team = (w.team ?? "").trim().toUpperCase();
    const phaseFromMap = team ? gamePhaseByTeam[team] : undefined;
    const injuryFromMap = w.id ? injuryById[w.id] : undefined;
    return {
      ...w,
      team: w.team ?? team,
      gamePhase: w.gamePhase ?? phaseFromMap ?? null,
      gameStatus: w.gameStatus ?? phaseFromMap ?? null,
      injury_status: w.injury_status ?? w.injuryStatus ?? injuryFromMap ?? null,
      injuryStatus: w.injuryStatus ?? w.injury_status ?? injuryFromMap ?? null,
    };
  };

  const freeAgents = applyLeagueScoring(input.freeAgents, input.scoring)
    .map((p) => enrich(p))
    .filter((p) => Number.isFinite(p.weekly) && p.weekly > 0)
    .filter((p) => waiverPlayerEligible(p))
    .map((p) => {
      const m = marketById[p.id ?? ""] ?? {};
      const value = Number(m.value ?? 0) || 0;
      const trend = Number(m.trend ?? 0) || 0;
      const sleeperAdds = Math.max(0, Number(m.sleeperAdds ?? 0) || 0);
      // Trend-weighted rank: weekly floor + FantasyCalc momentum + Sleeper adds.
      const rankScore =
        p.weekly * 1.15 +
        scaleValue(value) * 0.1 +
        Math.max(0, trend) * 0.2 +
        Math.log1p(sleeperAdds) * 3.2;
      return { player: p, rankScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((row) => row.player);

  const before = optimizeLineup(roster, req);
  const limit = Math.max(1, input.limit ?? 2);
  const out: WaiverDropAddSuggestion[] = [];
  const usedAdds = new Set<string>();
  const usedDrops = new Set<string>();

  const dropKey = (p: FitPlayer) => p.id || `${fitPos(p)}:${p.weekly}`;

  for (const add of freeAgents) {
    if (out.length >= limit) break;
    const addKey = dropKey(add);
    if (usedAdds.has(addKey)) continue;

    const addPos = fitPos(add);

    let best: WaiverDropAddSuggestion | null = null;
    const rankedDrops = [...dropPool].sort((a, b) => a.weekly - b.weekly);

    for (const drop of rankedDrops) {
      const dKey = dropKey(drop);
      if (usedDrops.has(dKey)) continue;
      if (sameFitPlayer(add, drop)) continue;

      // Depth-bleed: never drop RB/WR for QB/TE/K/DEF.
      if (isDepthBleedExchange([drop], [add])) continue;

      // QB capacity: projected roster QBs must stay ≤ 2.
      if (exceedsQbRosterCapacity(roster, [drop], [add])) continue;

      if (isDropProtected(drop, roster, req, null)) continue;

      const netValue = add.weekly - drop.weekly;
      if (!(netValue > 0)) continue;

      const afterRoster = applyTrade(roster, [drop], [add]);
      const after = optimizeLineup(afterRoster, req);

      // Positional balance against synced starter slots.
      if (after.vacancyCount > before.vacancyCount) continue;
      if (after.points + 0.01 < before.points) continue;

      // Incoming add should crack the lineup OR be a clear same-pos upgrade
      // over the drop (e.g. QB→QB, WR→WR), not a pure bench clog.
      const withoutAdd = afterRoster.filter((p) => !sameFitPlayer(p, add));
      const withoutPts = optimizeLineup(withoutAdd, req).points;
      const cracksLineup = after.points - withoutPts > 0.05;
      const samePosUpgrade = fitPos(drop) === addPos && add.weekly > drop.weekly + 0.25;
      if (!cracksLineup && !samePosUpgrade && after.points <= before.points + 0.15) {
        continue;
      }

      const candidate: WaiverDropAddSuggestion = {
        add,
        drop,
        addProj: add.weekly,
        dropProj: drop.weekly,
        netValue,
      };
      if (!best || candidate.netValue > best.netValue) best = candidate;
    }

    if (best) {
      out.push(best);
      usedAdds.add(dropKey(best.add));
      usedDrops.add(dropKey(best.drop));
    }
  }

  return out.sort((a, b) => b.netValue - a.netValue).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Market Radar: 1:1 trade scan with 2-for-1 / 2-for-2 package fallback.
 * ------------------------------------------------------------------ */

export type MarketRadarTradeSuggestion = {
  give: FitPlayer[];
  get: FitPlayer[];
  managerLabel: string;
  managerSlot: number;
  fillPos: string;
  myDelta: number;
  oppDelta: number;
  packageKind: "1:1" | "2:1" | "2:2";
  score: number;
};

const PACKAGE_SKILL_POS = ["RB", "WR", "TE"] as const;

/** Loose roster row — FitPlayer fields or Player-like objects from synced league state. */
export type RosterPlayerBag = {
  id?: string;
  pos?: string;
  position?: string;
  weekly?: number;
  name?: string;
  proj?: number | { half?: number; std?: number; ppr?: number };
};

/**
 * Synced league roster containers may expose players under several keys
 * (`players`, `playerIds`, `roster_players`, `starters`/`bench`/`ir`, …).
 */
export type RosterSource =
  | FitPlayer[]
  | RosterPlayerBag[]
  | {
      players?: Array<RosterPlayerBag | null> | null;
      roster?: Array<RosterPlayerBag | null> | null;
      roster_players?: Array<RosterPlayerBag | null> | null;
      player_ids?: Array<string | RosterPlayerBag | null> | null;
      playerIds?: Array<string | RosterPlayerBag | null> | null;
      slots?: Array<RosterPlayerBag | null> | null;
      starters?: Array<RosterPlayerBag | null> | null;
      bench?: Array<RosterPlayerBag | null> | null;
      ir?: Array<RosterPlayerBag | null> | null;
    }
  | null
  | undefined;

function coerceFitPlayer(raw: unknown): FitPlayer | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RosterPlayerBag;
  const pos = String(row.pos ?? row.position ?? "").toUpperCase();
  if (!pos) return null;
  const projHalf =
    typeof row.proj === "number"
      ? row.proj
      : typeof row.proj === "object" && row.proj
        ? Number(row.proj.half ?? row.proj.ppr ?? row.proj.std ?? 0) || 0
        : 0;
  const weekly =
    typeof row.weekly === "number" && Number.isFinite(row.weekly)
      ? Number(row.weekly)
      : Math.max(0, projHalf / 17);
  const id = row.id != null && String(row.id).trim() ? String(row.id) : undefined;
  return id ? { id, pos, weekly } : { pos, weekly };
}

/**
 * Normalize a roster array / team object into FitPlayer[].
 * Tries `players`, `roster`, `roster_players`, `player_ids`/`playerIds`,
 * `slots`, then unions `starters` + `bench` + `ir` (Matchup / My Team shape).
 */
export function extractRosterPlayers(source: RosterSource): FitPlayer[] {
  if (!source) return [];

  const pushAll = (list: unknown, into: FitPlayer[], seen: Set<string>) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item == null) continue;
      if (typeof item === "string") continue; // bare ids need catalog resolve upstream
      const fit = coerceFitPlayer(item);
      if (!fit) continue;
      const key = fit.id || `${fit.pos}:${fit.weekly}`;
      if (seen.has(key)) continue;
      seen.add(key);
      into.push(fit);
    }
  };

  if (Array.isArray(source)) {
    const out: FitPlayer[] = [];
    const seen = new Set<string>();
    pushAll(source, out, seen);
    return out;
  }

  const bag = source;
  const out: FitPlayer[] = [];
  const seen = new Set<string>();

  // Prefer the resolved player list used by Matchup / My Team.
  pushAll(bag.players, out, seen);
  pushAll(bag.roster, out, seen);
  pushAll(bag.roster_players, out, seen);
  pushAll(bag.slots, out, seen);
  pushAll(bag.player_ids, out, seen);
  pushAll(bag.playerIds, out, seen);

  // Fallback: rebuild from lineup partitions when `.players` is empty.
  if (!out.length) {
    pushAll(bag.starters, out, seen);
    pushAll(bag.bench, out, seen);
    pushAll(bag.ir, out, seen);
  } else {
    // Still merge partitions so bench chips are present even if players is sparse.
    pushAll(bag.starters, out, seen);
    pushAll(bag.bench, out, seen);
    pushAll(bag.ir, out, seen);
  }

  return out;
}

function marketRawFor(
  p: FitPlayer,
  marketValueById?: Record<string, number>,
): number {
  const id = p.id ?? "";
  const fromMarket = id && marketValueById ? marketValueById[id] : undefined;
  if (typeof fromMarket === "number" && Number.isFinite(fromMarket) && fromMarket > 0) {
    return fromMarket;
  }
  // Weekly projection proxy when FantasyCalc is unavailable.
  return Math.max(0, p.weekly) * 12;
}

/** Net roster value gate using consolidation-aware packageScore. */
export function passesNetRosterValue(
  give: FitPlayer[],
  get: FitPlayer[],
  marketValueById?: Record<string, number>,
  /** Minimum get/give packageScore ratio (default 0.8; packages may use 0.72). */
  minRatio = 0.8,
): boolean {
  if (!give.length || !get.length) return false;
  const giveVals = give.map((p) => marketRawFor(p, marketValueById));
  const getVals = get.map((p) => marketRawFor(p, marketValueById));
  const giveScore = packageScore(giveVals, get.length);
  const getScore = packageScore(getVals, give.length);
  if (giveScore <= 0 && getScore <= 0) return false;
  // Accept when the return clears the ratio of the sent package (consolidation OK).
  return getScore >= giveScore * minRatio;
}

function skillWeakness(
  roster: FitPlayer[],
  starters: Record<string, number>,
): { pos: string; pts: number } | null {
  const req = { ...BASE_STARTERS, ...starters };
  const lineup = optimizeLineup(roster, req);
  let worst: { pos: string; pts: number } | null = null;
  for (const pos of PACKAGE_SKILL_POS) {
    if ((req[pos] ?? 0) <= 0) continue;
    const pts = (lineup.bySlot[pos] ?? 0) - (lineup.vacancies[pos] ?? 0) * 18;
    if (!worst || pts < worst.pts) worst = { pos, pts };
  }
  return worst;
}

/** Lowest FantasyCalc market-value total among skill positions on a roster. */
function marketPosWeakness(
  roster: FitPlayer[],
  marketValueById: Record<string, number>,
): { pos: string; total: number } | null {
  let worst: { pos: string; total: number } | null = null;
  for (const pos of PACKAGE_SKILL_POS) {
    const total = roster
      .filter((p) => fitPos(p) === pos)
      .reduce((sum, p) => sum + marketRawFor(p, marketValueById), 0);
    if (!worst || total < worst.total) worst = { pos, total };
  }
  return worst;
}

/** Highest FantasyCalc market-value total among skill positions on a roster. */
function marketPosStrength(
  roster: FitPlayer[],
  marketValueById: Record<string, number>,
): { pos: string; total: number } | null {
  let best: { pos: string; total: number } | null = null;
  for (const pos of PACKAGE_SKILL_POS) {
    const total = roster
      .filter((p) => fitPos(p) === pos)
      .reduce((sum, p) => sum + marketRawFor(p, marketValueById), 0);
    if (!best || total > best.total) best = { pos, total };
  }
  return best;
}

function bestAtPos(roster: FitPlayer[], pos: string): FitPlayer | null {
  const needle = pos.toUpperCase();
  let best: FitPlayer | null = null;
  for (const p of roster) {
    if (fitPos(p) !== needle) continue;
    if (!best || p.weekly > best.weekly) best = p;
  }
  return best;
}

function evaluateDeal(input: {
  myRoster: FitPlayer[];
  oppRoster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
  marketValueById?: Record<string, number>;
  managerLabel: string;
  managerSlot: number;
  fillPos: string;
  packageKind: MarketRadarTradeSuggestion["packageKind"];
}): MarketRadarTradeSuggestion | null {
  const scoring = input.scoring ?? null;
  const marketValueById = input.marketValueById ?? {};
  const req = { ...BASE_STARTERS, ...input.starters };

  if (exceedsQbRosterCapacity(input.myRoster, input.give, input.get)) return null;
  if (exceedsQbRosterCapacity(input.oppRoster, input.get, input.give)) return null;
  const valueRatio = input.packageKind === "1:1" ? 0.8 : 0.72;
  if (!passesNetRosterValue(input.give, input.get, marketValueById, valueRatio)) return null;

  // Dual-sided starting-lineup simulation (same starter config for both clubs).
  const myRoster = applyLeagueScoring(input.myRoster, scoring);
  const oppRoster = applyLeagueScoring(input.oppRoster, scoring);
  const give = applyLeagueScoring(input.give, scoring);
  const get = applyLeagueScoring(input.get, scoring);

  const myBefore = optimizeLineup(myRoster, req);
  const oppBefore = optimizeLineup(oppRoster, req);
  const myAfterRoster = applyTrade(myRoster, give, get);
  // Opponent sends `get` and receives `give`.
  const oppAfterRoster = applyTrade(oppRoster, get, give);
  const myAfter = optimizeLineup(myAfterRoster, req);
  const oppAfter = optimizeLineup(oppAfterRoster, req);

  const userDelta = myAfter.points - myBefore.points;
  const opponentDelta = oppAfter.points - oppBefore.points;

  // MUTUAL UPGRADE RULE — both starting lineups must improve.
  if (!(userDelta > 0 && opponentDelta > 0)) return null;

  // Never open new starter vacancies on either side.
  if (myAfter.vacancyCount > myBefore.vacancyCount) return null;
  if (oppAfter.vacancyCount > oppBefore.vacancyCount) return null;

  // Depth-strip guard: do not take an opponent asset that collapses a required
  // position to a zero-point starter (e.g. sole RB → empty / 0-pt filler).
  for (const taken of get) {
    const pos = fitPos(taken);
    const need = Math.max(0, req[pos] ?? 0);
    if (need <= 0) continue;
    const beforePts = oppBefore.bySlot[pos] ?? 0;
    const afterPts = oppAfter.bySlot[pos] ?? 0;
    if (beforePts > 1 && afterPts <= 0.05) return null;
    const remaining = countRosterPos(oppAfterRoster, pos);
    if (remaining < need && (oppAfter.vacancies[pos] ?? 0) > 0) return null;
  }

  // Incoming assets the user sends must crack the opponent's optimized lineup
  // (dedicated slot or FLEX) — patching a real starting / flex deficit.
  let giveCracksOppLineup = false;
  for (const incoming of give) {
    const without = oppAfterRoster.filter((p) => !sameFitPlayer(p, incoming));
    if (oppAfter.points - optimizeLineup(without, req).points > 0.05) {
      giveCracksOppLineup = true;
      break;
    }
  }
  if (!giveCracksOppLineup) return null;

  // Incoming assets the user receives must likewise crack our lineup.
  let getCracksMyLineup = false;
  for (const incoming of get) {
    const without = myAfterRoster.filter((p) => !sameFitPlayer(p, incoming));
    if (myAfter.points - optimizeLineup(without, req).points > 0.05) {
      getCracksMyLineup = true;
      break;
    }
  }
  if (!getCracksMyLineup) return null;

  // Soft positional fit: at least one give player should address opp weakness
  // or register a positive dedicated/FLEX slot delta for them.
  const oppHole = skillWeakness(oppRoster, req);
  const mineImpact = marginalImpact({
    roster: myRoster,
    give,
    get,
    starters: req,
    scoring,
  });
  const theirsImpact = opponentImpact({
    roster: oppRoster,
    give,
    get,
    starters: req,
    scoring,
  });
  const giveHelpsOppNeed = give.some((g) => {
    const pos = fitPos(g);
    if (oppHole && pos === oppHole.pos) return true;
    if ((theirsImpact.slotDelta[pos] ?? 0) > 0.05) return true;
    if (FLEX_ELIGIBLE.includes(pos) && (theirsImpact.slotDelta["FLEX"] ?? 0) > 0.05) return true;
    return false;
  });
  if (!giveHelpsOppNeed && opponentDelta < 0.25) return null;

  // Keep established 1:1 starter-eligibility / package clog rails.
  if (input.packageKind === "1:1") {
    if (
      !tradeStarterEligible({
        roster: myRoster,
        give,
        get,
        starters: req,
        scoring,
      }).eligible
    ) {
      return null;
    }
  } else {
    const onlyBenchSingles =
      get.every((p) => SINGLE_STARTER_BENCH_POSITIONS.has(fitPos(p))) &&
      userDelta < 0.5 &&
      get.every((p) => ["K", "DEF"].includes(fitPos(p)));
    if (onlyBenchSingles) return null;
  }

  // Depth-bleed rail (user): never strip our RB/WR for QB/K/DEF bench clogs.
  if (
    isDepthBleedExchange(give, get) &&
    get.every((p) => ["QB", "K", "DEF"].includes(fitPos(p)))
  ) {
    return null;
  }

  return {
    give: input.give,
    get: input.get,
    managerLabel: input.managerLabel,
    managerSlot: input.managerSlot,
    fillPos: input.fillPos,
    myDelta: userDelta,
    oppDelta: opponentDelta,
    packageKind: input.packageKind,
    score:
      userDelta +
      opponentDelta +
      (input.packageKind === "1:1" ? 0.35 : 0) +
      (mineImpact.delta > 0 && theirsImpact.delta > 0 ? 0.1 : 0),
  };
}

/**
 * Market Radar trade matcher: strict 1:1 starter upgrades first, then a
 * consolidation Package Scan (2-for-1 / 2-for-2) when no 1:1 surfaces.
 */
export function suggestMarketRadarTrade(input: {
  /** FitPlayer[] or a synced team object (`players` / starters / bench / ir). */
  myRoster: RosterSource;
  myBench?: RosterSource;
  opponents: {
    slot: number;
    label: string;
    /** FitPlayer[] or full team object — multi-key extraction applied. */
    roster?: RosterSource;
    players?: RosterSource;
    player_ids?: RosterSource;
    playerIds?: RosterSource;
    roster_players?: RosterSource;
  }[];
  starters: Record<string, number>;
  scoring?: LeagueScoringContext | null;
  marketValueById?: Record<string, number>;
}): MarketRadarTradeSuggestion | null {
  // Flexible multi-property extraction (Matchup / My Team use `.players`,
  // with `.starters` + `.bench` + `.ir` as fallbacks).
  const userPlayers = extractRosterPlayers(input.myRoster);
  const myRoster = applyLeagueScoring(userPlayers, input.scoring);
  const starters = { ...BASE_STARTERS, ...input.starters };
  const scoring = input.scoring ?? null;

  const resolveOppPlayers = (opp: (typeof input.opponents)[number]): FitPlayer[] => {
    for (const candidate of [
      opp.roster,
      opp.players,
      opp.playerIds,
      opp.player_ids,
      opp.roster_players,
      opp as unknown as RosterSource,
    ]) {
      const extracted = extractRosterPlayers(candidate ?? null);
      if (extracted.length) return extracted;
    }
    return [];
  };

  const oppPools = (input.opponents ?? []).map((o) =>
    applyLeagueScoring(resolveOppPlayers(o), scoring),
  );
  const marketValueById = ensureMarketValueMap(input.marketValueById, [
    myRoster,
    ...oppPools,
  ]);

  // Browser DevTools (F12) tracing — authentic roster / FantasyCalc key alignment.
  console.log(
    "DEBUG TRADE RADAR - User Roster Size:",
    userPlayers?.length,
    "Opponent Teams Found:",
    input.opponents?.length,
  );
  {
    const sampleOpp = input.opponents?.[0];
    const sampleOppPlayers = sampleOpp ? resolveOppPlayers(sampleOpp) : [];
    const samplePlayers = [...(userPlayers ?? []).slice(0, 3), ...sampleOppPlayers.slice(0, 2)];
    for (const player of samplePlayers) {
      const catalogHit =
        player?.id != null && player.id !== ""
          ? marketValueById[player.id]
          : undefined;
      console.log(
        "DEBUG KEY MATCH - Roster Player ID Sample:",
        player?.id,
        "Catalog ID Match:",
        catalogHit != null ? catalogHit : undefined,
      );
    }
    console.log(
      "DEBUG TRADE RADAR - FantasyCalc map keys:",
      Object.keys(marketValueById).length,
      "My bench size:",
      extractRosterPlayers(input.myBench).length,
      "Opponent roster sizes:",
      (input.opponents ?? []).map((o) => ({
        slot: o.slot,
        label: o.label,
        size: resolveOppPlayers(o).length,
      })),
    );
  }

  const benchSource = extractRosterPlayers(input.myBench);
  const myBench = applyLeagueScoring(
    benchSource.length
      ? benchSource
      : [...myRoster].sort((a, b) => a.weekly - b.weekly).slice(0, 6),
    scoring,
  );

  const state: { best: MarketRadarTradeSuggestion | null } = { best: null };

  const consider = (cand: MarketRadarTradeSuggestion | null) => {
    if (!cand) return;
    if (!state.best || cand.score > state.best.score) state.best = cand;
  };

  // Pass A — strict 1:1
  const myPool = [...myRoster].sort((a, b) => b.weekly - a.weekly).slice(0, 8);
  console.log(
    "DEBUG TRADE RADAR - Pass A 1:1 pool sizes — myPool:",
    myPool.length,
    "opponents:",
    input.opponents.length,
  );
  for (const opp of input.opponents) {
    const oppRoster = applyLeagueScoring(resolveOppPlayers(opp), scoring);
    const getPool = [...oppRoster].sort((a, b) => b.weekly - a.weekly).slice(0, 10);
    console.log(
      "DEBUG TRADE RADAR - 1:1 opponent scan:",
      opp.label,
      "oppRoster:",
      oppRoster.length,
      "getPool:",
      getPool.length,
    );
    for (const give of myPool) {
      for (const get of getPool) {
        if (sameFitPlayer(give, get)) continue;
        consider(
          evaluateDeal({
            myRoster,
            oppRoster,
            give: [give],
            get: [get],
            starters,
            scoring,
            marketValueById,
            managerLabel: opp.label,
            managerSlot: opp.slot,
            fillPos: fitPos(get),
            packageKind: "1:1",
          }),
        );
      }
    }
  }

  if (state.best) {
    console.log(
      "DEBUG TRADE RADAR - early return after 1:1 hit:",
      state.best.packageKind,
      state.best.managerLabel,
      "giveIds:",
      state.best.give.map((p) => p.id),
      "getIds:",
      state.best.get.map((p) => p.id),
    );
    return state.best;
  }
  console.log("DEBUG TRADE RADAR - no 1:1 cleared filters; entering Package Scan");
  const myNeed = skillWeakness(myRoster, starters);
  const myMarketStrength = marketPosStrength(myRoster, marketValueById);

  for (const opp of input.opponents) {
    const oppRoster = applyLeagueScoring(resolveOppPlayers(opp), scoring);
    const oppMarketHole = marketPosWeakness(oppRoster, marketValueById);
    const oppLineupHole = skillWeakness(oppRoster, starters);
    const holePos = oppMarketHole?.pos ?? oppLineupHole?.pos;
    if (!holePos) continue;

    const patchPos =
      myMarketStrength && myMarketStrength.pos === holePos
        ? holePos
        : countRosterPos(myBench, holePos) > 0
          ? holePos
          : holePos;

    const patchStarter = bestAtPos(myRoster, patchPos);
    if (!patchStarter || patchStarter.weekly < 3.5) continue;

    const benchChips = [...myBench]
      .filter((p) => !sameFitPlayer(p, patchStarter))
      .filter((p) => !isDropProtected(p, myRoster, starters, null))
      .filter((p) => !(SKILL_DEPTH_POSITIONS.has(fitPos(p)) && fitPos(p) !== holePos))
      .sort((a, b) => {
        const av = marketRawFor(a, marketValueById);
        const bv = marketRawFor(b, marketValueById);
        return av - bv || a.weekly - b.weekly;
      })
      .slice(0, 5);
    if (!benchChips.length) continue;

    const eliteTargets: FitPlayer[] = [];
    if (myNeed) {
      const atNeed = bestAtPos(oppRoster, myNeed.pos);
      if (atNeed && fitPos(atNeed) !== holePos) eliteTargets.push(atNeed);
    }
    const oppStrength = marketPosStrength(oppRoster, marketValueById);
    if (oppStrength && oppStrength.pos !== holePos) {
      const elite = bestAtPos(oppRoster, oppStrength.pos);
      if (elite && !eliteTargets.some((e) => sameFitPlayer(e, elite))) {
        eliteTargets.push(elite);
      }
    }
    for (const pos of PACKAGE_SKILL_POS) {
      if (pos === holePos) continue;
      const elite = bestAtPos(oppRoster, pos);
      if (elite && !eliteTargets.some((e) => sameFitPlayer(e, elite))) {
        eliteTargets.push(elite);
      }
    }
    eliteTargets.sort(
      (a, b) =>
        marketRawFor(b, marketValueById) - marketRawFor(a, marketValueById) ||
        b.weekly - a.weekly,
    );
    const topElites = eliteTargets.slice(0, 4);

    for (const bench of benchChips) {
      for (const elite of topElites) {
        if (isDepthBleedExchange([patchStarter, bench], [elite]) && fitPos(elite) !== "TE") {
          if (SINGLE_STARTER_BENCH_POSITIONS.has(fitPos(elite)) && fitPos(elite) !== "TE") {
            continue;
          }
        }
        if (
          SKILL_DEPTH_POSITIONS.has(fitPos(patchStarter)) &&
          ["QB", "K", "DEF"].includes(fitPos(elite))
        ) {
          continue;
        }

        consider(
          evaluateDeal({
            myRoster,
            oppRoster,
            give: [patchStarter, bench],
            get: [elite],
            starters,
            scoring,
            marketValueById,
            managerLabel: opp.label,
            managerSlot: opp.slot,
            fillPos: fitPos(elite),
            packageKind: "2:1",
          }),
        );

        const secondaryPool = [...oppRoster]
          .filter((p) => !sameFitPlayer(p, elite))
          .filter(
            (p) =>
              fitPos(p) !== "QB" || countRosterPos(myRoster, "QB") < MAX_QB_ROSTER_CAPACITY,
          )
          .sort(
            (a, b) =>
              marketRawFor(b, marketValueById) - marketRawFor(a, marketValueById) ||
              b.weekly - a.weekly,
          )
          .slice(0, 4);
        for (const secondary of secondaryPool) {
          if (
            SKILL_DEPTH_POSITIONS.has(fitPos(patchStarter)) &&
            ["QB", "K", "DEF"].includes(fitPos(secondary)) &&
            !SKILL_DEPTH_POSITIONS.has(fitPos(elite))
          ) {
            continue;
          }
          consider(
            evaluateDeal({
              myRoster,
              oppRoster,
              give: [patchStarter, bench],
              get: [elite, secondary],
              starters,
              scoring,
              marketValueById,
              managerLabel: opp.label,
              managerSlot: opp.slot,
              fillPos: fitPos(elite),
              packageKind: "2:2",
            }),
          );
        }
      }
    }
  }

  const packageResult: MarketRadarTradeSuggestion | null = state["best"];
  console.log("DEBUG TRADE RADAR - Package Scan complete. Result:", packageResult);
  return packageResult;
}

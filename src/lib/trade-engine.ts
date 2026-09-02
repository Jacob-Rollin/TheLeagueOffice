/**
 * Asymmetric trade grading engine.
 *
 * Handles unequal packages (2-for-1, 3-for-2, …) by discounting the wider
 * side of the deal, which is the mathematical expression of the consolidation
 * premium: value concentrated in one elite asset is worth more than the same
 * raw total spread across roster filler.
 *
 * Pure math only — no UI, no data fetching.
 */

/** Discount applied to the aggregate score of the side sending more bodies. */
export const CONSOLIDATION_DISCOUNT = 0.15;

/** Exponential power-curve exponent: elite assets bend the curve upward. */
export const VALUE_CURVE_POWER = 1.18;
/** Geometric decay applied to each successive (lesser) asset in a package. */
export const PACKAGE_DECAY = 0.82;

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

export type FitPlayer = { pos: string; weekly: number };

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
): Lineup {
  const req = { ...BASE_STARTERS, ...starters };
  const pool = [...players].sort((a, b) => b.weekly - a.weekly);
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
      if (p.pos !== pos || (p as { _used?: boolean })._used) continue;
      (p as { _used?: boolean })._used = true;
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
    if ((p as { _used?: boolean })._used) continue;
    if (!FLEX_ELIGIBLE.includes(p.pos)) continue;
    (p as { _used?: boolean })._used = true;
    points += p.weekly;
    bySlot['FLEX'] = (bySlot['FLEX'] ?? 0) + p.weekly;
    flexFilled++;
    used++;
  }
  if (flexFilled < flexNeed) vacancies['FLEX'] = flexNeed - flexFilled;

  for (const p of pool) delete (p as { _used?: boolean })._used;

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
}): MarginalImpact {
  const req = { ...BASE_STARTERS, ...input.starters };
  const before = optimizeLineup(input.roster, req);
  const after = optimizeLineup(applyTrade(input.roster, input.give, input.get), req);
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
 */
export function rosterFit(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
}): RosterFit & { impact: MarginalImpact } {
  const req = { ...BASE_STARTERS, ...input.starters };
  const before = optimizeLineup(input.roster, req);
  const now = optimizeLineup(applyTrade(input.roster, input.give, input.get), req);
  const impact = marginalImpact(input);

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
  if (impact.delta <= 0) {
    for (const p of input.get) if (!fills.includes(p.pos) && !clogs.includes(p.pos)) clogs.push(p.pos);
  }

  pct = Math.max(-25, Math.min(25, Math.round(pct)));

  const d = impact.delta;
  const note = !input.get.length
    ? "No incoming players to fit."
    : d > 0.25
      ? `Marginal lineup margin +${d.toFixed(1)} pts/wk — the incoming assets start for you at ${fills.join(", ") || "flex"}.`
      : d < -0.25
        ? `Marginal lineup margin ${d.toFixed(1)} pts/wk — your optimized starting lineup gets weaker${clogs.length ? ` and the return is bench depth at ${clogs.join(", ")}` : ""}.`
        : "Neutral fit — the optimized starting lineup output is unchanged.";

  return { pct, fills, clogs, note, impact };
}




export type RosterConstraint = {
  /** True when accepting the deal overflows the roster cap. */
  overflow: boolean;
  /** How many players must be dropped. */
  dropCount: number;
  /** Weekly projection subtracted from the "You receive" score. */
  penalty: number;
  /** Name of the simulated drop, when one was identified. */
  dropName: string | null;
  /** Every simulated drop, in order. */
  dropNames: string[];
  /** True when the vacancy shield blocked every remaining candidate. */
  shielded: boolean;
};

/**
 * Bench-vacancy verification. Only runs when the manager is receiving more
 * players than they send out.
 *
 * Vacancy shield: a player who is the last body at a required starting
 * position (the only DEF, the only K, …) can never be recommended as a drop,
 * so the suggestion always targets a genuine bench surplus.
 */
export function rosterConstraint(input: {
  rosterCount: number;
  rosterCap: number;
  giveCount: number;
  getCount: number;
  /** Bench-eligible players on the manager's roster, with weekly projections. */
  bench: { name: string; weekly: number; pos?: string }[];
  /** Required starters by position, used by the vacancy shield. */
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
  const picked: { name: string; weekly: number }[] = [];
  let shielded = false;

  for (const c of candidates) {
    if (picked.length >= over) break;
    const pos = c.pos ?? "";
    const required = starters[pos] ?? 0;
    // Hardlock: dropping this body would leave the lineup slot vacant.
    if (required > 0 && (remaining[pos] ?? 0) <= required) {
      shielded = true;
      continue;
    }
    remaining[pos] = (remaining[pos] ?? 1) - 1;
    picked.push({ name: c.name, weekly: c.weekly });
  }

  const penalty = picked.reduce((s, p) => s + p.weekly, 0);
  return {
    overflow: true,
    dropCount: over,
    penalty,
    dropName: picked[0]?.name ?? null,
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
 * Executive summary driven by the marginal starting-lineup simulation: it
 * names the slots whose weekly floor actually moved, not the raw value gap.
 */
export function executiveSummary(input: {
  ready: boolean;
  pct: number;
  giveCount: number;
  getCount: number;
  overflow: boolean;
  impact?: MarginalImpact;
}): string {
  if (!input.ready) return "Add players to both sides to run the valuation model.";
  const consolidating = input.getCount < input.giveCount;
  const spreading = input.getCount > input.giveCount;

  const impact = input.impact;
  if (impact) {
    const shifts = Object.entries(impact.slotDelta)
      .filter(([, v]) => Math.abs(v) >= 0.25)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const ups = shifts.filter(([, v]) => v > 0);
    const downs = shifts.filter(([, v]) => v < 0);
    const fmt = (e: [string, number]) =>
      `${SLOT_LABEL[e[0]] ?? e[0]} tier floor (${e[1] > 0 ? "+" : ""}${e[1].toFixed(1)} pts/wk)`;

    if (impact.delta > 0.25) {
      const lead = ups.length ? fmt(ups[0]!) : "weekly starting floor";
      const tail = downs.length
        ? ` while giving back ${downs[0]![1].toFixed(1)} pts/wk at ${SLOT_LABEL[downs[0]![0]] ?? downs[0]![0]}`
        : ", while holding positional parity everywhere else";
      const scale = impact.delta >= 2 ? "significantly upgrades" : "upgrades";
      return `TRADE PROPOSAL ANALYSIS: This deal ${scale} your starting ${lead}${tail}. Net marginal lineup margin: +${impact.delta.toFixed(1)} pts/wk${spreading ? ", and that starting upgrade outweighs the bench depth you dilute." : "."}`;
    }
    if (impact.delta < -0.25) {
      const lead = downs.length ? fmt(downs[0]!) : "weekly starting floor";
      const tail = ups.length ? ` The only gain is ${fmt(ups[0]!)}.` : "";
      return `TRADE PROPOSAL ANALYSIS: This deal downgrades your starting ${lead}. Net marginal lineup margin: ${impact.delta.toFixed(1)} pts/wk.${tail}`;
    }
    return `TRADE PROPOSAL ANALYSIS: Your optimized starting lineup projects the same output either way (${impact.delta >= 0 ? "+" : ""}${impact.delta.toFixed(1)} pts/wk). ${consolidating ? "You consolidate bodies without changing weekly production." : "Decide this one on schedule, bye weeks, and long-term outlook."}`;
  }



  if (input.pct >= 15)
    return consolidating
      ? "Clear win. You are consolidating depth into the best asset in the deal, and that premium shows up in every weekly lineup."
      : "Clear win. The incoming package returns materially more weekly production than what leaves your roster.";
  if (input.pct >= 8)
    return "Favorable. Value tilts to your side once star weighting and roster fit are applied.";
  if (input.pct > -8)
    return spreading
      ? "Balanced. The two sides price out close, but you are trading a premium asset for quantity — make sure the depth actually starts for you."
      : "Balanced. Value is distributed evenly across both packages; decide this one on scheme fit and bye weeks.";
  if (input.pct > -15)
    return "Unfavorable. You are shipping out more weekly production than the return justifies.";
  return spreading
    ? "Decline. You are surrendering the best player in the deal and receiving filler that will not crack your starting lineup."
    : "Decline. The value gap is wide and the incoming package does not close it.";
}

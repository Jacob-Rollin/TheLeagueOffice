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

/** Star-weighted aggregate: the best asset carries most of the package. */
export function starWeighted(values: number[]): number {
  return [...values]
    .sort((a, b) => b - a)
    .reduce((sum, v, i) => sum + v * Math.pow(0.9, i), 0);
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
  let points = 0;
  let used = 0;

  // Pass 1 — dedicated slots.
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
    const need = Math.max(0, req[pos] ?? 0);
    let filled = 0;
    for (let i = 0; i < pool.length && filled < need; i++) {
      const p = pool[i]!;
      if (p.pos !== pos || (p as { _used?: boolean })._used) continue;
      (p as { _used?: boolean })._used = true;
      points += p.weekly;
      filled++;
      used++;
    }
    if (filled < need) vacancies[pos] = need - filled;
  }

  // Pass 2 — dynamic flex optimization from the surplus RB/WR/TE pool.
  const flexNeed = Math.max(0, req['FLEX'] ?? 0);
  let flexFilled = 0;
  for (const p of pool) {
    if (flexFilled >= flexNeed) break;
    if ((p as { _used?: boolean })._used) continue;
    if (!FLEX_ELIGIBLE.includes(p.pos)) continue;
    (p as { _used?: boolean })._used = true;
    points += p.weekly;
    flexFilled++;
    used++;
  }
  if (flexFilled < flexNeed) vacancies['FLEX'] = flexNeed - flexFilled;

  for (const p of pool) delete (p as { _used?: boolean })._used;

  return {
    points,
    vacancies,
    vacancyCount: Object.values(vacancies).reduce((a, b) => a + b, 0),
    benchCount: Math.max(0, players.length - used),
  };
}

/**
 * Roster fit measured strictly against the optimized starting lineup: does the
 * deal fill a vacant starting slot or raise starting-lineup output? Incoming
 * players who cannot crack the lineup (a redundant second QB, a fifth WR) are
 * bench depth and drag the fit percentage down when premium starters leave.
 */
export function rosterFit(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
}): RosterFit {
  const req = { ...BASE_STARTERS, ...input.starters };
  const after: FitPlayer[] = [];
  const takenGive = [...input.give];
  for (const p of input.roster) {
    const idx = takenGive.findIndex((g) => g.pos === p.pos && g.weekly === p.weekly);
    if (idx >= 0) {
      takenGive.splice(idx, 1);
      continue;
    }
    after.push(p);
  }
  after.push(...input.get);

  const before = optimizeLineup(input.roster, req);
  const now = optimizeLineup(after, req);

  const fills: string[] = [];
  const clogs: string[] = [];
  let pct = 0;

  const positions = Object.keys(req).filter((k) => (req[k] ?? 0) > 0);
  for (const pos of positions) {
    const vb = before.vacancies[pos] ?? 0;
    const va = now.vacancies[pos] ?? 0;
    if (vb > va) {
      pct += (vb - va) * 8;
      fills.push(pos);
    } else if (va > vb) {
      pct -= (va - vb) * 10;
    }
  }

  // Starting-lineup production swing, normalised against the current lineup.
  const swing = now.points - before.points;
  pct += Math.max(-15, Math.min(15, (swing / Math.max(before.points, 1)) * 100));

  // Bench bloat: incoming bodies that never crack the optimized lineup.
  const benchAdds = Math.max(0, now.benchCount - before.benchCount);
  if (benchAdds > 0 && swing <= 0) {
    pct -= benchAdds * 5;
    for (const p of input.get) {
      const filledSomething = fills.includes(p.pos);
      if (!filledSomething && !clogs.includes(p.pos)) clogs.push(p.pos);
    }
  }

  pct = Math.max(-25, Math.min(25, Math.round(pct)));

  const note = !input.get.length
    ? "No incoming players to fit."
    : fills.length && !clogs.length
      ? `Fills starting need at ${fills.join(", ")}.`
      : clogs.length && !fills.length
        ? `Starting lineup is already full at ${clogs.join(", ")} — incoming players are bench depth.`
        : fills.length && clogs.length
          ? `Upgrades ${fills.join(", ")} but adds bench depth at ${clogs.join(", ")}.`
          : "Neutral fit — the optimized starting lineup is unchanged.";

  return { pct, fills, clogs, note };
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


/** Thematic executive summary for the grading banner. */
export function executiveSummary(input: {
  ready: boolean;
  pct: number;
  giveCount: number;
  getCount: number;
  overflow: boolean;
}): string {
  if (!input.ready) return "Add players to both sides to run the valuation model.";
  const consolidating = input.getCount < input.giveCount;
  const spreading = input.getCount > input.giveCount;

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

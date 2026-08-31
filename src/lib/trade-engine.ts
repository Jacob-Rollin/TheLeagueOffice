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

/**
 * Data-driven roster fit: compares positional depth before and after the deal
 * against the league's configured starting requirements, rewards filling a
 * deficit or upgrading the weakest starter, and penalises stacking a position
 * the manager already has buried on the bench.
 */
export function rosterFit(input: {
  roster: FitPlayer[];
  give: FitPlayer[];
  get: FitPlayer[];
  starters: Record<string, number>;
}): RosterFit {
  const positions: FitPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const countAt = (list: FitPlayer[], pos: string) => list.filter((p) => p.pos === pos).length;

  const after = input.roster
    .filter((p) => !input.give.includes(p))
    .concat(input.get);

  let pct = 0;
  const fills: string[] = [];
  const clogs: string[] = [];

  for (const pos of positions) {
    const req = input.starters[pos] ?? 0;
    if (req <= 0) continue;
    const before = countAt(input.roster, pos);
    const now = countAt(after, pos);

    // Starting-lineup deficit movement.
    const deficitBefore = Math.max(0, req - before);
    const deficitAfter = Math.max(0, req - now);
    if (deficitBefore > deficitAfter) {
      pct += (deficitBefore - deficitAfter) * 6;
      fills.push(pos);
    } else if (deficitAfter > deficitBefore) {
      pct -= (deficitAfter - deficitBefore) * 8;
    }

    // Bench-clog surplus movement (anything beyond starters + 2 of depth).
    const cap = req + 2;
    const surplusBefore = Math.max(0, before - cap);
    const surplusAfter = Math.max(0, now - cap);
    if (surplusAfter > surplusBefore) {
      pct -= (surplusAfter - surplusBefore) * 4;
      clogs.push(pos);
    }

    // Weakest-starter upgrade: incoming beats the worst current starter.
    const incoming = input.get.filter((p) => p.pos === pos);
    if (incoming.length) {
      const starters = input.roster
        .filter((p) => p.pos === pos)
        .sort((a, b) => b.weekly - a.weekly)
        .slice(0, Math.max(1, req));
      const worst = starters.length ? starters[starters.length - 1]!.weekly : 0;
      const best = Math.max(...incoming.map((p) => p.weekly));
      if (best > worst) {
        pct += Math.min(6, ((best - worst) / Math.max(worst, 1)) * 10);
        if (!fills.includes(pos)) fills.push(pos);
      }
    }
  }

  pct = Math.max(-25, Math.min(25, Math.round(pct)));
  const note = !input.get.length
    ? "No incoming players to fit."
    : fills.length && !clogs.length
      ? `Fills starting need at ${fills.join(", ")}.`
      : clogs.length && !fills.length
        ? `Adds bench surplus at ${clogs.join(", ")}.`
        : fills.length && clogs.length
          ? `Upgrades ${fills.join(", ")} but deepens ${clogs.join(", ")}.`
          : "Neutral fit — depth chart is unchanged.";

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
};

/**
 * Bench-vacancy verification. Only runs when the manager is receiving more
 * players than they send out.
 */
export function rosterConstraint(input: {
  rosterCount: number;
  rosterCap: number;
  giveCount: number;
  getCount: number;
  /** Bench-eligible players on the manager's roster, with weekly projections. */
  bench: { name: string; weekly: number }[];
}): RosterConstraint {
  const none: RosterConstraint = { overflow: false, dropCount: 0, penalty: 0, dropName: null };
  const net = input.getCount - input.giveCount;
  if (net <= 0 || input.rosterCap <= 0) return none;

  const projected = input.rosterCount - input.giveCount + input.getCount;
  const over = projected - input.rosterCap;
  if (over <= 0) return none;

  const sorted = [...input.bench].sort((a, b) => a.weekly - b.weekly).slice(0, over);
  const penalty = sorted.reduce((s, p) => s + p.weekly, 0);
  return {
    overflow: true,
    dropCount: over,
    penalty,
    dropName: sorted[0]?.name ?? null,
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

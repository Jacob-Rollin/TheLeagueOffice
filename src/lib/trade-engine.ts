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
 * The wider package takes a 15% discount per extra body (capped at 45%).
 */
export function packageScore(values: number[], opposingCount: number): number {
  const raw = starWeighted(values);
  const extra = Math.max(0, values.length - opposingCount);
  if (extra === 0) return raw;
  const discount = Math.min(0.45, CONSOLIDATION_DISCOUNT * extra);
  return raw * (1 - discount);
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

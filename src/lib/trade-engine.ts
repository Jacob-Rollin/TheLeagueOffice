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
}): MarginalImpact {
  return marginalImpact({
    roster: input.roster,
    give: input.get,
    get: input.give,
    starters: input.starters,
  });
}

/* ------------------------------------------------------------------ *
 * Dashboard analytics: headline verdicts, pros/cons bullets,
 * positional depth deltas and injury vulnerability comparisons.
 * Pure math + string building — no UI, no data fetching.
 * ------------------------------------------------------------------ */

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

export type Bullet = { tone: "pro" | "con"; text: string };

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
      ).toFixed(1)} market value${input.assets.length > 1 ? ` inside a ${input.assets.length}-player package` : ""}.`,
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

  if (!out.length) {
    out.push({
      tone: "con",
      text: incoming
        ? "No incoming assets selected yet."
        : "No outgoing assets selected yet.",
    });
  }
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

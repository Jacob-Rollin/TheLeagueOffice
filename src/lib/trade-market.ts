export type MarketPos = "QB" | "RB" | "WR" | "TE";
export type MarketFormat = "std" | "half" | "ppr";

export const MARKET_POSITIONS: MarketPos[] = ["QB", "RB", "WR", "TE"];

/** One FantasyCalc market entry (values built from real trades across platforms). */
export type MarketRow = {
  /** Sleeper player id. */
  id: string;
  /** FantasyCalc player id (needed for value history). */
  fcId: number;
  name: string;
  pos: MarketPos;
  team: string;
  value: number;
  trend30: number;
  overallRank: number;
  positionRank: number;
  /** Share of all recent FantasyCalc trades that include this player. */
  tradeFrequency: number | null;
};

/** Season usage line used to grade opportunity against production. */
export type OpportunityRow = {
  id: string;
  pos: MarketPos;
  gp: number;
  pts: Record<MarketFormat, number>;
  /** 1-99 percentile blend of usage inputs within the position pool. */
  score: number;
  /** Position rank of `score` within the qualified pool. */
  rank: number;
  snapPct: number | null;
  targetsPg: number;
  airYardsPg: number;
  targetShare: number | null;
  redZonePg: number;
  touchesPg: number;
  passAttPg: number;
};

export type TradeMarketPayload = {
  format: MarketFormat;
  season: string;
  rows: MarketRow[];
  /** Every qualified player at QB/RB/WR/TE, not just market-listed ones. */
  opportunity: OpportunityRow[];
};

export type MarketHistoryPoint = { date: string; value: number };

export type TargetKind = "buy" | "sell";

export type TradeTarget = {
  kind: TargetKind;
  oppRank: number;
  ppgRank: number;
  /** How many position spots separate usage rank from production rank. */
  spotsApart: number;
};

/** StatChasers-style cut lines: high = top 40%, low = bottom 40% of players on screen. */
export const HIGH_CUT = 60;
export const LOW_CUT = 40;

/** Fantasy-relevant comparison group per position, by market value. */
const COMPARE_SIZE: Record<MarketPos, number> = { QB: 24, RB: 40, WR: 50, TE: 20 };

export function pointsPerGame(row: OpportunityRow, format: MarketFormat): number {
  return row.gp > 0 ? row.pts[format] / row.gp : 0;
}

/** PPG position rank within the qualified opportunity pool. */
export function ppgRanks(pool: OpportunityRow[], format: MarketFormat): Map<string, number> {
  const out = new Map<string, number>();
  for (const pos of MARKET_POSITIONS) {
    pool
      .filter((r) => r.pos === pos)
      .sort((a, b) => pointsPerGame(b, format) - pointsPerGame(a, format))
      .forEach((r, i) => out.set(r.id, i + 1));
  }
  return out;
}

function percentileOf(values: number[], v: number): number {
  if (values.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const x of values) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return ((below + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100;
}

/**
 * Buy Low = top 40% opportunity with bottom 40% points per game.
 * Sell High = top 40% points per game with bottom 40% opportunity.
 * Cuts are taken per position over the top market-valued players with usage data;
 * ranks and spots apart use the full position pool.
 */
export function classifyTradeTargets(
  rows: MarketRow[],
  oppById: Map<string, OpportunityRow>,
  ppgRankById: Map<string, number>,
  format: MarketFormat,
): Map<string, TradeTarget> {
  const out = new Map<string, TradeTarget>();
  for (const pos of MARKET_POSITIONS) {
    const onScreen = rows
      .filter((r) => r.pos === pos)
      .sort((a, b) => b.value - a.value)
      .map((r) => oppById.get(r.id))
      .filter((o): o is OpportunityRow => o != null && o.gp >= 2)
      .slice(0, COMPARE_SIZE[pos]);
    if (onScreen.length < 5) continue;
    const scores = onScreen.map((o) => o.score);
    const ppgs = onScreen.map((o) => pointsPerGame(o, format));
    for (const o of onScreen) {
      const oppPct = percentileOf(scores, o.score);
      const ppgPct = percentileOf(ppgs, pointsPerGame(o, format));
      const ppgRank = ppgRankById.get(o.id);
      if (ppgRank == null) continue;
      if (oppPct >= HIGH_CUT && ppgPct <= LOW_CUT && ppgRank > o.rank) {
        out.set(o.id, { kind: "buy", oppRank: o.rank, ppgRank, spotsApart: ppgRank - o.rank });
      } else if (ppgPct >= HIGH_CUT && oppPct <= LOW_CUT && o.rank > ppgRank) {
        out.set(o.id, { kind: "sell", oppRank: o.rank, ppgRank, spotsApart: o.rank - ppgRank });
      }
    }
  }
  return out;
}

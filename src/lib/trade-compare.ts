/**
 * Shared Overview / Stats comparison math for Trade Desk and Trade Analyzer.
 */

import type { Player, Scoring } from "@/lib/draft";
import type { PlayerDetail } from "@/lib/players.server";
import type { InSeasonValue } from "@/lib/trade-value";

export const TRADE_COMPARE_WEEKS = 17;

export type TradeStatLine = {
  season: string;
  posRank: number | null;
  line: { label: string; value: string }[];
};

export type TradeMetrics = {
  player: Player;
  projTotal: number;
  projPerWk: number;
  prevTotal: number;
  prevGames: number;
  prevPerGame: number;
  seasonTotal: number;
  seasonGames: number;
  seasonPerGame: number;
  rosTotal: number;
  rosPerGame: number;
  currentStats: TradeStatLine | null;
  prevStats: TradeStatLine | null;
  weekly: number;
};

export type TradeCompareRow = {
  label: string;
  give: string;
  get: string;
  giveWin: boolean;
  getWin: boolean;
};

export const TRADE_LOWER_IS_BETTER = new Set(["Pts allowed"]);

function better(a: number, b: number) {
  return a > b && Math.abs(a - b) > 0.05;
}

export function buildTradeCompareRow(
  label: string,
  a: number | null,
  b: number | null,
  opts: { lowerBetter?: boolean; digits?: number; prefix?: string } = {},
): TradeCompareRow {
  const digits = opts.digits ?? 1;
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v) ? "—" : `${opts.prefix ?? ""}${v.toFixed(digits)}`;
  const valid = a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b);
  const aWins = valid && (opts.lowerBetter ? better(b!, a!) : better(a!, b!));
  const bWins = valid && (opts.lowerBetter ? better(a!, b!) : better(b!, a!));
  return { label, give: fmt(a), get: fmt(b), giveWin: aWins, getWin: bWins };
}

/**
 * Build per-player trade metrics. Prefer `seasonPosRank` (popup / league YTD
 * pos rank) for the Stats tab Position Rank over detail.seasonToDate.posRank,
 * which is often null on the client path.
 */
export function metricsForTradePlayer(
  player: Player,
  detail: PlayerDetail | undefined,
  scoring: Scoring,
  value: InSeasonValue,
  seasonPosRank?: number | null,
): TradeMetrics {
  const prevLine = detail?.history?.[0] ?? null;
  const currentLine = detail?.seasonToDate ?? null;
  const projTotal = detail?.projection?.points?.[scoring] ?? player.proj?.[scoring] ?? 0;
  const prevTotal = prevLine?.points?.[scoring] ?? player.prev?.[scoring] ?? 0;
  const prevGames = prevLine?.games ?? 0;
  const prevPerGame = prevGames > 0 ? prevTotal / prevGames : 0;
  const projPerWk = projTotal / TRADE_COMPARE_WEEKS;
  const ytdRank =
    seasonPosRank != null && Number.isFinite(seasonPosRank) && seasonPosRank > 0
      ? Math.round(seasonPosRank)
      : null;

  return {
    player,
    projTotal,
    projPerWk,
    prevTotal,
    prevGames,
    prevPerGame,
    seasonTotal: value.seasonTotal,
    seasonGames: value.seasonGames,
    seasonPerGame: value.seasonPerGame ?? 0,
    rosTotal: value.rosTotal ?? 0,
    rosPerGame: value.rosPerGame ?? 0,
    currentStats: currentLine
      ? {
          season: currentLine.season,
          posRank: ytdRank ?? currentLine.posRank ?? null,
          line: currentLine.line,
        }
      : ytdRank != null
        ? {
            season: detail?.season ?? String(new Date().getFullYear()),
            posRank: ytdRank,
            line: [],
          }
        : null,
    prevStats: prevLine
      ? {
          season: prevLine.season,
          posRank: prevLine.posRank ?? null,
          line: prevLine.line,
        }
      : null,
    weekly: value.weekly,
  };
}

export function sumTradeMetric(rows: TradeMetrics[], key: keyof TradeMetrics): number {
  return rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}

export function buildTradeOverviewRows(input: {
  giveRows: TradeMetrics[];
  getRows: TradeMetrics[];
  inSeason: boolean;
  currentSeason: string | null;
  showRos: boolean;
  prevSeasonLabel: string;
}): TradeCompareRow[] {
  const { giveRows, getRows, inSeason, currentSeason, showRos, prevSeasonLabel } = input;
  return [
    ...(inSeason && currentSeason
      ? [
          buildTradeCompareRow(
            `${currentSeason} Total`,
            sumTradeMetric(giveRows, "seasonTotal"),
            sumTradeMetric(getRows, "seasonTotal"),
          ),
          buildTradeCompareRow(
            `${currentSeason} Avg.`,
            sumTradeMetric(giveRows, "seasonPerGame"),
            sumTradeMetric(getRows, "seasonPerGame"),
          ),
          buildTradeCompareRow(
            `${currentSeason} Games`,
            sumTradeMetric(giveRows, "seasonGames"),
            sumTradeMetric(getRows, "seasonGames"),
            { digits: 0 },
          ),
        ]
      : []),
    ...(showRos
      ? [
          buildTradeCompareRow(
            "Rest of Season (proj)",
            sumTradeMetric(giveRows, "rosTotal"),
            sumTradeMetric(getRows, "rosTotal"),
          ),
          buildTradeCompareRow(
            "ROS Avg. (proj)",
            sumTradeMetric(giveRows, "rosPerGame"),
            sumTradeMetric(getRows, "rosPerGame"),
          ),
        ]
      : [
          buildTradeCompareRow(
            "Season Total (proj)",
            sumTradeMetric(giveRows, "projTotal"),
            sumTradeMetric(getRows, "projTotal"),
          ),
          buildTradeCompareRow(
            "Season Avg. (proj)",
            sumTradeMetric(giveRows, "projPerWk"),
            sumTradeMetric(getRows, "projPerWk"),
          ),
        ]),
    buildTradeCompareRow(
      `${prevSeasonLabel} Total`,
      sumTradeMetric(giveRows, "prevTotal"),
      sumTradeMetric(getRows, "prevTotal"),
    ),
    buildTradeCompareRow(
      `${prevSeasonLabel} Avg.`,
      sumTradeMetric(giveRows, "prevPerGame"),
      sumTradeMetric(getRows, "prevPerGame"),
    ),
    buildTradeCompareRow(
      `${prevSeasonLabel} Games`,
      sumTradeMetric(giveRows, "prevGames"),
      sumTradeMetric(getRows, "prevGames"),
      { digits: 0 },
    ),
  ];
}

export function buildTradeStatRows(input: {
  giveRows: TradeMetrics[];
  getRows: TradeMetrics[];
  statsIsCurrent: boolean;
}): TradeCompareRow[] {
  const { giveRows, getRows, statsIsCurrent } = input;
  const statsOf = (r: TradeMetrics) => (statsIsCurrent ? r.currentStats : r.prevStats);

  const bestRank = (rows: TradeMetrics[]) => {
    const ranks = rows.map((r) => statsOf(r)?.posRank).filter((n): n is number => Boolean(n));
    return ranks.length ? Math.min(...ranks) : null;
  };
  const lineTotal = (rows: TradeMetrics[], label: string) => {
    const vals = rows
      .flatMap((r) =>
        (statsOf(r)?.line ?? []).filter((l) => l.label === label).map((l) => Number(l.value)),
      )
      .filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };

  const labels: string[] = [];
  for (const r of [...giveRows, ...getRows]) {
    for (const l of statsOf(r)?.line ?? []) {
      if (!labels.includes(l.label)) labels.push(l.label);
    }
  }

  return [
    buildTradeCompareRow("Position Rank", bestRank(giveRows), bestRank(getRows), {
      lowerBetter: true,
      digits: 0,
      prefix: "#",
    }),
    statsIsCurrent
      ? buildTradeCompareRow(
          "Fantasy Pts",
          sumTradeMetric(giveRows, "seasonTotal"),
          sumTradeMetric(getRows, "seasonTotal"),
        )
      : buildTradeCompareRow(
          "Fantasy Pts",
          sumTradeMetric(giveRows, "prevTotal"),
          sumTradeMetric(getRows, "prevTotal"),
        ),
    statsIsCurrent
      ? buildTradeCompareRow(
          "Fantasy Pts / Game",
          sumTradeMetric(giveRows, "seasonPerGame"),
          sumTradeMetric(getRows, "seasonPerGame"),
        )
      : buildTradeCompareRow(
          "Fantasy Pts / Game",
          sumTradeMetric(giveRows, "prevPerGame"),
          sumTradeMetric(getRows, "prevPerGame"),
        ),
    ...labels.map((label) =>
      buildTradeCompareRow(label, lineTotal(giveRows, label), lineTotal(getRows, label), {
        lowerBetter: TRADE_LOWER_IS_BETTER.has(label),
      }),
    ),
  ];
}

/**
 * Overview / Stats side-by-side panel shared by Trade Desk and Trade Analyzer.
 */

import { PositionBadge } from "@/components/draft/PositionBadge";
import type { Player, Scoring } from "@/lib/draft";
import type { PlayerDetail, TradeValueBasis } from "@/lib/players.server";
import {
  buildTradeOverviewRows,
  buildTradeStatRows,
  metricsForTradePlayer,
  type TradeCompareRow,
  type TradeMetrics,
} from "@/lib/trade-compare";
import { inSeasonWeeklyValue } from "@/lib/trade-value";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

export function TradeSideCompare({
  give,
  get,
  scoring,
  valueBasis,
  detailsById,
  loading = false,
  seasonPosRankFor,
}: {
  give: Player[];
  get: Player[];
  scoring: Scoring;
  valueBasis: TradeValueBasis | null | undefined;
  detailsById: Map<string, PlayerDetail>;
  loading?: boolean;
  /** League/scoring-aware YTD pos rank (same source as player popup). */
  seasonPosRankFor?: (playerId: string) => number | null;
}) {
  const [tab, setTab] = useState<"overview" | "stats">("overview");
  const ready = give.length > 0 && get.length > 0;

  const valueOf = (p: Player) =>
    inSeasonWeeklyValue(
      valueBasis?.players?.[p.id],
      valueBasis ?? null,
      p.proj?.[scoring] ?? 0,
      scoring,
    );

  const giveRows = useMemo(
    () =>
      give.map((p) =>
        metricsForTradePlayer(
          p,
          detailsById.get(p.id),
          scoring,
          valueOf(p),
          seasonPosRankFor?.(p.id) ?? null,
        ),
      ),
    // valueBasis / scoring drive valueOf; seasonPosRankFor is stable from parent hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps
    [give, detailsById, scoring, valueBasis, seasonPosRankFor],
  );
  const getRows = useMemo(
    () =>
      get.map((p) =>
        metricsForTradePlayer(
          p,
          detailsById.get(p.id),
          scoring,
          valueOf(p),
          seasonPosRankFor?.(p.id) ?? null,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps
    [get, detailsById, scoring, valueBasis, seasonPosRankFor],
  );

  const inSeason =
    (valueBasis?.week ?? 1) > 1 || [...giveRows, ...getRows].some((r) => r.seasonGames > 0);
  const currentSeason = valueBasis?.season ?? null;
  const prevSeasonLabel = currentSeason ? String(Number(currentSeason) - 1) : "Last Season";
  const showRos = Boolean(inSeason && valueBasis?.rosAvailable);
  const statsIsCurrent = [...giveRows, ...getRows].some((r) => r.currentStats);
  const statsSeason = statsIsCurrent
    ? (currentSeason ??
      giveRows.concat(getRows).find((r) => r.currentStats)?.currentStats?.season ??
      "Current")
    : (giveRows.concat(getRows).find((r) => r.prevStats)?.prevStats?.season ?? "Last");

  const overviewRows = buildTradeOverviewRows({
    giveRows,
    getRows,
    inSeason,
    currentSeason,
    showRos,
    prevSeasonLabel,
  });
  const statRows = buildTradeStatRows({ giveRows, getRows, statsIsCurrent });

  return (
    <div className="mt-4">
      <div className="flex gap-1">
        {(
          [
            ["overview", "Overview"],
            ["stats", "Stats"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-md border px-3 py-1.5 font-display text-sm uppercase tracking-wide transition-colors",
              tab === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Loading player stats…</p>
      )}

      <section className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 p-3">
          <SideHead rows={giveRows} title="You give" />
          <span className="self-center rounded-full border border-border bg-surface px-2 py-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            vs
          </span>
          <SideHead rows={getRows} title="You receive" align="right" />
        </div>

        {!ready ? (
          <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
            Add at least one player to each side to compare.
          </p>
        ) : tab === "overview" ? (
          <CompareTable title="Fantasy Points" rows={overviewRows} />
        ) : (
          <CompareTable title={`${statsSeason} Season Stats`} rows={statRows} />
        )}
      </section>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Green numbers hold the statistical advantage. Position Rank uses season-to-date ranks in
        your league scoring format (same source as player popups).
      </p>
    </div>
  );
}

function CompareTable({ title, rows }: { title: string; rows: TradeCompareRow[] }) {
  if (!rows.length) {
    return (
      <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
        No stats available for these players.
      </p>
    );
  }
  return (
    <table className="w-full border-t border-border text-sm">
      <thead>
        <tr className="bg-surface">
          <th
            colSpan={3}
            className="px-3 py-2 text-center font-display text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border">
            <td
              className={cn(
                "w-1/3 px-3 py-2 text-left text-base tabular-nums",
                r.giveWin ? "font-bold text-emerald-600" : "font-semibold text-foreground",
              )}
            >
              {r.give}
            </td>
            <td className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              {r.label}
            </td>
            <td
              className={cn(
                "w-1/3 px-3 py-2 text-right text-base tabular-nums",
                r.getWin ? "font-bold text-emerald-600" : "font-semibold text-foreground",
              )}
            >
              {r.get}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideHead({
  rows,
  title,
  align,
}: {
  rows: TradeMetrics[];
  title: string;
  align?: "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="eyebrow">{title}</p>
      {!rows.length && <p className="mt-1 text-xs text-muted-foreground">No players.</p>}
      <div className="mt-1 space-y-1.5">
        {rows.map((m) => (
          <div
            key={m.player.id}
            className={cn(
              "flex items-center gap-2",
              align === "right" && "flex-row-reverse text-right",
            )}
          >
            <PositionBadge pos={m.player.pos} className="h-5 shrink-0 text-[10px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{m.player.name}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {m.player.pos} · {m.player.team}
                {m.player.bye ? ` · Bye ${m.player.bye}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

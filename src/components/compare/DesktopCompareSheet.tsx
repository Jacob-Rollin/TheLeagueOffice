import { useQuery } from "@tanstack/react-query";
import { ChartLine, ChevronRight, List, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  compactCompareName,
  comparePosLabel,
  formatCompareMetric,
  mergeCompareSections,
  metricSeasonValue,
  metricWeekValueForGraph,
  weekAbsenceNote,
  type CompareFormat,
  type CompareMetricDef,
  type CompareSectionDef,
  type CompareWeekPoint,
} from "@/lib/player-compare";
import {
  DESKTOP_OVERLAY_ATTR,
  freezePlayerPopupScroll,
} from "@/lib/desktop-overlay";
import type { Player } from "@/lib/players-build";
import { fetchGameLogsClient } from "@/lib/sleeper-client";
import { cn } from "@/lib/utils";

/** Broadcast navy + accent red for chart/hero bars (recharts needs concrete strokes). */
const LEFT_COLOR = "#1e3a8a";
const RIGHT_COLOR = "#c2410c";
const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

type ViewMode = "table" | "graph";

type ChartWeekRow = {
  week: number;
  label: string;
  left: number;
  right: number;
  leftNote: "BYE" | "Out" | null;
  rightNote: "BYE" | "Out" | null;
};

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    freezePlayerPopupScroll(true);
    return () => {
      document.body.style.overflow = prev;
      freezePlayerPopupScroll(false);
    };
  }, [active]);
}

function usePlayerWeekSeries(player: Player | null | undefined, format: CompareFormat) {
  return useQuery({
    queryKey: [
      "player-compare-logs",
      "v2-keep-bye",
      player?.id ?? "",
      player?.team ?? "FA",
      player?.pos ?? "",
      format,
    ],
    enabled: Boolean(player?.id),
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<CompareWeekPoint[]> => {
      if (!player) return [];
      const payload = await fetchGameLogsClient(
        player.id,
        player.team || "FA",
        player.pos || "WR",
        null,
        { includeCareer: false },
      );
      const logs = payload?.logs ?? [];
      return logs
        .map((l) => ({
          week: l.week,
          fpts: l.isBye ? 0 : Number(l.points?.[format] ?? 0) || 0,
          raw: (l.raw ?? {}) as Record<string, number>,
          played: Boolean(l.played) && !l.isBye,
          isBye: Boolean(l.isBye),
        }))
        .sort((x, y) => x.week - y.week);
    },
  });
}

function CompareGraphTooltip({
  active,
  label,
  payload,
  metric,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    dataKey?: string | number;
    name?: string;
    value?: number | string;
    color?: string;
    payload?: ChartWeekRow;
  }>;
  metric: CompareMetricDef;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const decimals = metric.decimals ?? 1;

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
      style={{ minWidth: 140 }}
    >
      <p className="mb-1.5 font-semibold text-slate-900">Week {label}</p>
      <ul className="space-y-1.5">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const n = typeof entry.value === "number" ? entry.value : Number(entry.value);
          const formatted = formatCompareMetric(n, decimals);
          const valueLabel =
            metric.key === "catch_pct" && Number.isFinite(n) ? `${formatted}%` : formatted;
          const note =
            Number.isFinite(n) && n === 0
              ? key === "left"
                ? (row?.leftNote ?? null)
                : key === "right"
                  ? (row?.rightNote ?? null)
                  : null
              : null;
          return (
            <li key={key} className="leading-tight">
              <p style={{ color: entry.color }}>
                <span className="font-semibold">{entry.name}</span>
                <span className="text-slate-500"> : </span>
                <span className="font-semibold tabular-nums">{valueLabel}</span>
              </p>
              {note ? (
                <p className="mt-0.5 pl-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {note}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WeekAxisTick({
  x,
  y,
  payload,
  index,
}: {
  x?: number;
  y?: number;
  payload?: { value?: number | string };
  index?: number;
}) {
  const week = payload?.value;
  if (week == null || x == null || y == null) return null;
  const text = index === 0 ? `WK ${week}` : String(week);
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={600}>
      {text}
    </text>
  );
}

/**
 * Desktop Broadcast compare dialog — same metrics/graph as mobile,
 * sized for a wide centered modal (not the mobile full-screen sheet).
 */
export function DesktopCompareSheet({
  leftId,
  rightId,
  onClose,
  onChangeSide,
}: {
  leftId: string;
  rightId: string;
  onClose: () => void;
  onChangeSide: (side: "left" | "right") => void;
}) {
  useLockBodyScroll(true);
  const { data: playersPayload } = useSleeperPlayers();
  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of playersPayload?.players ?? []) m.set(p.id, p);
    return m;
  }, [playersPayload]);
  const left = playersById.get(leftId) ?? null;
  const right = playersById.get(rightId) ?? null;
  const { format, rankFor, nflWeek } = useLeagueProjections();
  const currentWeek = Math.max(1, Math.min(18, Math.floor(Number(nflWeek ?? 1) || 1)));

  const leftLogs = usePlayerWeekSeries(left, format);
  const rightLogs = usePlayerWeekSeries(right, format);

  const sections = useMemo(
    () => mergeCompareSections(left?.pos ?? "RB", right?.pos ?? left?.pos ?? "RB"),
    [left?.pos, right?.pos],
  );

  if (typeof document === "undefined") return null;

  const shortLeft = left
    ? left.pos === "DEF"
      ? left.name.split(" ").at(-1) ?? left.name
      : left.name.split(" ").length > 1
        ? `${left.name.split(" ")[0]?.charAt(0)}. ${left.name.split(" ").slice(1).join(" ")}`
        : left.name
    : "A";
  const shortRight = right
    ? right.pos === "DEF"
      ? right.name.split(" ").at(-1) ?? right.name
      : right.name.split(" ").length > 1
        ? `${right.name.split(" ")[0]?.charAt(0)}. ${right.name.split(" ").slice(1).join(" ")}`
        : right.name
    : "B";

  return createPortal(
    <div
      {...{ [DESKTOP_OVERLAY_ATTR]: "" }}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-foreground/50 p-2 sm:p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare players"
        className="relative flex h-full max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background text-slate-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="display-title text-2xl text-slate-900">
            Compare <span className="text-primary">Players</span>
          </h2>
          <button
            type="button"
            aria-label="Close compare"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 border-b border-slate-200 bg-slate-50/80">
          <CompareHero
            player={left}
            rank={rankFor(leftId).pos}
            side="left"
            onPress={() => onChangeSide("left")}
          />
          <CompareHero
            player={right}
            rank={rankFor(rightId).pos}
            side="right"
            onPress={() => onChangeSide("right")}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
          {leftLogs.isLoading || rightLogs.isLoading ? (
            <p className="py-16 text-center text-sm text-slate-500">Loading comparison...</p>
          ) : (
            sections.map((section) => (
              <CompareSection
                key={section.id}
                section={section}
                leftName={shortLeft}
                rightName={shortRight}
                leftWeeks={leftLogs.data ?? []}
                rightWeeks={rightLogs.data ?? []}
                leftRank={rankFor(leftId).pos}
                rightRank={rankFor(rightId).pos}
                leftPos={left?.pos ?? ""}
                rightPos={right?.pos ?? ""}
                currentWeek={currentWeek}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompareHero({
  player,
  rank,
  side,
  onPress,
}: {
  player: Player | null;
  rank: number | null | undefined;
  side: "left" | "right";
  onPress: () => void;
}) {
  const accent = side === "left" ? LEFT_COLOR : RIGHT_COLOR;
  if (!player) {
    return (
      <button
        type="button"
        onClick={onPress}
        className={cn(
          "relative flex min-h-[96px] items-center justify-center px-5 py-4 text-sm text-slate-500 hover:bg-white/60",
          side === "right" && "border-l border-slate-200",
        )}
      >
        Click to select
        <span className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-200" aria-hidden />
      </button>
    );
  }
  const image = playerImage(
    player.id,
    AVATAR_POS.has(player.pos) ? player.pos : "WR",
    player.team,
  );
  const logo = teamLogo(player.team);
  const r = rank != null && rank > 0 && rank < 900 ? rank : null;
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        "relative flex min-h-[96px] items-center gap-4 px-5 py-4 text-left hover:bg-white/60",
        side === "right" && "border-l border-slate-200",
      )}
    >
      {r != null ? (
        <span
          className={cn(
            "absolute top-3 z-[1] flex size-7 items-center justify-center rounded-full bg-slate-900 font-display text-xs font-bold text-white",
            side === "left" ? "left-3" : "right-3",
          )}
        >
          {r}
        </span>
      ) : null}
      {image ? (
        <img
          src={image}
          alt=""
          className="size-16 shrink-0 object-contain object-bottom"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : logo ? (
        <img
          src={logo}
          alt=""
          className="size-14 shrink-0 rounded-full bg-slate-100 object-contain p-1.5"
        />
      ) : (
        <span className="size-16 shrink-0 rounded-full bg-slate-100" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold leading-tight tracking-wide text-slate-900">
          {compactCompareName(player.name)}
        </p>
        <p className="mt-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
          {player.team || "FA"} - {comparePosLabel(player.pos)}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-400">Click to change</p>
      </div>
      <span
        className="absolute inset-x-0 bottom-0 h-1.5"
        style={{ background: accent }}
        aria-hidden
      />
    </button>
  );
}

function CompareSection({
  section,
  leftName,
  rightName,
  leftWeeks,
  rightWeeks,
  leftRank,
  rightRank,
  leftPos,
  rightPos,
  currentWeek,
}: {
  section: CompareSectionDef;
  leftName: string;
  rightName: string;
  leftWeeks: CompareWeekPoint[];
  rightWeeks: CompareWeekPoint[];
  leftRank: number | null | undefined;
  rightRank: number | null | undefined;
  leftPos: string;
  rightPos: string;
  currentWeek: number;
}) {
  const [mode, setMode] = useState<ViewMode>("table");
  const [metricKey, setMetricKey] = useState(section.metrics[0]?.key ?? "fpts");
  const activeMetric = section.metrics.find((m) => m.key === metricKey) ?? section.metrics[0]!;

  const leftTotal = metricSeasonValue(activeMetric, leftWeeks) ?? 0;
  const rightTotal = metricSeasonValue(activeMetric, rightWeeks) ?? 0;
  const leftWins =
    activeMetric.higherIsBetter === false
      ? leftTotal < rightTotal - 0.05
      : leftTotal > rightTotal + 0.05;
  const rightWins =
    activeMetric.higherIsBetter === false
      ? rightTotal < leftTotal - 0.05
      : rightTotal > leftTotal + 0.05;
  const isTie = !leftWins && !rightWins;

  const chartData = useMemo((): ChartWeekRow[] => {
    const leftBy = new Map(leftWeeks.map((w) => [w.week, w]));
    const rightBy = new Map(rightWeeks.map((w) => [w.week, w]));
    const through = Math.max(0, Math.min(18, currentWeek - 1));
    return Array.from({ length: through }, (_, i) => {
      const week = i + 1;
      const leftWeek = leftBy.get(week);
      const rightWeek = rightBy.get(week);
      return {
        week,
        label: `WK ${week}`,
        left: metricWeekValueForGraph(activeMetric, leftWeek),
        right: metricWeekValueForGraph(activeMetric, rightWeek),
        leftNote: weekAbsenceNote(leftWeek),
        rightNote: weekAbsenceNote(rightWeek),
      };
    });
  }, [leftWeeks, rightWeeks, activeMetric, currentWeek]);

  const leftRankLabel =
    leftRank != null && leftRank > 0 && leftRank < 900 ? String(leftRank) : "—";
  const rightRankLabel =
    rightRank != null && rightRank > 0 && rightRank < 900 ? String(rightRank) : "—";

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="relative flex items-center justify-center border-b border-slate-200 px-4 py-3">
        <h3 className="text-center font-display text-sm font-bold uppercase tracking-[0.12em] text-slate-700">
          {section.title}
        </h3>
        <div className="absolute inset-y-0 right-4 flex items-center gap-1.5">
          <ModeBtn active={mode === "table"} label="Table" onClick={() => setMode("table")}>
            <List className="size-4" strokeWidth={2.25} />
          </ModeBtn>
          <ModeBtn active={mode === "graph"} label="Graph" onClick={() => setMode("graph")}>
            <ChartLine className="size-4" strokeWidth={2.25} />
          </ModeBtn>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3">
        {section.metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetricKey(m.key)}
            className={cn(
              "shrink-0 rounded-md border px-3.5 py-1.5 font-display text-xs font-bold uppercase tracking-wide",
              metricKey === m.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "graph" ? (
        <div className="px-4 pb-4 pt-1">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 20, left: 4, bottom: 8 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="week"
                  type="category"
                  interval={0}
                  tick={<WeekAxisTick />}
                  tickLine={false}
                  axisLine={false}
                  height={28}
                />
                <YAxis
                  width={40}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, "auto"]}
                  allowDecimals
                />
                <Tooltip content={<CompareGraphTooltip metric={activeMetric} />} />
                <Line
                  type="monotone"
                  dataKey="left"
                  name={leftName}
                  stroke={LEFT_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: LEFT_COLOR }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="right"
                  name={rightName}
                  stroke={RIGHT_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: RIGHT_COLOR }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {section.metrics.map((m) => {
              const lv = metricSeasonValue(m, leftWeeks);
              const rv = metricSeasonValue(m, rightWeeks);
              const lWin =
                lv != null &&
                rv != null &&
                (m.higherIsBetter === false ? lv < rv - 0.05 : lv > rv + 0.05);
              const rWin =
                lv != null &&
                rv != null &&
                (m.higherIsBetter === false ? rv < lv - 0.05 : rv > lv + 0.05);
              return (
                <tr key={m.key} className="border-t border-slate-200">
                  <td
                    className={cn(
                      "w-[34%] px-5 py-3 text-left tabular-nums",
                      lWin ? "font-bold text-emerald-700" : "font-semibold text-slate-800",
                    )}
                  >
                    {formatCompareMetric(lv, m.decimals ?? 1)}
                    {m.key === "catch_pct" && lv != null ? "%" : ""}
                  </td>
                  <td className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {m.label}
                  </td>
                  <td
                    className={cn(
                      "w-[34%] px-5 py-3 text-right tabular-nums",
                      rWin ? "font-bold text-emerald-700" : "font-semibold text-slate-800",
                    )}
                  >
                    {formatCompareMetric(rv, m.decimals ?? 1)}
                    {m.key === "catch_pct" && rv != null ? "%" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-4">
        <div
          className={cn(
            "grid grid-cols-2 items-center gap-2 text-center",
            leftWins ? "text-slate-900" : "text-slate-400",
          )}
        >
          <div>
            <p
              className={cn(
                "font-display text-2xl leading-none tabular-nums",
                leftWins ? "font-bold" : "font-semibold",
              )}
            >
              #{leftRankLabel}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide">
              {comparePosLabel(leftPos)} Rnk
            </p>
          </div>
          <div>
            <p
              className={cn(
                "font-display text-2xl leading-none tabular-nums",
                leftWins ? "font-bold" : "font-semibold",
              )}
            >
              {formatCompareMetric(leftTotal, activeMetric.decimals ?? 1)}
              {activeMetric.key === "catch_pct" ? "%" : ""}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide">Total</p>
          </div>
        </div>

        <div className="flex w-10 shrink-0 items-center justify-center" aria-hidden>
          {!isTie ? (
            <ChevronRight
              className={cn("size-6 text-slate-400", leftWins && "rotate-180")}
              strokeWidth={2.5}
            />
          ) : (
            <span className="size-6" />
          )}
        </div>

        <div
          className={cn(
            "grid grid-cols-2 items-center gap-2 text-center",
            rightWins ? "text-slate-900" : "text-slate-400",
          )}
        >
          <div>
            <p
              className={cn(
                "font-display text-2xl leading-none tabular-nums",
                rightWins ? "font-bold" : "font-semibold",
              )}
            >
              {formatCompareMetric(rightTotal, activeMetric.decimals ?? 1)}
              {activeMetric.key === "catch_pct" ? "%" : ""}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide">Total</p>
          </div>
          <div>
            <p
              className={cn(
                "font-display text-2xl leading-none tabular-nums",
                rightWins ? "font-bold" : "font-semibold",
              )}
            >
              #{rightRankLabel}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide">
              {comparePosLabel(rightPos)} Rnk
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeBtn({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border",
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700",
      )}
    >
      {children}
    </button>
  );
}

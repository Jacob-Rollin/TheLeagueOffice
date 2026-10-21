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
import { useMobileTheme } from "@/components/mobile/MobileThemeContext";
import { shortName } from "@/components/mobile/league/lineupShared";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/players-build";
import { fetchGameLogsClient } from "@/lib/sleeper-client";
import {
  compactCompareName,
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
import { cn } from "@/lib/utils";

const LEFT_COLOR = "var(--m-accent)";
const RIGHT_COLOR = "#c4782a";
const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);


type Format = CompareFormat;
type ViewMode = "table" | "graph";
type MetricDef = CompareMetricDef;
type SectionDef = CompareSectionDef;
type WeekPoint = CompareWeekPoint;

function usePlayerWeekSeries(player: Player | null | undefined, format: Format) {
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
    queryFn: async (): Promise<WeekPoint[]> => {
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

function formatMetric(v: number | null, decimals = 1): string {
  return formatCompareMetric(v, decimals);
}


type ChartWeekRow = {
  week: number;
  label: string;
  left: number;
  right: number;
  leftNote: "BYE" | "Out" | null;
  rightNote: "BYE" | "Out" | null;
};

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
  metric: MetricDef;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const decimals = metric.decimals ?? 1;

  return (
    <div
      className="rounded-lg border border-m-border bg-m-card px-2.5 py-2 text-xs shadow-sm"
      style={{ minWidth: 128 }}
    >
      <p className="mb-1.5 font-semibold text-m-card-fg">Week {label}</p>
      <ul className="space-y-1.5">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const n = typeof entry.value === "number" ? entry.value : Number(entry.value);
          const formatted = formatMetric(n, decimals);
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
                <span className="text-m-muted"> : </span>
                <span className="font-semibold tabnum">{valueLabel}</span>
              </p>
              {note ? (
                <p className="mt-0.5 pl-0.5 text-[10px] font-semibold uppercase tracking-wide text-m-muted">
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


/** Show every week on the X-axis: "WK 1 2 3 …" (not even weeks only). */
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
    <text
      x={x}
      y={y + 10}
      textAnchor="middle"
      fill="var(--m-muted)"
      fontSize={9}
      fontWeight={600}
    >
      {text}
    </text>
  );
}

function useMobileThemeClass() {
  const { theme } = useMobileTheme();
  return theme === "dark" ? "mobile-theme-dark" : "mobile-theme-light";
}

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export function MobileCompareSheet({
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
  const themeClass = useMobileThemeClass();
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

  return createPortal(
    <div
      className={cn(
        themeClass,
        "fixed inset-0 z-[70] flex h-[100dvh] max-h-[100dvh] flex-col bg-m-bg text-m-card-fg",
      )}
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Compare players"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-1 flex-col bg-m-bg">
        <header className="flex shrink-0 items-center justify-between bg-m-header px-4 py-3 text-m-header-fg">
          <span className="w-9" aria-hidden />
          <h2 className="font-display text-lg font-bold tracking-wide">Compare Players</h2>
          <button
            type="button"
            aria-label="Close compare"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/15"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 bg-m-card">
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2.5 py-3 pb-10">
          {leftLogs.isLoading || rightLogs.isLoading ? (
            <p className="py-10 text-center text-sm text-m-muted">Loading comparison...</p>
          ) : (
            sections.map((section) => (
              <CompareSection
                key={section.id}
                section={section}
                leftName={left ? shortName(left) : "A"}
                rightName={right ? shortName(right) : "B"}
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
          "relative flex min-h-[72px] items-center justify-center px-3 py-3 pb-4 text-sm text-m-muted",
          side === "right" && "border-l border-m-border",
        )}
      >
        Tap to select
        <span className="absolute inset-x-0 bottom-0 h-1 bg-m-border" aria-hidden />
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
        "relative flex min-h-[72px] items-center gap-2.5 px-3 py-2.5 pb-4 text-left",
        side === "right" && "border-l border-m-border",
      )}
    >
      {r != null ? (
        <span
          className={cn(
            "absolute top-1.5 z-[1] flex size-6 items-center justify-center rounded-full bg-m-pos-rank-bg font-display text-[11px] font-bold text-m-pos-rank-fg",
            side === "left" ? "left-1.5" : "right-1.5",
          )}
        >
          {r}
        </span>
      ) : null}
      {image ? (
        <img
          src={image}
          alt=""
          className={cn(
            "size-12 shrink-0 object-contain object-bottom",
            side === "left" ? "ml-1" : "mr-1",
          )}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : logo ? (
        <img
          src={logo}
          alt=""
          className="size-10 shrink-0 rounded-full bg-m-chip object-contain p-1"
        />
      ) : (
        <span className="size-12 shrink-0 rounded-full bg-m-chip" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[14px] font-bold leading-tight tracking-wide">
          {compactCompareName(player.name)}
        </p>
        <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wide text-m-muted">
          {player.team || "FA"} - {player.pos === "DEF" ? "DST" : player.pos}
        </p>
      </div>
      <span
        className="absolute inset-x-0 bottom-0 h-1"
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
  section: SectionDef;
  leftName: string;
  rightName: string;
  leftWeeks: WeekPoint[];
  rightWeeks: WeekPoint[];
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
    // Only completed weeks — exclude the in-progress NFL week (shows as 0s).
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

  const posLabel = (pos: string) => (pos === "DEF" ? "DST" : pos || "RNK");
  const leftRankLabel =
    leftRank != null && leftRank > 0 && leftRank < 900 ? String(leftRank) : "—";
  const rightRankLabel =
    rightRank != null && rightRank > 0 && rightRank < 900 ? String(rightRank) : "—";

  return (
    <section className="overflow-hidden rounded-xl border border-m-border bg-m-card text-m-card-fg">
      <div className="relative flex items-center justify-center border-b border-m-border px-3 py-2.5">
        <h3 className="text-center font-display text-sm font-bold uppercase tracking-[0.12em] text-m-section">
          {section.title}
        </h3>
        <div className="absolute inset-y-0 right-3 flex items-center gap-1">
          <ModeBtn active={mode === "table"} label="Table" onClick={() => setMode("table")}>
            <List className="size-4" strokeWidth={2.25} />
          </ModeBtn>
          <ModeBtn active={mode === "graph"} label="Graph" onClick={() => setMode("graph")}>
            <ChartLine className="size-4" strokeWidth={2.25} />
          </ModeBtn>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]">
        {section.metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetricKey(m.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
              metricKey === m.key
                ? "border-m-tab-active bg-m-tab-active text-m-tab-active-fg"
                : "border-m-border bg-m-select-bg text-m-select-fg",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "graph" ? (
        <div className="px-2 pb-2 pt-1">
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--m-border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="week"
                  type="category"
                  interval={0}
                  tick={<WeekAxisTick />}
                  tickLine={false}
                  axisLine={false}
                  height={22}
                />
                <YAxis
                  width={32}
                  tick={{ fontSize: 10, fill: "var(--m-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, "auto"]}
                  allowDecimals
                />
                <Tooltip
                  content={<CompareGraphTooltip metric={activeMetric} />}
                />
                <Line
                  type="monotone"
                  dataKey="left"
                  name={leftName}
                  stroke={LEFT_COLOR}
                  strokeWidth={2.25}
                  dot={{ r: 3, fill: LEFT_COLOR }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="right"
                  name={rightName}
                  stroke={RIGHT_COLOR}
                  strokeWidth={2.25}
                  dot={{ r: 3, fill: RIGHT_COLOR }}
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
                <tr key={m.key} className="border-t border-m-border">
                  <td
                    className={cn(
                      "w-[34%] px-3 py-2.5 text-left tabnum",
                      lWin ? "font-bold text-emerald-600" : "font-semibold",
                    )}
                  >
                    {formatMetric(lv, m.decimals ?? 1)}
                    {m.key === "catch_pct" && lv != null ? "%" : ""}
                  </td>
                  <td className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-m-muted">
                    {m.label}
                  </td>
                  <td
                    className={cn(
                      "w-[34%] px-3 py-2.5 text-right tabnum",
                      rWin ? "font-bold text-emerald-600" : "font-semibold",
                    )}
                  >
                    {formatMetric(rv, m.decimals ?? 1)}
                    {m.key === "catch_pct" && rv != null ? "%" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Winner footer: rank | total | arrow | total | rank — arrow centered. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-t border-m-border bg-m-card px-2 py-3">
        <div
          className={cn(
            "grid grid-cols-2 items-center gap-1 text-center",
            leftWins ? "text-m-card-fg" : "text-m-muted",
          )}
        >
          <div>
            <p
              className={cn(
                "font-display text-lg leading-none tabnum",
                leftWins ? "font-bold" : "font-semibold",
              )}
            >
              #{leftRankLabel}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
              {posLabel(leftPos)} Rnk
            </p>
          </div>
          <div>
            <p
              className={cn(
                "font-display text-lg leading-none tabnum",
                leftWins ? "font-bold" : "font-semibold",
              )}
            >
              {formatMetric(leftTotal, activeMetric.decimals ?? 1)}
              {activeMetric.key === "catch_pct" ? "%" : ""}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Total</p>
          </div>
        </div>

        <div className="flex w-8 shrink-0 items-center justify-center" aria-hidden>
          {!isTie ? (
            <ChevronRight
              className={cn(
                "size-5 text-m-muted",
                leftWins && "rotate-180",
              )}
              strokeWidth={2.5}
            />
          ) : (
            <span className="size-5" />
          )}
        </div>

        <div
          className={cn(
            "grid grid-cols-2 items-center gap-1 text-center",
            rightWins ? "text-m-card-fg" : "text-m-muted",
          )}
        >
          <div>
            <p
              className={cn(
                "font-display text-lg leading-none tabnum",
                rightWins ? "font-bold" : "font-semibold",
              )}
            >
              {formatMetric(rightTotal, activeMetric.decimals ?? 1)}
              {activeMetric.key === "catch_pct" ? "%" : ""}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Total</p>
          </div>
          <div>
            <p
              className={cn(
                "font-display text-lg leading-none tabnum",
                rightWins ? "font-bold" : "font-semibold",
              )}
            >
              #{rightRankLabel}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
              {posLabel(rightPos)} Rnk
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
        "inline-flex size-8 items-center justify-center rounded-lg border",
        active
          ? "border-m-tab-active bg-m-tab-active text-m-tab-active-fg"
          : "border-m-border bg-m-select-bg text-m-muted",
      )}
    >
      {children}
    </button>
  );
}

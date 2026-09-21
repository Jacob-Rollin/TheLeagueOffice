"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, RotateCcw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { playerImage } from "@/components/draft/PlayerAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMatchupReplay } from "@/lib/matchup-replay.functions";
import type {
  MatchupReplayPayload,
  MatchupReplayRequest,
  MatchupReplayTdEvent,
} from "@/lib/matchup-replay";
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import { cn } from "@/lib/utils";

const LEFT_LINE = "#f0a35a";
const RIGHT_LINE = "#f07178";

const TD_PAUSE_MS = 2000;
/** Smooth travel across the 0→100 timeline (TD pauses are extra). */
const TRAVEL_MS = 32000;
const END_HOLD_MS = 5000;

type ChartRow = {
  t: number;
  label: string;
  winLeft: number;
  winRight: number;
  scoreLeft: number;
  scoreRight: number;
  tdIndex?: number | undefined;
};

type ReplayPhase = "idle" | "playing" | "td_pause" | "holding" | "endcard";

function shortName(full: string): string {
  const cleaned = full.trim();
  if (!cleaned) return "Player";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]!.charAt(0)}. ${parts[parts.length - 1]!}`;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** Sample scores / win% at a continuous playhead X, and build the drawn line. */
function sampleAtPlayhead(
  rows: ChartRow[],
  playheadX: number,
): { display: ChartRow; visible: ChartRow[] } {
  if (!rows.length) {
    const empty: ChartRow = {
      t: 0,
      label: "",
      winLeft: 50,
      winRight: 50,
      scoreLeft: 0,
      scoreRight: 0,
    };
    return { display: empty, visible: [] };
  }

  const x = Math.min(100, Math.max(0, playheadX));
  const visible = rows.filter((r) => r.t <= x + 0.0001);
  let prev = rows[0]!;
  let next: ChartRow | null = null;
  for (const row of rows) {
    if (row.t <= x) prev = row;
    if (row.t > x) {
      next = row;
      break;
    }
  }

  let tip: ChartRow;
  if (!next || next.t === prev.t) {
    tip = { ...prev, t: x };
  } else {
    const gap = next.t - prev.t;
    const u = smoothstep((x - prev.t) / gap);
    // Win% always eases between samples (player-aware values from the server).
    // Scores only lerp during active games; quiet gaps hold the last score.
    const activeGap = gap <= 3;
    tip = {
      t: x,
      label: prev.label,
      winLeft: lerp(prev.winLeft, next.winLeft, u),
      winRight: lerp(prev.winRight, next.winRight, u),
      scoreLeft: activeGap ? lerp(prev.scoreLeft, next.scoreLeft, u) : prev.scoreLeft,
      scoreRight: activeGap ? lerp(prev.scoreRight, next.scoreRight, u) : prev.scoreRight,
    };
  }

  const drawn =
    visible.length && Math.abs(visible[visible.length - 1]!.t - tip.t) < 0.0001
      ? [...visible.slice(0, -1), tip]
      : [...visible, tip];

  return { display: tip, visible: drawn };
}

function TeamChip({
  name,
  record,
  logo,
  score,
  projected,
  align,
}: {
  name: string;
  record: string | null;
  logo: string | null;
  score: number;
  projected: number;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-50">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
            TM
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900">{name}</p>
        {record ? (
          <p className="text-[11px] font-medium tabular-nums text-slate-400">{record}</p>
        ) : null}
      </div>
      <div className={cn("shrink-0", align === "right" ? "text-left" : "text-right")}>
        <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">
          {score.toFixed(2)}
        </p>
        <p className="text-xs font-medium tabular-nums text-slate-400">{projected.toFixed(2)}</p>
      </div>
    </div>
  );
}

/** Team logo that rides the leading tip of each win% line. */
function TeamTipDot({
  cx,
  cy,
  logo,
  stroke,
  label,
}: {
  cx?: number;
  cy?: number;
  logo: string | null;
  stroke: string;
  label: string;
}) {
  if (cx == null || cy == null) return null;
  const r = 13;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1.5} fill="#fff" stroke={stroke} strokeWidth={2.5} />
      <clipPath id={`tip-clip-${label}`}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      {logo ? (
        <image
          href={logo}
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          clipPath={`url(#tip-clip-${label})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <circle cx={cx} cy={cy} r={r} fill={stroke} />
      )}
    </g>
  );
}

function TdDot({
  cx,
  cy,
  td,
}: {
  cx?: number;
  cy?: number;
  td: MatchupReplayTdEvent;
}) {
  if (cx == null || cy == null) return null;
  const stroke = td.side === "left" ? LEFT_LINE : RIGHT_LINE;
  const src = playerImage(td.sleeperId, td.pos as Pos, td.team);
  const clipId = `td-clip-${td.sleeperId}-${Math.round(td.t * 10)}`;

  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="#fff" stroke={stroke} strokeWidth={2.5} />
      <clipPath id={clipId}>
        <circle cx={cx} cy={cy} r={9} />
      </clipPath>
      <image
        href={src}
        x={cx - 9}
        y={cy - 9}
        width={18}
        height={18}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  );
}

/** HTML callout rendered above the SVG so it never hides under player circles. */
function TdCalloutOverlay({
  td,
  winPct,
}: {
  td: MatchupReplayTdEvent;
  winPct: number;
}) {
  const src = playerImage(td.sleeperId, td.pos as Pos, td.team);
  const bg = getTeamPrimaryColor(td.team);
  // Chart margins must stay in sync with LineChart margin below.
  const plotTop = 64;
  const plotBottom = 28;
  const plotLeft = 44;
  const plotRight = 36;
  const yPct = Math.min(100, Math.max(0, 100 - winPct));
  // Prefer above the icon; flip below near the top of the plot.
  const above = winPct < 78;

  // Keep the card inside the plot: near edges, shift the box instead of
  // centering (which clips the first Wednesday/Thursday TD popups).
  const t = Math.min(100, Math.max(0, td.t));
  let xTransform = "translateX(-50%)";
  let pointerLeft = "50%";
  if (t < 14) {
    xTransform = "translateX(0)";
    // Pointer still aims at the player circle's x within the card.
    pointerLeft = `${Math.max(12, Math.min(88, (t / 14) * 40 + 12))}%`;
  } else if (t > 86) {
    xTransform = "translateX(-100%)";
    pointerLeft = `${Math.max(12, Math.min(88, 100 - ((100 - t) / 14) * 40 - 12))}%`;
  }

  const yTransform = above ? "translateY(calc(-100% - 18px))" : "translateY(18px)";

  return (
    <div
      className="pointer-events-none absolute z-30 overflow-visible"
      style={{
        left: plotLeft,
        right: plotRight,
        top: plotTop,
        bottom: plotBottom,
      }}
    >
      <div
        className="absolute w-[min(100%,15rem)] animate-in fade-in zoom-in-95 duration-200"
        style={{
          left: `${t}%`,
          top: `${yPct}%`,
          transform: `${xTransform} ${yTransform}`,
        }}
      >
        <div
          className="relative rounded-xl px-3 py-2 text-white shadow-lg"
          style={{ backgroundColor: bg }}
        >
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full border-2 border-white/30 object-cover bg-black/10"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">
                {shortName(td.name)}{" "}
                <span className="font-semibold text-white/85">{td.pos}</span>
              </p>
              <p className="truncate text-xs font-semibold text-white/90">{td.headline}</p>
            </div>
          </div>
          {above ? (
            <span
              className="absolute top-full h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[8px] border-x-transparent"
              style={{ left: pointerLeft, borderTopColor: bg }}
              aria-hidden
            />
          ) : (
            <span
              className="absolute bottom-full h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[8px] border-x-transparent"
              style={{ left: pointerLeft, borderBottomColor: bg }}
              aria-hidden
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LiveWinBar({
  winLeft,
  winRight,
}: {
  winLeft: number;
  winRight: number;
}) {
  return (
    <div className="flex w-full items-center gap-3 text-sm font-bold">
      <span
        className={cn(
          "w-14 shrink-0 tabular-nums",
          winLeft >= winRight ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {winLeft.toFixed(1)}%
      </span>
      <div className="flex h-2 min-w-0 flex-1 items-center gap-1">
        <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
            style={{ width: `${winLeft}%` }}
          />
        </div>
        <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-rose-400 transition-[width] duration-200"
            style={{ width: `${winRight}%` }}
          />
        </div>
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right tabular-nums",
          winRight > winLeft ? "text-emerald-600" : "text-rose-600",
        )}
      >
        {winRight.toFixed(1)}%
      </span>
    </div>
  );
}

function FinalResultBar({ leftWon, tied }: { leftWon: boolean; tied: boolean }) {
  return (
    <div className="flex w-full items-center gap-3 text-sm font-bold uppercase tracking-wide">
      <span
        className={cn(
          "w-16 shrink-0",
          tied ? "text-slate-500" : leftWon ? "text-emerald-600" : "text-slate-400",
        )}
      >
        {tied ? "Tie" : leftWon ? "Won" : "Lost"}
      </span>
      <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1">
        <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full",
              tied ? "w-1/2 bg-slate-400" : leftWon ? "w-full bg-emerald-500" : "w-0",
            )}
          />
        </div>
        <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full",
              tied ? "w-1/2 bg-slate-400" : leftWon ? "w-0" : "w-full bg-emerald-500",
            )}
          />
        </div>
      </div>
      <span
        className={cn(
          "w-16 shrink-0 text-right",
          tied ? "text-slate-500" : leftWon ? "text-slate-400" : "text-emerald-600",
        )}
      >
        {tied ? "Tie" : leftWon ? "Lost" : "Won"}
      </span>
    </div>
  );
}

function ReplayEndCard({
  payload,
  leftWon,
  tied,
  onWatchAgain,
}: {
  payload: MatchupReplayPayload;
  leftWon: boolean;
  tied: boolean;
  onWatchAgain: () => void;
}) {
  const headline = tied
    ? "IT ENDED IN A TIE"
    : leftWon
      ? "YOU GOT THE W"
      : "IT WASN'T YOUR WEEK";
  const logo = payload.leftLogo;

  return (
    <div className="relative flex min-h-[280px] flex-col items-center justify-center px-4 py-10 sm:min-h-[340px]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, #94a3b8 0.5px, transparent 0.5px), radial-gradient(circle at 80% 70%, #94a3b8 0.5px, transparent 0.5px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white/95 px-6 py-8 text-center shadow-lg backdrop-blur-sm">
        <div className="mb-4 h-14 w-14 overflow-hidden rounded-full border-2 border-slate-200 bg-slate-50 shadow-sm">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-400">
              TM
            </div>
          )}
        </div>
        <p
          className={cn(
            "text-2xl font-black italic uppercase tracking-tight sm:text-3xl",
            tied ? "text-slate-700" : leftWon ? "text-emerald-600" : "text-slate-800",
          )}
        >
          {headline}
        </p>
        <button
          type="button"
          onClick={onWatchAgain}
          className="mt-8 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-sky-600 transition-colors hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Watch Again
        </button>
      </div>
    </div>
  );
}

export function MatchupReplayModal({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: MatchupReplayRequest | null;
}) {
  const [phase, setPhase] = useState<ReplayPhase>("idle");
  const [playheadX, setPlayheadX] = useState(0);
  const [activeTd, setActiveTd] = useState<MatchupReplayTdEvent | null>(null);
  const [playbackGen, setPlaybackGen] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const query = useQuery({
    queryKey: [
      "matchup-replay",
      "v3-smooth-win",
      request?.season,
      request?.week,
      request?.left.name,
      request?.right.name,
      request?.left.finalScore,
      request?.right.finalScore,
      request?.left.starters.map((s) => s.id).join(","),
      request?.right.starters.map((s) => s.id).join(","),
    ],
    enabled: open && Boolean(request),
    staleTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<MatchupReplayPayload> => {
      if (!request) throw new Error("Missing replay request");
      return await getMatchupReplay({ data: request });
    },
  });

  const payload = query.data ?? null;
  const chartData: ChartRow[] = useMemo(() => {
    if (!payload) return [];
    return payload.points.map((p) => ({
      t: p.t,
      label: p.label,
      winLeft: p.winPctLeft,
      winRight: p.winPctRight,
      scoreLeft: p.scoreLeft,
      scoreRight: p.scoreRight,
      tdIndex: p.tdIndex,
    }));
  }, [payload]);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const resetPlayback = () => {
    clearTimer();
    clearRaf();
    setActiveTd(null);
    setPlayheadX(0);
    setPhase("idle");
    setPlaybackGen((g) => g + 1);
  };

  useEffect(() => {
    if (!open) {
      clearTimer();
      clearRaf();
      setPhase("idle");
      setPlayheadX(0);
      setActiveTd(null);
      return;
    }
    if (!chartData.length || !payload) return;

    let cancelled = false;
    clearTimer();
    clearRaf();
    setPlayheadX(0);
    setActiveTd(null);
    setPhase("playing");

    const tdMarks = payload.tds
      .map((td, index) => ({ td, index, x: td.t }))
      .sort((a, b) => a.x - b.x);
    const fired = new Set<number>();

    let x = 0;
    let lastTs = 0;
    let paused = false;

    const schedule = (ms: number, fn: () => void) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const finish = () => {
      if (cancelled) return;
      x = 100;
      setPlayheadX(100);
      setActiveTd(null);
      setPhase("holding");
      schedule(END_HOLD_MS, () => {
        if (!cancelled) setPhase("endcard");
      });
    };

    const tick = (ts: number) => {
      if (cancelled || paused) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(64, ts - lastTs);
      lastTs = ts;

      x = Math.min(100, x + (dt / TRAVEL_MS) * 100);
      setPlayheadX(x);

      for (const mark of tdMarks) {
        if (fired.has(mark.index)) continue;
        if (mark.x > x + 0.05) break;
        fired.add(mark.index);
        paused = true;
        setActiveTd(mark.td);
        setPhase("td_pause");
        schedule(TD_PAUSE_MS, () => {
          if (cancelled) return;
          setActiveTd(null);
          setPhase("playing");
          paused = false;
          lastTs = 0;
          rafRef.current = requestAnimationFrame(tick);
        });
        return;
      }

      if (x >= 99.95) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    schedule(400, () => {
      if (cancelled) return;
      lastTs = 0;
      rafRef.current = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      clearTimer();
      clearRaf();
    };
  }, [open, payload, chartData, playbackGen]);

  const showEndCard = phase === "endcard";

  const { display: displayRow, visible: visibleData } = useMemo(
    () => sampleAtPlayhead(chartData, playheadX),
    [chartData, playheadX],
  );

  const revealedTds = useMemo(() => {
    if (!payload) return [] as { td: MatchupReplayTdEvent; index: number }[];
    return payload.tds
      .map((td, index) => ({ td, index }))
      .filter(({ td }) => td.t <= playheadX + 0.05);
  }, [payload, playheadX]);

  const tickValues = payload?.axisTicks.map((t) => t.t) ?? [];
  const tickFormatter = (t: number) => {
    const hit = payload?.axisTicks.find((tick) => tick.t === t);
    return hit?.label ?? "";
  };

  const finalLeft = chartData[chartData.length - 1]?.scoreLeft ?? 0;
  const finalRight = chartData[chartData.length - 1]?.scoreRight ?? 0;
  const leftWon = finalLeft > finalRight + 0.005;
  const tied = Math.abs(finalLeft - finalRight) <= 0.005;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clearTimer();
          clearRaf();
          setActiveTd(null);
          setPhase("idle");
          setPlayheadX(0);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] w-[min(96vw,56rem)] max-w-5xl overflow-y-auto p-0 sm:rounded-xl">
        <div className="border-b border-border px-5 pb-3 pt-5">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-base font-bold tracking-tight text-slate-900">
              Matchup Replay
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 py-4">
          {query.isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Building replay from play-by-play…
            </p>
          ) : query.isError ? (
            <p className="py-16 text-center text-sm text-rose-600">
              Could not load play-by-play for this week. Try again in a moment.
            </p>
          ) : payload && displayRow ? (
            <>
              <div className="flex items-center gap-2 sm:gap-3">
                <TeamChip
                  name={payload.leftName}
                  record={payload.leftRecord}
                  logo={payload.leftLogo}
                  score={showEndCard ? finalLeft : displayRow.scoreLeft}
                  projected={showEndCard ? finalLeft : payload.leftProjected}
                  align="left"
                />
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-extrabold uppercase text-white">
                  vs
                </span>
                <TeamChip
                  name={payload.rightName}
                  record={payload.rightRecord}
                  logo={payload.rightLogo}
                  score={showEndCard ? finalRight : displayRow.scoreRight}
                  projected={showEndCard ? finalRight : payload.rightProjected}
                  align="right"
                />
              </div>

              {showEndCard ? (
                <FinalResultBar leftWon={leftWon} tied={tied} />
              ) : (
                <LiveWinBar winLeft={displayRow.winLeft} winRight={displayRow.winRight} />
              )}

              {showEndCard ? (
                <ReplayEndCard
                  payload={payload}
                  leftWon={leftWon}
                  tied={tied}
                  onWatchAgain={resetPlayback}
                />
              ) : (
                <div className="relative h-[300px] w-full overflow-visible sm:h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={visibleData}
                      margin={{ top: 64, right: 36, left: 4, bottom: 28 }}
                    >
                      <CartesianGrid stroke="#e8eef5" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={[0, 100]}
                        ticks={tickValues}
                        tickFormatter={tickFormatter}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                        minTickGap={0}
                        height={36}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 20, 40, 60, 80, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      {displayRow ? (
                        <ReferenceLine
                          x={displayRow.t}
                          stroke="#cbd5e1"
                          strokeDasharray="4 4"
                          ifOverflow="extendDomain"
                        />
                      ) : null}
                      <Line
                        type="monotone"
                        dataKey="winLeft"
                        stroke={LEFT_LINE}
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="winRight"
                        stroke={RIGHT_LINE}
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                      {revealedTds.map(({ td, index }) => {
                        const sampled = sampleAtPlayhead(chartData, td.t).display;
                        const y = td.side === "left" ? sampled.winLeft : sampled.winRight;
                        return (
                          <ReferenceDot
                            key={`td-line-${td.sleeperId}-${td.t}-${index}`}
                            x={td.t}
                            y={y}
                            r={0}
                            shape={(props) => (
                              <TdDot cx={props.cx} cy={props.cy} td={td} />
                            )}
                          />
                        );
                      })}
                      {displayRow ? (
                        <>
                          <ReferenceDot
                            x={displayRow.t}
                            y={displayRow.winLeft}
                            r={0}
                            isFront
                            shape={(props) => (
                              <TeamTipDot
                                cx={props.cx}
                                cy={props.cy}
                                logo={payload.leftLogo}
                                stroke={LEFT_LINE}
                                label="left"
                              />
                            )}
                          />
                          <ReferenceDot
                            x={displayRow.t}
                            y={displayRow.winRight}
                            r={0}
                            isFront
                            shape={(props) => (
                              <TeamTipDot
                                cx={props.cx}
                                cy={props.cy}
                                logo={payload.rightLogo}
                                stroke={RIGHT_LINE}
                                label="right"
                              />
                            )}
                          />
                        </>
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                  {phase === "td_pause" && activeTd ? (
                    <TdCalloutOverlay
                      td={activeTd}
                      winPct={
                        activeTd.side === "left"
                          ? sampleAtPlayhead(chartData, activeTd.t).display.winLeft
                          : sampleAtPlayhead(chartData, activeTd.t).display.winRight
                      }
                    />
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WatchReplayButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center px-4 pb-4 pt-1">
      <Button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="h-10 gap-2 rounded-full bg-sky-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
      >
        <Play className="h-4 w-4 fill-current" aria-hidden />
        Watch Replay
      </Button>
    </div>
  );
}

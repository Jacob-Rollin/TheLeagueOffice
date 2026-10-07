"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Pos } from "@/lib/draft";
import {
  benchPointsLeft,
  boardBattles,
  boardPerformers,
  boardRecapHeadline,
  boardShortName,
  buildMatchupStoryTimeline,
  slotWinCounts,
  type MatchupBoardRecapInput,
  type StoryBeat,
} from "@/lib/matchup-board-recap";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import { cn } from "@/lib/utils";

const LEFT_LINE = "#f0a35a";
const RIGHT_LINE = "#f07178";
const TRAVEL_MS = 14000;
const BEAT_PAUSE_MS = 1800;

type ChartRow = {
  t: number;
  label: string;
  winLeft: number;
  winRight: number;
  scoreLeft: number;
  scoreRight: number;
};

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

function sampleAt(
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
    tip = {
      t: x,
      label: prev.label,
      winLeft: lerp(prev.winLeft, next.winLeft, u),
      winRight: lerp(prev.winRight, next.winRight, u),
      scoreLeft: lerp(prev.scoreLeft, next.scoreLeft, u),
      scoreRight: lerp(prev.scoreRight, next.scoreRight, u),
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

function BeatCallout({ beat, winPct }: { beat: StoryBeat; winPct: number }) {
  const src = playerImage(beat.player.id, beat.player.pos as Pos, beat.player.team);
  const bg = getTeamPrimaryColor(beat.player.team);
  const plotTop = 48;
  const plotBottom = 28;
  const plotLeft = 44;
  const plotRight = 36;
  const yPct = Math.min(100, Math.max(0, 100 - winPct));
  const above = winPct < 78;
  const t = Math.min(100, Math.max(0, beat.t));
  let xTransform = "translateX(-50%)";
  let pointerLeft = "50%";
  if (t < 14) {
    xTransform = "translateX(0)";
    pointerLeft = `${Math.max(12, Math.min(88, (t / 14) * 40 + 12))}%`;
  } else if (t > 86) {
    xTransform = "translateX(-100%)";
    pointerLeft = `${Math.max(12, Math.min(88, 100 - ((100 - t) / 14) * 40 - 12))}%`;
  }
  const yTransform = above ? "translateY(calc(-100% - 18px))" : "translateY(18px)";

  return (
    <div
      className="pointer-events-none absolute z-30 overflow-visible"
      style={{ left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom }}
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
                {boardShortName(beat.player.name)}{" "}
                <span className="font-semibold text-white/85">{beat.player.pos}</span>
              </p>
              <p className="truncate text-xs font-semibold text-white/90">{beat.headline}</p>
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

function StoryChart({
  input,
  active,
}: {
  input: MatchupBoardRecapInput;
  active: boolean;
}) {
  const story = useMemo(() => buildMatchupStoryTimeline(input), [input]);
  const chartData: ChartRow[] = useMemo(
    () =>
      story.points.map((p) => ({
        t: p.t,
        label: p.label,
        winLeft: p.winPctLeft,
        winRight: p.winPctRight,
        scoreLeft: p.scoreLeft,
        scoreRight: p.scoreRight,
      })),
    [story.points],
  );

  const [playheadX, setPlayheadX] = useState(0);
  const [activeBeat, setActiveBeat] = useState<StoryBeat | null>(null);
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !chartData.length) return;
    let cancelled = false;
    setPlayheadX(0);
    setActiveBeat(null);
    setDone(false);

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

    const marks = [...story.beats].sort((a, b) => a.t - b.t);
    const fired = new Set<number>();
    let x = 0;
    let lastTs = 0;
    let paused = false;

    const tick = (ts: number) => {
      if (cancelled || paused) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(64, ts - lastTs);
      lastTs = ts;
      x = Math.min(100, x + (dt / TRAVEL_MS) * 100);
      setPlayheadX(x);

      for (let i = 0; i < marks.length; i++) {
        if (fired.has(i)) continue;
        const mark = marks[i]!;
        if (mark.t > x + 0.05) break;
        fired.add(i);
        paused = true;
        setActiveBeat(mark);
        clearTimer();
        timerRef.current = setTimeout(() => {
          if (cancelled) return;
          setActiveBeat(null);
          paused = false;
          lastTs = 0;
          rafRef.current = requestAnimationFrame(tick);
        }, BEAT_PAUSE_MS);
        return;
      }

      if (x >= 99.95) {
        setPlayheadX(100);
        setDone(true);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    clearTimer();
    timerRef.current = setTimeout(() => {
      if (!cancelled) rafRef.current = requestAnimationFrame(tick);
    }, 300);

    return () => {
      cancelled = true;
      clearTimer();
      clearRaf();
    };
  }, [active, chartData, story.beats]);

  const { display, visible } = useMemo(() => sampleAt(chartData, playheadX), [chartData, playheadX]);
  const tickValues = story.axisTicks.map((t) => t.t);
  const tickFormatter = (t: number) =>
    story.axisTicks.find((tick) => tick.t === t)?.label ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 sm:gap-3">
        <TeamChip
          name={input.left.name}
          record={input.left.record}
          logo={input.left.logo}
          score={done ? input.left.finalScore : display.scoreLeft}
          projected={input.left.projectedScore}
          align="left"
        />
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-extrabold uppercase text-white">
          vs
        </span>
        <TeamChip
          name={input.right.name}
          record={input.right.record}
          logo={input.right.logo}
          score={done ? input.right.finalScore : display.scoreRight}
          projected={input.right.projectedScore}
          align="right"
        />
      </div>

      <div className="flex w-full items-center gap-3 text-sm font-bold">
        <span
          className={cn(
            "w-14 shrink-0 tabular-nums",
            display.winLeft >= display.winRight ? "text-emerald-600" : "text-rose-600",
          )}
        >
          {display.winLeft.toFixed(1)}%
        </span>
        <div className="flex h-2 min-w-0 flex-1 items-center gap-1">
          <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${display.winLeft}%` }}
            />
          </div>
          <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-rose-400 transition-[width] duration-150"
              style={{ width: `${display.winRight}%` }}
            />
          </div>
        </div>
        <span
          className={cn(
            "w-14 shrink-0 text-right tabular-nums",
            display.winRight > display.winLeft ? "text-emerald-600" : "text-rose-600",
          )}
        >
          {display.winRight.toFixed(1)}%
        </span>
      </div>

      <div className="relative h-[260px] w-full overflow-visible sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visible} margin={{ top: 48, right: 36, left: 4, bottom: 28 }}>
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
            <ReferenceLine x={display.t} stroke="#cbd5e1" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="winLeft"
              stroke={LEFT_LINE}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="winRight"
              stroke={RIGHT_LINE}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            {story.beats
              .filter((b) => b.t <= playheadX + 0.05)
              .map((beat, i) => {
                const y =
                  beat.side === "left"
                    ? sampleAt(chartData, beat.t).display.winLeft
                    : sampleAt(chartData, beat.t).display.winRight;
                return (
                  <ReferenceDot
                    key={`beat-${beat.player.id}-${beat.t}-${i}`}
                    x={beat.t}
                    y={y}
                    r={5}
                    fill={beat.side === "left" ? LEFT_LINE : RIGHT_LINE}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              })}
          </LineChart>
        </ResponsiveContainer>
        {activeBeat ? (
          <BeatCallout
            beat={activeBeat}
            winPct={
              activeBeat.side === "left"
                ? sampleAt(chartData, activeBeat.t).display.winLeft
                : sampleAt(chartData, activeBeat.t).display.winRight
            }
          />
        ) : null}
      </div>
      <p className="text-center text-[11px] text-slate-400">
        Story timeline from matchup board — not play-by-play
      </p>
    </div>
  );
}

/**
 * Desktop past-week recap: client story timeline + board sections.
 * No network calls — uses data already on the matchup page.
 */
export function MatchupBoardRecap({
  input,
  active,
  banner,
}: {
  input: MatchupBoardRecapInput;
  /** Drive story animation only while the modal is showing this view. */
  active: boolean;
  /** Optional note when shown as Fluid PBP fallback. */
  banner?: string | null;
}) {
  const battles = useMemo(() => boardBattles(input), [input]);
  const slots = useMemo(() => slotWinCounts(battles), [battles]);
  const performers = useMemo(() => boardPerformers(input), [input]);
  const topScorers = useMemo(
    () => [...performers].sort((a, b) => b.player.points - a.player.points).slice(0, 3),
    [performers],
  );
  const boom = useMemo(
    () =>
      [...performers]
        .filter((p) => p.delta != null)
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0] ?? null,
    [performers],
  );
  const bust = useMemo(
    () =>
      [...performers]
        .filter((p) => p.delta != null)
        .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0] ?? null,
    [performers],
  );
  const bench = useMemo(() => benchPointsLeft(input), [input]);
  const margin = Math.round((input.left.finalScore - input.right.finalScore) * 100) / 100;
  const leftDelta = Math.round((input.left.finalScore - input.left.projectedScore) * 100) / 100;
  const rightDelta = Math.round((input.right.finalScore - input.right.projectedScore) * 100) / 100;

  return (
    <div className="space-y-5">
      {banner ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
          {banner}
        </p>
      ) : null}

      <div className="text-center">
        <p className="text-lg font-bold tracking-tight text-slate-900">
          Week {input.week} Recap
        </p>
        <p className="mt-0.5 text-sm text-slate-500">
          {boardRecapHeadline(input)}
          {Math.abs(margin) > 0.005 ? ` by ${Math.abs(margin).toFixed(2)}` : ""}
        </p>
      </div>

      <StoryChart input={input} active={active} />

      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        <p className="rounded-lg bg-slate-50 px-2 py-2 text-slate-500">
          Slot battles{" "}
          <span className="font-bold text-slate-900">
            {slots.left}-{slots.right}
          </span>
        </p>
        <p className="rounded-lg bg-slate-50 px-2 py-2 text-slate-500">
          vs proj{" "}
          <span className="font-bold text-slate-900">
            {leftDelta >= 0 ? "+" : ""}
            {leftDelta.toFixed(1)} / {rightDelta >= 0 ? "+" : ""}
            {rightDelta.toFixed(1)}
          </span>
        </p>
      </div>

      <section>
        <h3 className="pb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
          Top Scorers
        </h3>
        <div className="space-y-2">
          {topScorers.map((row, i) => {
            const src = playerImage(row.player.id, row.player.pos as Pos, row.player.team);
            return (
              <div
                key={`${row.side}-${row.player.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5"
              >
                <span className="w-5 text-center text-sm font-bold text-slate-400">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="h-10 w-10 rounded-full border border-slate-200 object-cover bg-slate-50"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {boardShortName(row.player.name)}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {row.side === "left" ? input.left.name : input.right.name} · {row.player.pos}
                  </p>
                </div>
                <p className="text-lg font-bold tabular-nums text-slate-900">
                  {row.player.points.toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {(boom || bust) && (
        <section className="grid grid-cols-2 gap-2">
          {boom ? (
            <div className="rounded-xl border border-slate-100 bg-white px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Biggest boom
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {boardShortName(boom.player.name)}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-emerald-600">
                {(boom.delta ?? 0) >= 0 ? "+" : ""}
                {(boom.delta ?? 0).toFixed(1)}
              </p>
            </div>
          ) : null}
          {bust ? (
            <div className="rounded-xl border border-slate-100 bg-white px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Biggest bust
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {boardShortName(bust.player.name)}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-rose-600">
                {(bust.delta ?? 0).toFixed(1)}
              </p>
            </div>
          ) : null}
        </section>
      )}

      <section>
        <h3 className="pb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
          Position Battles
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          {battles.map((b, i) => (
            <div
              key={`${b.slot}-${i}`}
              className={cn(
                "grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5 text-sm",
                i > 0 && "border-t border-slate-100",
              )}
            >
              <BattleSide
                player={b.left}
                points={b.leftPts}
                won={b.winner === "left"}
                align="left"
              />
              <span className="text-[10px] font-bold uppercase text-slate-400">{b.slot}</span>
              <BattleSide
                player={b.right}
                points={b.rightPts}
                won={b.winner === "right"}
                align="right"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-100 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
          Bench Points
        </h3>
        <p className="mt-1 text-xs text-slate-400">Points left on the bench this week.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="truncate text-xs text-slate-400">{input.left.name}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {bench.left.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="truncate text-xs text-slate-400">{input.right.name}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {bench.right.toFixed(2)}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function BattleSide({
  player,
  points,
  won,
  align,
}: {
  player: { name: string } | null;
  points: number;
  won: boolean;
  align: "left" | "right";
}) {
  const name = player ? boardShortName(player.name) : "—";
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className={cn("truncate text-[13px] font-semibold", won && "text-emerald-600")}>{name}</p>
      <p
        className={cn(
          "text-xs tabular-nums",
          won ? "font-bold text-slate-900" : "text-slate-400",
        )}
      >
        {points.toFixed(2)}
      </p>
    </div>
  );
}

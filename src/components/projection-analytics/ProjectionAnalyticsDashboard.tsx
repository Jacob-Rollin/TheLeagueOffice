import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  ENGINE_POSITIONS,
  FORMATS,
  FORMAT_INDEX,
  FORMAT_LABEL,
  SOURCES,
  TRACKS,
  TRACK_COLOR,
  TRACK_LABEL,
  TRACK_SHORT,
  biasLabel,
  fetchAccuracyFile,
  fetchProjectionFile,
  ordinal,
  rowTrackPts,
  type AccuracyFile,
  type EnginePos,
  type Format,
  type ProjectionFile,
  type SourceHealth,
  type Summary,
  type TrackKey,
} from "@/lib/projection-analytics";
import { cn } from "@/lib/utils";

const box = "border border-slate-200 bg-white";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const thNum = "px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-3 py-2 text-slate-700";
const tdNum = "tabnum px-3 py-2 text-right text-slate-700";
const PUBLISHED: TrackKey[] = ["sleeper", "espn", "cbs"];

function currentSeason(): number {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={box}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="display-title text-lg text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Toggle<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap border border-slate-200 bg-white">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold transition-colors",
            option.value === value ? "bg-primary text-primary-foreground" : "text-primary hover:bg-primary/5",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ProjectionAnalyticsDashboard() {
  const [format, setFormat] = useState<Format>("half");
  const projections = useQuery({
    queryKey: ["projection-engine", "projections"],
    queryFn: fetchProjectionFile,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  const season = projections.data?.season ?? currentSeason();
  const accuracy = useQuery({
    queryKey: ["projection-engine", "accuracy", season],
    queryFn: () => fetchAccuracyFile(season),
    enabled: !projections.isLoading,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const proj = projections.data ?? null;
  const acc = accuracy.data ?? null;
  const gradedWeeks = acc ? Object.keys(acc.weeks).map(Number).sort((a, b) => a - b) : [];

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Admin Trial</p>
          <h1 className="display-title text-3xl text-slate-900">Projection Analytics</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Our custom projection engine blends Sleeper, ESPN, CBS and our nflverse model, then grades every source
            against real results each Tuesday. Nothing else on the site uses this data yet.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {proj ? `Week ${proj.week} projections updated ${timeAgo(proj.generatedAt)}` : "No projections published yet"}
            {" · "}
            {gradedWeeks.length
              ? `Accuracy graded through Week ${gradedWeeks[gradedWeeks.length - 1]}, updated ${timeAgo(acc?.updatedAt)}`
              : "No weeks graded yet"}
          </p>
        </div>
        <Toggle
          options={FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
          value={format}
          onChange={setFormat}
        />
      </div>

      {projections.error || accuracy.error ? (
        <div className={cn(box, "mb-5 px-4 py-3 text-sm text-red-600")}>
          {(projections.error ?? accuracy.error)?.message ?? "Could not load the engine data."}
        </div>
      ) : null}

      {projections.isLoading || accuracy.isLoading ? (
        <div className={cn(box, "px-4 py-8 text-sm text-slate-500")}>Loading engine data...</div>
      ) : (
        <div className="space-y-5">
          {acc && acc.season_overall ? (
            <>
              <SeasonTicker acc={acc} summary={acc.season_overall} format={format} />
              <AccuracyStandings acc={acc} format={format} weeks={gradedWeeks} />
              <WeeklyTrend acc={acc} format={format} weeks={gradedWeeks} />
              <BiggestMisses acc={acc} format={format} weeks={gradedWeeks} />
            </>
          ) : (
            <div className={cn(box, "px-4 py-6")}>
              <h2 className="display-title text-lg text-slate-900">Accuracy Standings</h2>
              <p className="mt-1 text-sm text-slate-500">
                No weeks graded yet. The audit runs every Tuesday at 8 AM Central once all of the week's games are
                final, then re-grades Friday after stat corrections.
              </p>
            </div>
          )}
          {proj ? (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <SourceHealthPanel proj={proj} acc={acc} />
                <BlendWeights proj={proj} />
              </div>
              <WeekProjections proj={proj} format={format} />
            </>
          ) : (
            <div className={cn(box, "px-4 py-6 text-sm text-slate-500")}>
              The engine hasn't published projections yet. It runs hourly from GitHub Actions, or it can be started
              by hand from the Projection Engine workflow.
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function SeasonTicker({ acc, summary, format }: { acc: AccuracyFile; summary: Summary; format: Format }) {
  const { engine, sleeper, ties } = acc.ticker.engineVsSleeper;
  const ranked = [...TRACKS].sort((a, b) => summary[format][a].mae - summary[format][b].mae);
  const leader = ranked[0] ?? "engine";
  const enginePlace = ranked.indexOf("engine") + 1;
  const weeks = Object.keys(acc.weeks).length;
  const engineMae = summary[format].engine.mae;
  const sleeperMae = summary[format].sleeper.mae;
  const gap = sleeperMae - engineMae;

  return (
    <Section title="Season Ticker" description="Weekly head-to-head uses Half PPR error; the rest follows the selected format.">
      <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Our Custom API vs Sleeper App</p>
          <p className="tabnum mt-1 text-3xl font-bold text-slate-900">
            {engine} <span className="text-slate-300">-</span> {sleeper}
            {ties ? <span className="ml-2 text-base font-semibold text-slate-400">{ties} tied</span> : null}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {engine === sleeper
              ? "Weeks closer to reality, even so far"
              : engine > sleeper
                ? `Our engine is ${engine - sleeper} ${engine - sleeper === 1 ? "week" : "weeks"} ahead`
                : `Sleeper is ${sleeper - engine} ${sleeper - engine === 1 ? "week" : "weeks"} ahead`}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Season Error Gap</p>
          <p className={cn("tabnum mt-1 text-3xl font-bold", gap > 0 ? "text-emerald-600" : gap < 0 ? "text-red-600" : "text-slate-900")}>
            {gap > 0 ? "+" : ""}
            {gap.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Points per player {gap >= 0 ? "closer" : "further"} than Sleeper ({engineMae.toFixed(2)} vs {sleeperMae.toFixed(2)})
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Most Accurate Source</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{TRACK_LABEL[leader]}</p>
          <p className="mt-1 text-xs text-slate-500">
            Off by {summary[format][leader].mae.toFixed(2)} points on average. Our engine ranks {ordinal(enginePlace)} of {TRACKS.length}.
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Weeks Beating the Baseline</p>
          <ul className="mt-2 space-y-1 text-xs">
            {TRACKS.filter((t) => t !== "baseline").map((t) => (
              <li key={t} className="flex justify-between gap-3">
                <span className="text-slate-600">{TRACK_LABEL[t]}</span>
                <span className="tabnum font-semibold text-slate-900">
                  {acc.ticker.beatBaseline[t] ?? 0} of {weeks}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function AccuracyStandings({ acc, format, weeks }: { acc: AccuracyFile; format: Format; weeks: number[] }) {
  const [scope, setScope] = useState<number>(0);
  const report = scope ? acc.weeks[String(scope)] : null;
  const overall = scope ? report?.overall : acc.season_overall;
  const byPos = scope ? (report?.byPos ?? {}) : acc.season_byPos;
  if (!overall) return null;

  const ranked = [...TRACKS].sort((a, b) => overall[format][a].mae - overall[format][b].mae);
  const best = (pos: EnginePos) => {
    const s = byPos[pos];
    if (!s) return null;
    return TRACKS.reduce((min, t) => (s[format][t].mae < s[format][min].mae ? t : min), "engine" as TrackKey);
  };
  const bestByPos = Object.fromEntries(ENGINE_POSITIONS.map((p) => [p, best(p)]));
  const players = overall[format].engine.n;

  return (
    <Section
      title="Accuracy Standings"
      description={`Mean absolute error in ${FORMAT_LABEL[format]} points, lower is better. ${players} player-weeks graded. Best at each position in blue.`}
      actions={
        <Toggle
          options={[{ value: 0, label: "Season" }, ...weeks.map((w) => ({ value: w, label: `Wk ${w}` }))]}
          value={scope}
          onChange={setScope}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className={th}>Rank</th>
              <th className={th}>Source</th>
              <th className={thNum}>MAE</th>
              <th className={thNum}>Lean</th>
              {ENGINE_POSITIONS.map((p) => (
                <th key={p} className={thNum}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => (
              <tr key={t} className={cn("border-t border-slate-100", t === "engine" && "bg-primary/[0.04]")}>
                <td className={cn(td, "font-semibold text-slate-900")}>{ordinal(i + 1)}</td>
                <td className={td}>
                  <span className="mr-2 inline-block h-2 w-2 align-middle" style={{ background: TRACK_COLOR[t] }} />
                  <span className={cn(t === "engine" && "font-semibold text-slate-900")}>{TRACK_LABEL[t]}</span>
                </td>
                <td className={cn(tdNum, "font-semibold text-slate-900")}>{overall[format][t].mae.toFixed(2)}</td>
                <td className={cn(tdNum, "text-xs text-slate-500")}>{biasLabel(overall[format][t].bias)}</td>
                {ENGINE_POSITIONS.map((p) => {
                  const s = byPos[p];
                  return (
                    <td key={p} className={cn(tdNum, bestByPos[p] === t && "font-semibold text-primary")}>
                      {s ? s[format][t].mae.toFixed(2) : "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Every source is graded on the same players: the consensus top 24 QBs, 48 RBs, 60 WRs, 24 TEs, 16 kickers and 16
        defenses that all six projected, frozen at each game's kickoff. Lean is the average amount a source projects
        above or below actual.
      </p>
    </Section>
  );
}

function WeeklyTrend({ acc, format, weeks }: { acc: AccuracyFile; format: Format; weeks: number[] }) {
  const data = weeks.map((w) => {
    const report = acc.weeks[String(w)];
    const point: Record<string, number | string> = { week: `Wk ${w}` };
    if (report) for (const t of TRACKS) point[t] = report.overall[format][t].mae;
    return point;
  });

  return (
    <Section title="Weekly Error Trend" description={`${FORMAT_LABEL[format]} MAE by week for every source.`}>
      <div className="px-2 pb-2 pt-4">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={40}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <Tooltip
                contentStyle={{ borderRadius: 0, border: "1px solid #e2e8f0", fontSize: 12 }}
                formatter={(value: number, key: string) => [value.toFixed(2), TRACK_LABEL[key as TrackKey] ?? key]}
              />
              {TRACKS.map((t) => (
                <Line
                  key={t}
                  type="monotone"
                  dataKey={t}
                  stroke={TRACK_COLOR[t]}
                  strokeWidth={t === "engine" ? 3 : 1.5}
                  strokeDasharray={t === "baseline" ? "4 3" : undefined}
                  dot={{ r: t === "engine" ? 4 : 3, strokeWidth: 0, fill: TRACK_COLOR[t] }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-xs text-slate-600">
          {TRACKS.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: TRACK_COLOR[t] }} />
              {TRACK_LABEL[t]}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function BiggestMisses({ acc, format, weeks }: { acc: AccuracyFile; format: Format; weeks: number[] }) {
  const [week, setWeek] = useState<number>(0);
  const [pos, setPos] = useState<EnginePos | "ALL">("ALL");
  const [track, setTrack] = useState<TrackKey>("engine");
  const fi = FORMAT_INDEX[format];

  const rows = useMemo(
    () =>
      acc.rows
        .filter((r) => (!week || r[0] === week) && (pos === "ALL" || r[3] === pos))
        .map((r) => ({ r, miss: rowTrackPts(r, track)[fi] - r[5][fi] }))
        .sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss))
        .slice(0, 25),
    [acc.rows, week, pos, track, fi],
  );

  return (
    <Section
      title="Biggest Misses"
      description={`The 25 largest ${FORMAT_LABEL[format]} misses for ${TRACK_LABEL[track]}, with every source's projection for comparison.`}
    >
      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
        <Toggle
          options={TRACKS.map((t) => ({ value: t, label: TRACK_SHORT[t] }))}
          value={track}
          onChange={setTrack}
        />
        <Toggle
          options={[{ value: "ALL" as const, label: "All" }, ...ENGINE_POSITIONS.map((p) => ({ value: p, label: p }))]}
          value={pos}
          onChange={setPos}
        />
        <Toggle
          options={[{ value: 0, label: "All Weeks" }, ...weeks.map((w) => ({ value: w, label: `Wk ${w}` }))]}
          value={week}
          onChange={setWeek}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className={th}>Player</th>
              <th className={thNum}>Week</th>
              <th className={thNum}>Actual</th>
              {TRACKS.map((t) => (
                <th key={t} className={cn(thNum, t === track && "text-primary")}>
                  {TRACK_SHORT[t]}
                </th>
              ))}
              <th className={thNum}>Miss</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={TRACKS.length + 4} className="px-3 py-6 text-sm text-slate-500">
                  No graded players match these filters.
                </td>
              </tr>
            ) : (
              rows.map(({ r, miss }) => (
                <tr key={`${r[0]}-${r[1]}`} className="border-t border-slate-100">
                  <td className={td}>
                    <span className="font-medium text-slate-900">{r[2]}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {r[3]} {r[4]}
                    </span>
                  </td>
                  <td className={tdNum}>{r[0]}</td>
                  <td className={cn(tdNum, "font-semibold text-slate-900")}>{r[5][fi].toFixed(1)}</td>
                  {TRACKS.map((t) => (
                    <td key={t} className={cn(tdNum, t === track ? "font-semibold text-primary" : "text-slate-500")}>
                      {rowTrackPts(r, t)[fi].toFixed(1)}
                    </td>
                  ))}
                  <td className={cn(tdNum, "font-semibold", miss > 0 ? "text-red-600" : "text-blue-600")}>
                    {miss > 0 ? `${miss.toFixed(1)} high` : `${Math.abs(miss).toFixed(1)} low`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

const STATUS_TEXT: Record<SourceHealth["status"], { label: string; className: string }> = {
  ok: { label: "Healthy", className: "text-emerald-600" },
  fallback: { label: "Using earlier lines", className: "text-amber-600" },
  down: { label: "Down", className: "text-red-600" },
};

function SourceHealthPanel({ proj, acc }: { proj: ProjectionFile; acc: AccuracyFile | null }) {
  const latestWeek = acc ? Math.max(0, ...Object.keys(acc.weeks).map(Number)) : 0;
  const check = latestWeek ? acc?.weeks[String(latestWeek)]?.scoringCheck : null;
  return (
    <Section title="Source Health" description={`Latest engine run for Week ${proj.week}, ${timeAgo(proj.generatedAt)}.`}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className={th}>Source</th>
            <th className={th}>Status</th>
            <th className={thNum}>Players</th>
            <th className={thNum}>Last Success</th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map((s) => {
            const health = proj.sources[s];
            const status = STATUS_TEXT[health?.status ?? "down"];
            return (
              <tr key={s} className="border-t border-slate-100">
                <td className={td}>
                  <span className="font-medium text-slate-900">{TRACK_LABEL[s]}</span>
                  {health?.note ? <span className="block text-xs text-slate-400">{health.note}</span> : null}
                </td>
                <td className={cn(td, "font-semibold", status.className)}>{status.label}</td>
                <td className={tdNum}>{health?.players ?? 0}</td>
                <td className={cn(tdNum, "text-xs text-slate-500")}>{timeAgo(health?.lastOkAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        {check
          ? `Scoring check, Week ${latestWeek}: ${check.mismatches} of ${check.checked} offensive players differ from Sleeper's official point totals.`
          : "The scoring check appears after the first graded week."}{" "}
        When a feed fails, the engine keeps that source's earlier lines from the same week.
      </p>
    </Section>
  );
}

function BlendWeights({ proj }: { proj: ProjectionFile }) {
  const sources = SOURCES.filter((s) => ENGINE_POSITIONS.some((p) => (proj.weights[p]?.[s] ?? 0) > 0));
  return (
    <Section title="Blend Weights" description="Share of each position's engine projection taken from each source.">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className={th}>Position</th>
            {sources.map((s) => (
              <th key={s} className={thNum}>
                {TRACK_SHORT[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ENGINE_POSITIONS.map((p) => (
            <tr key={p} className="border-t border-slate-100">
              <td className={cn(td, "font-semibold text-slate-900")}>{p}</td>
              {sources.map((s) => {
                const w = proj.weights[p]?.[s] ?? 0;
                return (
                  <td key={s} className={cn(tdNum, !w && "text-slate-300")}>
                    {w ? `${Math.round(w * 100)}%` : "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        If a source is missing a player or a stat, its share is split across the sources that have it. The recent-form
        baseline is graded only and never blended.
      </p>
    </Section>
  );
}

function WeekProjections({ proj, format }: { proj: ProjectionFile; format: Format }) {
  const [pos, setPos] = useState<EnginePos>("QB");
  const [query, setQuery] = useState("");
  const fi = FORMAT_INDEX[format];
  const now = Date.now();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(proj.players)
      .filter(([, p]) => p.pos === pos && (!q || p.name.toLowerCase().includes(q)))
      .map(([id, p]) => {
        const published = PUBLISHED.map((t) => p.pts[t]?.[fi]).filter((v): v is number => v != null);
        const range = published.length > 1 ? Math.max(...published) - Math.min(...published) : null;
        return { id, p, engine: p.pts.engine?.[fi] ?? 0, range };
      })
      .sort((a, b) => b.engine - a.engine)
      .slice(0, 40);
  }, [proj.players, pos, query, fi]);

  return (
    <Section
      title={`Week ${proj.week} Projections`}
      description={`Top 40 by our engine in ${FORMAT_LABEL[format]}. Range is the spread between Sleeper, ESPN and CBS. Locked players have kicked off.`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Toggle options={ENGINE_POSITIONS.map((p) => ({ value: p, label: p }))} value={pos} onChange={setPos} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          className="h-8 w-48 border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-primary"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className={th}>Player</th>
              <th className={th}>Matchup</th>
              {TRACKS.map((t) => (
                <th key={t} className={cn(thNum, t === "engine" && "text-primary")}>
                  {TRACK_SHORT[t]}
                </th>
              ))}
              <th className={thNum}>Range</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={TRACKS.length + 3} className="px-3 py-6 text-sm text-slate-500">
                  No players match.
                </td>
              </tr>
            ) : (
              rows.map(({ id, p, range }) => {
                const locked = p.kickoff != null && Date.parse(p.kickoff) <= now;
                return (
                  <tr key={id} className="border-t border-slate-100">
                    <td className={td}>
                      <span className="font-medium text-slate-900">{p.name}</span>
                      {p.injury ? <span className="ml-2 text-xs font-semibold text-red-600">{p.injury}</span> : null}
                      {p.stale?.length ? (
                        <span className="block text-xs text-amber-600">
                          Earlier lines: {p.stale.map((s) => TRACK_SHORT[s]).join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(td, "text-xs text-slate-500")}>
                      {p.team}
                      {p.opp ? ` vs ${p.opp}` : " bye"}
                      {locked ? <span className="ml-2 font-semibold text-slate-700">Locked</span> : null}
                    </td>
                    {TRACKS.map((t) => {
                      const v = p.pts[t]?.[fi];
                      return (
                        <td
                          key={t}
                          className={cn(tdNum, t === "engine" ? "font-semibold text-primary" : "text-slate-500")}
                        >
                          {v != null ? v.toFixed(1) : "-"}
                        </td>
                      );
                    })}
                    <td className={cn(tdNum, range != null && range >= 5 ? "font-semibold text-amber-600" : "text-slate-500")}>
                      {range != null ? range.toFixed(1) : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

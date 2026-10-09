import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getNativeLeagueBoard, getNativeMatchupWeek } from "@/lib/native-league.functions";
import {
  fetchNativeLiveWeekStats,
  overlayNativeLiveMatchupScores,
} from "@/lib/native-live-scoring";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { ScoringMap } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/matchup")({
  ssr: false,
  component: NativeMatchupPage,
});

/** Live stats poll while Matchup is open and the tab is visible (native only). */
const LIVE_STATS_POLL_MS = 60_000;

function NativeMatchupPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const [week, setWeek] = useState<number | null>(null);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });
  const activeWeek = week ?? board?.currentWeek ?? 1;

  const { data, isLoading } = useQuery({
    queryKey: ["native-matchup-week", linkId, activeWeek],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeMatchupWeek({ data: { linkId, week: activeWeek } }),
  });

  const seasonYear = data?.seasonYear ?? board?.summary.seasonYear ?? new Date().getUTCFullYear();
  const isCurrentWeek = activeWeek === (board?.currentWeek ?? activeWeek);

  const liveStats = useQuery({
    queryKey: ["native-live-week-stats", seasonYear, activeWeek],
    enabled: Boolean(data && isCurrentWeek),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: visibleRefetchInterval(LIVE_STATS_POLL_MS),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => fetchNativeLiveWeekStats(seasonYear, activeWeek),
  });

  const scoredMatchups = useMemo(() => {
    const base = data?.matchups ?? [];
    const stats = liveStats.data?.stats;
    const starters = data?.startersByTeamId ?? {};
    const scoring = (data?.scoringSettings ?? {}) as ScoringMap;
    if (!stats || Object.keys(stats).length === 0) return base;
    return overlayNativeLiveMatchupScores(base, starters, stats, scoring);
  }, [data?.matchups, data?.startersByTeamId, data?.scoringSettings, liveStats.data?.stats]);

  const liveActive = Boolean(
    isCurrentWeek && liveStats.data && Object.keys(liveStats.data.stats).length > 0,
  );

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of cache.data?.players ?? fallback.data?.players ?? []) map.set(p.id, p.name);
    return map;
  }, [cache.data?.players, fallback.data?.players]);

  const myTeamId = data?.myTeamId ?? board?.summary.teamId ?? null;
  const focus =
    scoredMatchups.find((m) => m.home.teamId === myTeamId || m.away.teamId === myTeamId) ??
    scoredMatchups[0] ??
    null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl text-slate-900">
            Week <span className="text-primary">Matchup</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {liveActive
              ? "Live scores from shared week stats (refreshes about every minute while this tab is open)."
              : "Official scores update when the scoring cron writes TiDB snaps. Live overlay appears once week-stats snap is published."}
          </p>
          {liveActive && liveStats.data?.updatedAt ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Stats as of {new Date(liveStats.data.updatedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <label className="text-sm">
          <span className="sr-only">Week</span>
          <select
            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
            value={activeWeek}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading matchups…</p>
      ) : !focus ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No schedule for this week yet. Complete the draft to generate matchups.
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-3 sm:items-center">
              <TeamScore
                name={focus.home.teamName}
                points={focus.home.points}
                mine={focus.home.teamId === myTeamId}
                align="left"
                live={liveActive}
              />
              <p className="text-center font-display text-sm uppercase tracking-wide text-slate-500">
                Week {activeWeek}
                {liveActive ? (
                  <span className="mt-1 block text-[10px] font-semibold tracking-wider text-accent">
                    Live
                  </span>
                ) : null}
              </p>
              <TeamScore
                name={focus.away.teamName}
                points={focus.away.points}
                mine={focus.away.teamId === myTeamId}
                align="right"
                live={liveActive}
              />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <StarterList
                title={focus.home.teamName}
                points={focus.home.playerPoints}
                nameById={nameById}
              />
              <StarterList
                title={focus.away.teamName}
                points={focus.away.playerPoints}
                nameById={nameById}
              />
            </div>
          </section>

          {scoredMatchups.length > 1 ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">
                  All matchups
                </h3>
              </div>
              <ul className="divide-y divide-slate-100">
                {scoredMatchups.map((m) => (
                  <li
                    key={m.matchupId}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      {m.home.teamName}{" "}
                      <span className="font-semibold">{m.home.points.toFixed(1)}</span>
                    </span>
                    <span className="text-muted-foreground">vs</span>
                    <span className="text-right">
                      <span className="font-semibold">{m.away.points.toFixed(1)}</span>{" "}
                      {m.away.teamName}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function TeamScore({
  name,
  points,
  mine,
  align,
  live,
}: {
  name: string;
  points: number;
  mine: boolean;
  align: "left" | "right";
  live?: boolean;
}) {
  return (
    <div className={cn(align === "right" && "sm:text-right")}>
      <p className={cn("font-medium text-slate-900", mine && "text-primary")}>{name}</p>
      <p
        className={cn(
          "font-display text-3xl font-semibold tracking-wide text-slate-900",
          live && "text-slate-900",
        )}
      >
        {points.toFixed(1)}
      </p>
    </div>
  );
}

function StarterList({
  title,
  points,
  nameById,
}: {
  title: string;
  points: Record<string, number>;
  nameById: Map<string, string>;
}) {
  const rows = Object.entries(points);
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No scored starters yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map(([id, pts]) => (
            <li key={id} className="flex justify-between gap-2">
              <span className="truncate">{nameById.get(id) ?? id}</span>
              <span className="shrink-0 font-medium">{pts.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

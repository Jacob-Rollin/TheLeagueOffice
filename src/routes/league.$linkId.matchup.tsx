import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  FantasyBoard,
  FantasyMatchupScoreCard,
  FantasyMatchupWeekList,
  FantasyWeekSelect,
  nativeMatchupViewToCard,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getNativeLeagueBoard, getNativeMatchupWeek } from "@/lib/native-league.functions";
import {
  fetchNativeLiveWeekStats,
  overlayNativeLiveMatchupScores,
} from "@/lib/native-live-scoring";
import {
  expandLineupSlots,
  parseRosterSlotCounts,
} from "@/lib/native-league-lineup";
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
  const [selectedMatchupId, setSelectedMatchupId] = useState<number | null>(null);

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

  const matchupCards = useMemo(
    () => scoredMatchups.map((m) => nativeMatchupViewToCard(m)),
    [scoredMatchups],
  );

  const defaultMatchupId = useMemo(() => {
    const mine = scoredMatchups.find(
      (m) => m.home.teamId === myTeamId || m.away.teamId === myTeamId,
    );
    return mine?.matchupId ?? scoredMatchups[0]?.matchupId ?? null;
  }, [scoredMatchups, myTeamId]);

  useEffect(() => {
    setSelectedMatchupId(null);
  }, [activeWeek]);

  const focusMatchupId = selectedMatchupId ?? defaultMatchupId;
  const focus =
    scoredMatchups.find((m) => m.matchupId === focusMatchupId) ?? scoredMatchups[0] ?? null;

  const starterSlotLabels = useMemo(() => {
    const counts = parseRosterSlotCounts(board?.rosterSlots);
    return expandLineupSlots(counts)
      .filter((row) => row.starter)
      .map((row) => row.label);
  }, [board?.rosterSlots]);

  const headToHeadRows = useMemo(() => {
    if (!focus || !data?.startersByTeamId) return [];
    const homeIds = data.startersByTeamId[String(focus.home.teamId)] ?? [];
    const awayIds = data.startersByTeamId[String(focus.away.teamId)] ?? [];
    const len = Math.max(homeIds.length, awayIds.length);
    const rows: Array<{
      slot: string;
      homeId: string | null;
      awayId: string | null;
      homePts: number | null;
      awayPts: number | null;
    }> = [];
    for (let i = 0; i < len; i++) {
      const homeId = homeIds[i] ?? null;
      const awayId = awayIds[i] ?? null;
      rows.push({
        slot: starterSlotLabels[i] ?? `S${i + 1}`,
        homeId,
        awayId,
        homePts: homeId ? (focus.home.playerPoints[homeId] ?? null) : null,
        awayPts: awayId ? (focus.away.playerPoints[awayId] ?? null) : null,
      });
    }
    return rows;
  }, [focus, data?.startersByTeamId, starterSlotLabels]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display-title text-3xl text-slate-900">
            Week <span className="text-primary">Matchup</span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
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
        <FantasyWeekSelect week={activeWeek} onWeekChange={(w) => setWeek(w)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading matchups…</p>
      ) : !focus ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No schedule for this week yet. Complete the draft to generate matchups.
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <FantasyMatchupScoreCard
              home={nativeMatchupViewToCard(focus).home}
              away={nativeMatchupViewToCard(focus).away}
              myTeamId={myTeamId}
              weekLabel={
                <span className="font-display text-xs font-bold uppercase tracking-widest text-slate-500">
                  Week {activeWeek}
                </span>
              }
              status={liveActive ? "live" : null}
            />
            <FantasyMatchupWeekList
              matchups={matchupCards}
              myTeamId={myTeamId}
              selectedMatchupId={focusMatchupId}
              onSelectMatchup={setSelectedMatchupId}
            />
          </div>

          <FantasyBoard title="Starter comparison" bodyClassName="overflow-x-auto">
            {headToHeadRows.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                No starter lineups saved for this matchup yet.
              </p>
            ) : (
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">Home</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Slot</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Away</th>
                  </tr>
                </thead>
                <tbody>
                  {headToHeadRows.map((row) => (
                    <tr key={row.slot} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5">
                        <StarterCell
                          playerId={row.homeId}
                          points={row.homePts}
                          nameById={nameById}
                          align="left"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          {row.slot}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StarterCell
                          playerId={row.awayId}
                          points={row.awayPts}
                          nameById={nameById}
                          align="right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </FantasyBoard>
        </>
      )}
    </div>
  );
}

function StarterCell({
  playerId,
  points,
  nameById,
  align,
}: {
  playerId: string | null;
  points: number | null;
  nameById: Map<string, string>;
  align: "left" | "right";
}) {
  if (!playerId) {
    return (
      <span
        className={cn(
          "block text-muted-foreground",
          align === "right" && "text-right",
        )}
      >
        —
      </span>
    );
  }
  const name = nameById.get(playerId) ?? playerId;
  const pts =
    points != null && Number.isFinite(points) ? points.toFixed(1) : "—";
  return (
    <div className={cn(align === "right" && "text-right")}>
      <span className="font-medium text-slate-900">{name}</span>
      <span className="ml-2 font-display italic text-slate-700">{pts}</span>
    </div>
  );
}

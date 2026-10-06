import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import {
  PLAYER_LIST_COL_HEADER_ROW,
  PLAYER_LIST_GROUP_HEADER_ROW,
  PLAYER_LIST_GROUP_TH,
} from "@/components/research/SortHeader";
import { SosStars } from "@/components/sos/SosStars";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import {
  useLeagueProjections,
  useNflState,
  useSleeperWeekStats,
} from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos } from "@/lib/draft";
import { currentSeason, fetchSchedule } from "@/lib/players-build";
import { fetchSnapFantasyNews } from "@/lib/snap-cdn";
import { formatNflKickoffLabel, progressForNflTeam } from "@/lib/rolling-live-projection";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { scoreStats } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";
import {
  buildScheduleByTeam,
  sortWirePool,
  weeklyFallback,
  weeklyWireMatchup,
} from "@/lib/wire-matchups";

export const Route = createFileRoute("/top-available")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Top Available — The League Office" },
      {
        name: "description",
        content:
          "The best players still available in your synced league, with matchups, projections, stats and schedules.",
      },
    ],
  }),
  component: TopAvailableRoute,
});

type PosTab = "ALL" | Pos;
type View = "overview" | "projections" | "statistics" | "schedule";

const POS_TABS: { id: PosTab; label: string }[] = [
  { id: "ALL", label: "All Positions" },
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR", label: "WR" },
  { id: "TE", label: "TE" },
  { id: "K", label: "K" },
  { id: "DEF", label: "DST" },
];

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projections", label: "Projections" },
  { id: "statistics", label: "Statistics" },
  { id: "schedule", label: "Schedule" },
];

/** How many players each position shows on All Positions. */
const GROUPS: { pos: Pos; title: string; allLimit: number }[] = [
  { pos: "QB", title: "Top Quarterbacks", allLimit: 5 },
  { pos: "RB", title: "Top Running Backs", allLimit: 10 },
  { pos: "WR", title: "Top Wide Receivers", allLimit: 10 },
  { pos: "TE", title: "Top Tight Ends", allLimit: 5 },
  { pos: "K", title: "Top Kickers", allLimit: 5 },
  { pos: "DEF", title: "Top Defense & Special Teams", allLimit: 5 },
];
const SINGLE_POSITION_LIMIT = 25;
const SCHEDULE_WEEKS = 5;

type StatCol = {
  key: string;
  label: string;
  lowerBetter?: boolean;
  resolve?: (stats: Record<string, number>) => number | null;
};
type StatGroup = { label: string; cols: StatCol[] };

const PASSING: StatGroup = {
  label: "Passing",
  cols: [
    { key: "pass_yd", label: "Yds" },
    { key: "pass_td", label: "TDs" },
    { key: "pass_int", label: "Int", lowerBetter: true },
  ],
};
const RUSHING: StatGroup = {
  label: "Rushing",
  cols: [
    { key: "rush_att", label: "Att" },
    { key: "rush_yd", label: "Yds" },
    { key: "rush_td", label: "TDs" },
    { key: "fum_lost", label: "Fum", lowerBetter: true },
  ],
};
const RECEIVING: StatGroup = {
  label: "Receiving",
  cols: [
    { key: "rec", label: "Rec" },
    { key: "rec_yd", label: "Yds" },
    { key: "rec_td", label: "TDs" },
  ],
};
const KICKING: StatGroup = {
  label: "Kicking",
  cols: [
    { key: "fgm", label: "FGM" },
    {
      key: "fga",
      label: "FGA",
      resolve: (s) => {
        if (s["fga"] != null) return Number(s["fga"]);
        const made = Number(s["fgm"] ?? NaN);
        const miss = Number(s["fgmiss"] ?? NaN);
        return Number.isFinite(made) && Number.isFinite(miss) ? made + miss : null;
      },
    },
    { key: "xpm", label: "XPM" },
  ],
};
const DEFENSE: StatGroup = {
  label: "Defense",
  cols: [
    { key: "sack", label: "Sack" },
    { key: "int", label: "Int" },
    { key: "fum_rec", label: "Fum Rec" },
    { key: "ff", label: "Fum Forced" },
    { key: "def_td", label: "Def TD" },
    { key: "safe", label: "Safe" },
    { key: "pts_allow", label: "Pts Vs", lowerBetter: true },
    { key: "yds_allow", label: "Yds Vs", lowerBetter: true },
  ],
};

const STAT_GROUPS: Record<Pos, StatGroup[]> = {
  QB: [PASSING, RUSHING],
  RB: [RUSHING, RECEIVING],
  WR: [RECEIVING, RUSHING],
  TE: [RECEIVING],
  K: [KICKING],
  DEF: [DEFENSE],
};

function statValue(stats: Record<string, number> | null, col: StatCol): number | null {
  if (!stats) return null;
  if (col.resolve) return col.resolve(stats);
  const n = Number(stats[col.key]);
  // A stat line that exists but omits a counting key means zero of it.
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number | null, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

type Heat = "best" | "worst" | null;

/** Top and bottom ~30% of a column get a soft green / orange tint, like the source tables. */
function heatFor(values: (number | null)[], lowerBetter = false): Heat[] {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length < 4) return values.map(() => null);
  const sorted = [...nums].sort((a, b) => (lowerBetter ? a - b : b - a));
  const band = Math.max(1, Math.round(nums.length * 0.3));
  const bestCut = sorted[band - 1]!;
  const worstCut = sorted[sorted.length - band]!;
  if (bestCut === worstCut) return values.map(() => null);
  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return null;
    const better = (a: number, b: number) => (lowerBetter ? a <= b : a >= b);
    if (better(v, bestCut) && v !== worstCut) return "best";
    if (better(worstCut, v) && v !== bestCut) return "worst";
    return null;
  });
}

const HEAT_CLASS: Record<Exclude<Heat, null>, string> = {
  best: "bg-emerald-50",
  worst: "bg-orange-50",
};

function TopAvailableRoute() {
  const { activeLeagueId } = useActiveLeague();
  return (
    <PlaybookShell section="waiver">
      <TopAvailablePage key={activeLeagueId ?? "none"} />
    </PlaybookShell>
  );
}

function TopAvailablePage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { rosteredIds, loading: rostersLoading } = useLeagueRosters(players);
  const brain = usePlayerBrain();
  const { rankFor: positionalDefenseRank } = usePositionalDefenseRanks();
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const nflState = useNflState();
  const nflWeek = nflState.data?.week ?? null;
  const season = nflState.data?.season ?? null;
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  useEffect(() => {
    if (nflWeek != null) setSelectedWeek(nflWeek);
  }, [nflWeek]);
  const activeWeek = selectedWeek ?? nflWeek ?? 1;

  const [posTab, setPosTab] = useState<PosTab>("ALL");
  const [view, setView] = useState<View>("overview");
  const [statsPeriod, setStatsPeriod] = useState<"season" | number>("season");

  const {
    projectFor,
    statsFor,
    rankFor,
    scoringMap,
    seasonStats,
    loading: projectionsLoading,
  } = useLeagueProjections(activeWeek);
  const weekStats = useSleeperWeekStats(
    season,
    view === "statistics" && statsPeriod !== "season" ? statsPeriod : null,
  );
  const { progressByNflTeam } = useNflGameProgress(activeWeek);

  const schedule = useQuery({
    queryKey: ["wire-schedule-sos", "v2-no-def-proj", currentSeason()],
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => buildScheduleByTeam(await fetchSchedule(currentSeason())),
  });

  const weeklyOf = useMemo(
    () => (p: Player) => projectFor(p.id) ?? weeklyFallback(p),
    [projectFor],
  );
  const posRankFor = useMemo(
    () => (playerId: string): number | null => rankFor(playerId).pos,
    [rankFor],
  );

  /** Only players nobody in the league rosters, on an NFL team. */
  const available = useMemo(
    () => players.filter((p) => p.team && p.team !== "FA" && !rosteredIds.has(p.id)),
    [players, rosteredIds],
  );

  const tables = useMemo(() => {
    const groups = posTab === "ALL" ? GROUPS : GROUPS.filter((g) => g.pos === posTab);
    return groups.map((group) => ({
      ...group,
      players: sortWirePool(
        available.filter((p) => p.pos === group.pos),
        brain,
        weeklyOf,
        posRankFor,
      ).slice(0, posTab === "ALL" ? group.allLimit : SINGLE_POSITION_LIMIT),
    }));
  }, [posTab, available, brain, weeklyOf, posRankFor]);

  const visibleIds = useMemo(
    () => tables.flatMap((t) => t.players.map((p) => p.id)),
    [tables],
  );
  // One CDN fantasy-news snap (not N Fluid getPlayerNews calls per visible row).
  const fantasyNewsQuery = useQuery({
    queryKey: ["fantasy-news-feed", 60],
    queryFn: () => fetchSnapFantasyNews(60),
    staleTime: 15 * 60 * 1000,
    enabled: view === "overview",
    retry: false,
  });
  const { newsById, newsLoadingIds } = useMemo(() => {
    const map = new Map<string, string>();
    const pending = new Set<string>();
    if (fantasyNewsQuery.isLoading) {
      for (const id of visibleIds) pending.add(id);
    }
    for (const item of fantasyNewsQuery.data ?? []) {
      const id = item.player?.id;
      if (!id || map.has(id)) continue;
      const headline = item.headline?.trim();
      if (headline) map.set(id, headline);
    }
    return { newsById: map, newsLoadingIds: pending };
  }, [visibleIds, fantasyNewsQuery.data, fantasyNewsQuery.isLoading]);

  const statLineFor = (id: string): Record<string, number> | null => {
    if (view === "projections") return statsFor(id);
    if (statsPeriod === "season") return seasonStats?.get(id)?.stats ?? null;
    return weekStats.data?.get(id)?.stats ?? null;
  };
  const fanPtsFor = (id: string): number | null => {
    if (view === "projections") return projectFor(id);
    const line = statLineFor(id);
    const pts = line ? scoreStats(line, scoringMap) : null;
    return pts == null ? null : Math.round(pts * 10) / 10;
  };

  const loading =
    playersLoading || rostersLoading || projectionsLoading || nflState.isLoading;
  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1);
  const playedWeeks = Array.from({ length: nflWeek ?? 1 }, (_, i) => i + 1);
  const scheduleWeeks = Array.from(
    { length: SCHEDULE_WEEKS },
    (_, i) => activeWeek + i,
  ).filter((w) => w <= 18);

  return (
    <div className="w-full pb-8">
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="display-title text-3xl text-slate-900">
            Top <span className="text-primary">Available</span>
          </h1>
          <ActiveLeagueLabel />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          The best players nobody has rostered in{" "}
          {activeLeague?.name?.trim() || "your synced league"}, ranked by position rank.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => startTransition(() => setPosTab(tab.id))}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
              posTab === tab.id
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => startTransition(() => setView(item.id))}
              className={cn(
                "px-3 py-2 text-sm font-semibold transition-colors",
                view === item.id
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-blue-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="pb-2">
          {view === "statistics" ? (
            <Select
              value={String(statsPeriod)}
              onValueChange={(value) =>
                startTransition(() =>
                  setStatsPeriod(value === "season" ? "season" : Math.max(1, Number(value) || 1)),
                )
              }
            >
              <SelectTrigger aria-label="Stat period" className="h-9 w-[9rem] border-slate-200 bg-white shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="season">{season ?? currentSeason()} Season</SelectItem>
                {playedWeeks.map((week) => (
                  <SelectItem key={week} value={String(week)}>
                    Week {week}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={String(activeWeek)}
              onValueChange={(value) =>
                startTransition(() => setSelectedWeek(Math.max(1, Number(value) || 1)))
              }
            >
              <SelectTrigger aria-label="Week" className="h-9 w-[9rem] border-slate-200 bg-white shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((week) => (
                  <SelectItem key={week} value={String(week)}>
                    {view === "schedule" ? `From Week ${week}` : `Week ${week}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {tables.map((table) => {
          const groups = STAT_GROUPS[table.pos];
          const cols = groups.flatMap((g) => g.cols.map((c, i) => ({ ...c, groupStart: i === 0 })));
          const statView = view === "projections" || view === "statistics";
          const digits = view === "projections" ? 1 : 0;
          const lines = table.players.map((p) => (statView ? statLineFor(p.id) : null));
          const fanPts = table.players.map((p) => (statView ? fanPtsFor(p.id) : null));
          const fanHeat = heatFor(fanPts);
          const colHeat = cols.map((col) =>
            heatFor(
              lines.map((line) => statValue(line, col)),
              col.lowerBetter,
            ),
          );
          const overview = view === "overview";
          const colSpan = overview
            ? 6
            : view === "schedule"
              ? 2 + scheduleWeeks.length
              : 4 + cols.length;

          return (
            <section key={table.pos}>
              <h2 className="mb-2 text-lg font-bold text-slate-900">{table.title}</h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table
                    className={cn(
                      "w-full min-w-[820px] border-collapse text-sm",
                      overview && "table-fixed",
                    )}
                  >
                    <thead>
                      {statView ? (
                        <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
                          <th colSpan={4} className="px-3 py-2" aria-hidden="true" />
                          {groups.map((g) => (
                            <th key={g.label} colSpan={g.cols.length} className={PLAYER_LIST_GROUP_TH}>
                              {g.label}
                            </th>
                          ))}
                        </tr>
                      ) : null}
                      <tr className={PLAYER_LIST_COL_HEADER_ROW}>
                        <th className="w-14 px-2 py-1.5 text-center">Rk</th>
                        <th className={cn("px-3 py-1.5 text-left", overview && "w-64")}>Player</th>
                        {view === "schedule" ? (
                          scheduleWeeks.map((week) => (
                            <th key={week} className="px-2 py-1.5 text-center">
                              Wk {week}
                            </th>
                          ))
                        ) : (
                          <th className={cn("px-2 py-1.5 text-center", overview ? "w-32" : "w-28")}>Opp</th>
                        )}
                        {overview ? (
                          <>
                            <th className="w-32 px-2 py-1.5 text-center">Matchup</th>
                            <th className="w-32 px-2 py-1.5 text-center">Proj Pts</th>
                            <th className="px-6 py-1.5 text-left">News / Notes</th>
                          </>
                        ) : null}
                        {statView ? (
                          <>
                            <th className="w-20 px-2 py-1.5 text-center">
                              {view === "projections" ? "Proj Pts" : "Fan Pts"}
                            </th>
                            {cols.map((col) => (
                              <th
                                key={col.key}
                                className={cn(
                                  "px-1.5 py-1.5 text-center",
                                  col.groupStart && "border-l border-slate-100",
                                )}
                              >
                                {col.label}
                              </th>
                            ))}
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400">
                            Loading available players…
                          </td>
                        </tr>
                      ) : table.players.length === 0 ? (
                        <tr>
                          <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400">
                            No available players at this position.
                          </td>
                        </tr>
                      ) : (
                        table.players.map((player, index) => {
                          const rank = posRankFor(player.id);
                          const matchup =
                            player.bye != null && player.bye === activeWeek
                              ? { opp: "BYE", stars: null }
                              : weeklyWireMatchup(
                                  player,
                                  brain,
                                  activeWeek,
                                  schedule.data ?? null,
                                  positionalDefenseRank,
                                );
                          const kickoff =
                            matchup.opp === "BYE"
                              ? ""
                              : formatNflKickoffLabel(
                                  progressForNflTeam(player.team, progressByNflTeam)?.kickoffIso,
                                );
                          const news = newsById.get(player.id);
                          const newsLoading = newsLoadingIds.has(player.id);
                          return (
                            <tr key={player.id} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-2 py-2.5 text-center text-sm tabular-nums text-slate-500">
                                {rank != null && rank > 0 ? Math.round(rank) : "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <PlayerCell player={player} onOpen={openPlayer} />
                              </td>
                              {view === "schedule" ? (
                                scheduleWeeks.map((week) => {
                                  const hit =
                                    player.bye === week
                                      ? { opp: "BYE", stars: null }
                                      : weeklyWireMatchup(
                                          player,
                                          brain,
                                          week,
                                          schedule.data ?? null,
                                          positionalDefenseRank,
                                        );
                                  return (
                                    <td key={week} className="px-2 py-2.5 text-center">
                                      <span className="block text-sm font-semibold uppercase text-slate-800">
                                        {hit.opp}
                                      </span>
                                      {hit.opp !== "BYE" ? (
                                        <span className="mt-0.5 flex justify-center">
                                          <SosStars stars={hit.stars} />
                                        </span>
                                      ) : null}
                                    </td>
                                  );
                                })
                              ) : (
                                <td className="px-2 py-2.5 text-center">
                                  <span className="block text-sm font-semibold uppercase text-slate-800">
                                    {matchup.opp}
                                  </span>
                                  {kickoff ? (
                                    <span className="mt-0.5 block text-[10px] font-medium text-slate-400">
                                      {kickoff}
                                    </span>
                                  ) : null}
                                </td>
                              )}
                              {overview ? (
                                <>
                                  <td className="px-2 py-2.5">
                                    <div className="flex justify-center">
                                      <SosStars stars={matchup.opp === "BYE" ? null : matchup.stars} size="md" />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">
                                    {fmt(matchup.opp === "BYE" ? null : projectFor(player.id), 1)}
                                  </td>
                                  <td className="px-6 py-2.5">
                                    {news ? (
                                      <button
                                        type="button"
                                        onClick={() => openPlayer(player.id)}
                                        className="line-clamp-2 text-left text-sm font-semibold text-blue-700 hover:text-blue-600"
                                      >
                                        {news}
                                      </button>
                                    ) : (
                                      <span className="text-xs text-slate-400">
                                        {newsLoading ? "Loading news…" : "No recent news"}
                                      </span>
                                    )}
                                  </td>
                                </>
                              ) : null}
                              {statView ? (
                                <>
                                  <td
                                    className={cn(
                                      "px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900",
                                      fanHeat[index] && HEAT_CLASS[fanHeat[index]!],
                                    )}
                                  >
                                    {fmt(fanPts[index] ?? null, 1)}
                                  </td>
                                  {cols.map((col, c) => {
                                    const heat = colHeat[c]?.[index] ?? null;
                                    return (
                                      <td
                                        key={col.key}
                                        className={cn(
                                          "px-1.5 py-2.5 text-center tabular-nums text-slate-700",
                                          col.groupStart && "border-l border-slate-100",
                                          heat && HEAT_CLASS[heat],
                                        )}
                                      >
                                        {fmt(statValue(lines[index] ?? null, col), digits)}
                                      </td>
                                    );
                                  })}
                                </>
                              ) : null}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function PlayerCell({ player, onOpen }: { player: Player; onOpen: (id: string) => void }) {
  const badge = injuryMicroBadge(resolveInjuryStatus(player));
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  const team = player.team?.trim() || "FA";
  return (
    <button
      type="button"
      onClick={() => onOpen(player.id)}
      className="flex min-w-0 items-center gap-2.5 text-left transition-opacity hover:opacity-85"
    >
      <PlayerAvatar
        id={player.id}
        pos={player.pos}
        team={player.team}
        name={player.name}
        className="size-9 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
        logoClassName="size-3"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-blue-700">{player.name}</span>
          {badge ? (
            <span
              className={cn(
                "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-0.5 text-[9px] font-bold text-white",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
          {player.bye != null && player.bye > 0
            ? `${posLabel} · ${team} · Bye ${player.bye}`
            : `${posLabel} · ${team}`}
        </span>
      </span>
    </button>
  );
}

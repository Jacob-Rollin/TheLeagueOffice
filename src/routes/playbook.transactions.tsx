import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ActivityFeed,
  evaluateTransactionType,
  resolveActivityKind,
  type TradeGradeChip,
} from "@/components/dashboard/ActivityFeed";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { playbookCardClass, playbookPanelTitleClass, resolveAvatarUrl } from "@/components/playbook/panels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import { grade } from "@/lib/evaluate";
import {
  getConnectionTransactionLog,
  type LeagueActivityEvent,
  type LeagueActivityMove,
  type LeagueTransactionLog,
} from "@/lib/league.functions";
import { getPickupResults, getTradeValueBasis } from "@/lib/players.functions";
import { fetchTrendingAddsClient } from "@/lib/sleeper-trending";
import { packageScore } from "@/lib/trade-engine";
import { inSeasonWeeklyValue } from "@/lib/trade-value";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbook/transactions")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Transactions — Playbook" }],
  }),
  component: PlaybookTransactionsPage,
});

/**
 * Mirror of the dashboard ActivityFeed type gate — enforces Sleeper root
 * type codes so IR labels never stick to waiver / free-agent cuts.
 */
function normalizeTransactionEvent(event: LeagueActivityEvent): LeagueActivityEvent {
  const kind = resolveActivityKind(event);
  const evaluated = evaluateTransactionType({
    type:
      kind === "waiver"
        ? "waiver"
        : kind === "free_agent"
          ? "free_agent"
          : kind === "trade"
            ? "trade"
            : kind === "ir"
              ? "ir"
              : event.kind,
    metadata: kind === "ir" ? { to_slot: "IR" } : null,
    adds: Object.fromEntries(
      (event.moves ?? [])
        .filter((m) => m.action === "add")
        .map((m) => [m.playerId, 1]),
    ),
    drops: Object.fromEntries(
      (event.moves ?? [])
        .filter((m) => m.action === "drop" || m.action === "ir")
        .map((m) => [m.playerId, 1]),
    ),
  });

  if (evaluated.isTrade) return { ...event, kind: "trade" };
  if (evaluated.isWaiver) {
    return {
      ...event,
      kind: "waiver",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  if (evaluated.isFreeAgent) {
    return {
      ...event,
      kind: "free_agent",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  if (evaluated.isActualIRMove) return { ...event, kind: "ir" };

  // Fallback: never leave add/drop actions under an IR heading.
  if (kind !== "ir") return { ...event, kind };
  const hasAddOrDrop = (event.moves ?? []).some(
    (m) => m.action === "add" || m.action === "drop",
  );
  if (hasAddOrDrop) {
    return {
      ...event,
      kind: "free_agent",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  return { ...event, kind: "ir" };
}

type KindFilter = "all" | "trade" | "waiver" | "free_agent" | "ir";

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "trade", label: "Trades" },
  { id: "waiver", label: "Waivers" },
  { id: "free_agent", label: "Free Agents" },
  { id: "ir", label: "IR" },
];

type TeamTally = { team: string; trades: number; adds: number; drops: number };

const isCompletedTrade = (e: LeagueActivityEvent) => e.kind === "trade" && !/^TRADE REJECTED/i.test(e.text);

/** Every fantasy team touched by an event (both sides of a trade). */
function eventTeams(e: LeagueActivityEvent): string[] {
  const set = new Set<string>();
  if (e.teamName?.trim()) set.add(e.teamName.trim());
  for (const m of e.moves ?? []) {
    if (m.fantasyTeam?.trim()) set.add(m.fantasyTeam.trim());
    if (m.fromFantasyTeam?.trim()) set.add(m.fromFantasyTeam.trim());
  }
  return [...set];
}

function tallyTeams(events: LeagueActivityEvent[], teams: string[]): TeamTally[] {
  const rows = new Map<string, TeamTally>();
  const row = (team: string) => {
    let r = rows.get(team);
    if (!r) {
      r = { team, trades: 0, adds: 0, drops: 0 };
      rows.set(team, r);
    }
    return r;
  };
  for (const t of teams) row(t);

  for (const e of events) {
    if (e.kind === "trade") {
      if (!isCompletedTrade(e)) continue;
      for (const t of eventTeams(e)) row(t).trades += 1;
      // Releases bundled into a trade still count as drops for that club.
      for (const m of e.moves ?? []) {
        if (m.action === "drop" && m.fantasyTeam?.trim() && !m.fromFantasyTeam) row(m.fantasyTeam.trim()).drops += 1;
      }
      continue;
    }
    if (e.kind !== "waiver" && e.kind !== "free_agent") continue;
    const team = e.teamName?.trim();
    if (!team) continue;
    const r = row(team);
    r.adds += (e.moves ?? []).filter((m) => m.action === "add").length;
    r.drops += (e.moves ?? []).filter((m) => m.action === "drop").length;
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.trades + b.adds + b.drops - (a.trades + a.adds + a.drops) || a.team.localeCompare(b.team),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Kickoff of the season opener: the Thursday after Labor Day, 8:20 PM ET. */
function seasonKickoff(at: number): number {
  const d = new Date(at);
  const year = d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const firstOfSept = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const laborDay = 1 + ((8 - firstOfSept) % 7);
  return Date.UTC(year, 8, laborDay + 4, 0, 20);
}

/**
 * Hosts tag Monday / Tuesday moves with the week just played, so a move made
 * after that week's Sunday slate only counts from the following week.
 */
function isAfterWeekGames(at: number, week: number): boolean {
  const sundayDone = seasonKickoff(at) + (week - 1) * 7 * DAY_MS + 3 * DAY_MS + 4 * 60 * 60 * 1000;
  return at >= sundayDone;
}

type PickupRequest = {
  key: string;
  playerId: string;
  fromWeek: number;
  toWeek: number;
  move: LeagueActivityMove;
  team: string;
};

const pickupKey = (eventId: string, playerId: string) => `${eventId}:${playerId}`;

/** Week range each waiver / free-agent add spent on the claiming team's roster. */
function buildPickupRequests(events: LeagueActivityEvent[], currentWeek: number): PickupRequest[] {
  const chronological = [...events].sort((a, b) => a.at - b.at);
  const requests: PickupRequest[] = [];
  chronological.forEach((e, i) => {
    if ((e.kind !== "waiver" && e.kind !== "free_agent") || !e.week) return;
    const team = e.teamName?.trim();
    if (!team) return;
    for (const m of e.moves ?? []) {
      if (m.action !== "add") continue;
      const fromWeek = isAfterWeekGames(e.at, e.week) ? e.week + 1 : e.week;
      const exit = chronological.slice(i + 1).find((d) =>
        (d.moves ?? []).some(
          (x) =>
            x.playerId === m.playerId &&
            ((x.action === "drop" && (d.teamName?.trim() === team || x.fantasyTeam?.trim() === team)) ||
              (d.kind === "trade" && x.fromFantasyTeam?.trim() === team)),
        ),
      );
      const toWeek = exit?.week ? (isAfterWeekGames(exit.at, exit.week) ? exit.week : exit.week - 1) : currentWeek;
      if (toWeek < fromWeek) continue;
      requests.push({ key: pickupKey(e.id, m.playerId), playerId: m.playerId, fromWeek, toWeek, move: m, team });
    }
  });
  return requests;
}

type TrendingRow = { player_id: string; count: number };

function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function PlayerLine({
  rank,
  id,
  name,
  pos,
  nflTeam,
  detail,
  value,
}: {
  rank: number;
  id: string;
  name: string;
  pos: string;
  nflTeam: string;
  detail: ReactNode;
  value: ReactNode;
}) {
  const upper = pos.toUpperCase();
  return (
    <li className="flex items-center gap-2.5 border-b border-border/60 py-2 last:border-0">
      <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{rank}</span>
      <PlayerAvatar
        id={id}
        pos={(AVATAR_POS.has(upper) ? upper : "WR") as Pos}
        team={nflTeam}
        name={name}
        className="size-8"
        logoClassName="size-3"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {upper} - {nflTeam} · {detail}
        </span>
      </span>
      <span className="shrink-0">{value}</span>
    </li>
  );
}

function PlaybookTransactionsPage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams: rosterTeams } = useLeagueRosters(players);

  const { data, isLoading, error } = useQuery({
    queryKey: ["league-transaction-log", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<LeagueTransactionLog> =>
      await getConnectionTransactionLog({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: activeLeague?.platform ?? "sleeper",
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  const events = useMemo(() => (data?.events ?? []).map(normalizeTransactionEvent), [data]);
  const currentWeek = data?.currentWeek ?? 1;

  const countByWeek = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of events) if (e.week) map.set(e.week, (map.get(e.week) ?? 0) + 1);
    return map;
  }, [events]);

  const weekOptions = useMemo(
    () => Array.from({ length: currentWeek }, (_, i) => currentWeek - i),
    [currentWeek],
  );

  // "all" or a week number as a string; defaults to the latest week with activity.
  const [week, setWeek] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [team, setTeam] = useState<string | null>(null);

  useEffect(() => {
    setWeek(null);
    setTeam(null);
  }, [activeLeague?.id]);

  useEffect(() => {
    if (week !== null || !data) return;
    const latestActive = weekOptions.find((w) => (countByWeek.get(w) ?? 0) > 0);
    setWeek(latestActive ? String(latestActive) : "all");
  }, [data, week, weekOptions, countByWeek]);

  const selectedWeek = week && week !== "all" ? Number(week) : null;
  const weekEvents = useMemo(
    () => (selectedWeek ? events.filter((e) => e.week === selectedWeek) : events),
    [events, selectedWeek],
  );
  const visibleEvents = useMemo(
    () =>
      weekEvents.filter(
        (e) => (kind === "all" || e.kind === kind) && (!team || eventTeams(e).includes(team)),
      ),
    [weekEvents, kind, team],
  );

  const teamNames = useMemo(() => {
    const names = new Set<string>(data?.teams ?? []);
    for (const t of rosterTeams) names.add(t.team);
    return [...names];
  }, [data?.teams, rosterTeams]);
  const tallies = useMemo(() => tallyTeams(weekEvents, teamNames), [weekEvents, teamNames]);
  const totals = useMemo(
    () => ({
      trades: weekEvents.filter(isCompletedTrade).length,
      adds: tallies.reduce((s, t) => s + t.adds, 0),
      drops: tallies.reduce((s, t) => s + t.drops, 0),
    }),
    [weekEvents, tallies],
  );
  const logoByTeam = useMemo(() => new Map(rosterTeams.map((t) => [t.team, t])), [rosterTeams]);

  const pickupRequests = useMemo(() => buildPickupRequests(events, currentWeek), [events, currentWeek]);
  const { data: pickupResults } = useQuery({
    queryKey: [
      "pickup-results",
      activeLeague?.id ?? null,
      pickupRequests.map((r) => `${r.key}|${r.fromWeek}|${r.toWeek}`).join(","),
    ],
    enabled: Boolean(activeLeague?.leagueId) && pickupRequests.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      getPickupResults({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: activeLeague?.platform ?? "sleeper",
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
          requests: pickupRequests.map(({ key, playerId, fromWeek, toWeek }) => ({ key, playerId, fromWeek, toWeek })),
        },
      }),
  });

  const addNote = (event: LeagueActivityEvent, move: LeagueActivityMove) => {
    const r = pickupResults?.[pickupKey(event.id, move.playerId)];
    if (!r) return null;
    if (!r.games) {
      return <span className="text-[11px] text-muted-foreground">No games yet</span>;
    }
    return (
      <span className="block text-right leading-tight" title="League-scored points since this pickup">
        <span className="block font-mono text-xs font-semibold tabular-nums text-emerald-600">
          {r.pts.toFixed(1)} pts
        </span>
        <span className="block text-[10px] text-muted-foreground">
          in {r.games} {r.games === 1 ? "game" : "games"}
        </span>
      </span>
    );
  };

  const { format: valueScoring } = useLeagueScoringMeta();
  const { data: valueBasis } = useQuery({
    queryKey: ["trade-value-basis"],
    queryFn: () => getTradeValueBasis(),
    staleTime: 30 * 60 * 1000,
  });
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const tradeGrades = useMemo(() => {
    if (!valueBasis) return undefined;
    const weekly = (id: string) =>
      inSeasonWeeklyValue(
        valueBasis.players[id],
        valueBasis,
        playerById.get(id)?.proj?.[valueScoring] ?? 0,
        valueScoring,
      ).weekly;
    const out: Record<string, Record<string, TradeGradeChip>> = {};
    for (const e of events) {
      if (!isCompletedTrade(e)) continue;
      const grades: Record<string, TradeGradeChip> = {};
      for (const t of eventTeams(e)) {
        const received = (e.moves ?? []).filter((m) => m.action === "add" && m.fantasyTeam?.trim() === t);
        const sent = (e.moves ?? []).filter((m) => m.action === "add" && m.fromFantasyTeam?.trim() === t);
        if (!received.length && !sent.length) continue;
        const getScore = packageScore(received.map((m) => weekly(m.playerId)), sent.length);
        const giveScore = packageScore(sent.map((m) => weekly(m.playerId)), received.length);
        grades[t] = grade(((getScore - giveScore) / Math.max(getScore, giveScore, 0.01)) * 100);
      }
      out[e.id] = grades;
    }
    return out;
  }, [events, valueBasis, playerById, valueScoring]);

  const [insightTab, setInsightTab] = useState<"trending" | "pickups">("trending");
  const [trendType, setTrendType] = useState<"add" | "drop">("add");
  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ["sleeper-trending-add", "v1", 24, 25, trendType],
    staleTime: 15 * 60 * 1000,
    retry: false,
    refetchIntervalInBackground: false,
    queryFn: () => fetchTrendingAddsClient(24, 25, trendType),
  });
  const ownerByPlayer = useMemo(() => {
    const map = new Map<string, { team: string; isMine: boolean }>();
    for (const t of rosterTeams) for (const p of t.players) map.set(p.id, { team: t.team, isMine: t.isMine });
    return map;
  }, [rosterTeams]);
  const trendingRows = useMemo(
    () => (trending ?? []).filter((r) => playerById.has(r.player_id)).slice(0, 6),
    [trending, playerById],
  );
  const bestPickups = useMemo(
    () =>
      pickupRequests
        .map((r) => ({ ...r, result: pickupResults?.[r.key] }))
        .filter((r) => r.result && r.result.games > 0)
        .sort((a, b) => b.result!.pts - a.result!.pts)
        .slice(0, 6),
    [pickupRequests, pickupResults],
  );

  const scopeLabel = selectedWeek ? `Week ${selectedWeek}` : "Season";
  const loadError = error instanceof Error ? error.message : null;

  return (
    <div>
      <header className="mb-4">
        <h1 className="display-title text-3xl">
          League <span className="text-primary">Activity</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live waiver, free agent, trade, and IR moves from the active host league.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className={cn(playbookCardClass, "min-w-0 lg:col-span-2")}>
          <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setKind(f.id)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    kind === f.id
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Select value={week ?? "all"} onValueChange={(v) => setWeek(v)}>
              <SelectTrigger className="h-9 w-[10rem] shrink-0 border-slate-200 bg-white shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Weeks ({events.length})</SelectItem>
                {weekOptions.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    Week {w} ({countByWeek.get(w) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {team ? (
            <div className="mb-3 flex items-center justify-between rounded-md bg-primary/5 px-3 py-2 text-sm">
              <span className="text-foreground/80">
                Showing moves for <span className="font-semibold text-foreground">{team}</span>
              </span>
              <button
                type="button"
                onClick={() => setTeam(null)}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Show All Teams
              </button>
            </div>
          ) : null}

          <ActivityFeed
            events={visibleEvents}
            players={players}
            loading={isLoading}
            error={loadError}
            emptyMessage={
              selectedWeek ? `No matching transactions in Week ${selectedWeek}.` : "No matching transactions this season."
            }
            className="rounded-none border-0 bg-transparent p-0"
            addNote={addNote}
            {...(tradeGrades ? { tradeGrades } : {})}
          />
        </section>

        <aside className="min-w-0 space-y-4 lg:col-span-1">
          <section className={cn(playbookCardClass, "p-5")}>
            <div className="flex items-baseline justify-between">
              <h2 className={playbookPanelTitleClass}>Team Activity</h2>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">{scopeLabel}</span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {(
                [
                  ["Trades", totals.trades],
                  ["Adds", totals.adds],
                  ["Drops", totals.drops],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-muted/30 px-2 py-2.5 text-center">
                  <p className="font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {isLoading ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading team totals…</p>
            ) : tallies.length ? (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-semibold">Team</th>
                    <th className="w-12 py-2 text-center font-semibold">Trd</th>
                    <th className="w-12 py-2 text-center font-semibold">Add</th>
                    <th className="w-12 py-2 text-center font-semibold">Drp</th>
                  </tr>
                </thead>
                <tbody>
                  {tallies.map((t) => {
                    const roster = logoByTeam.get(t.team);
                    const logo = resolveAvatarUrl(roster?.logo ?? null);
                    const selected = team === t.team;
                    return (
                      <tr
                        key={t.team}
                        onClick={() => setTeam(selected ? null : t.team)}
                        className={cn(
                          "cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50",
                          selected && "bg-primary/5",
                        )}
                      >
                        <td className="max-w-0 py-2 pr-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-white text-[9px] font-bold text-muted-foreground">
                              {logo ? (
                                <img src={logo} alt="" className="size-full object-cover" />
                              ) : (
                                t.team.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase()
                              )}
                            </span>
                            <span
                              className={cn(
                                "truncate",
                                roster?.isMine || selected ? "font-semibold text-primary" : "text-foreground",
                              )}
                              title={t.team}
                            >
                              {t.team}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 text-center font-mono tabular-nums">{t.trades}</td>
                        <td className="py-2 text-center font-mono tabular-nums text-emerald-600">{t.adds}</td>
                        <td className="py-2 text-center font-mono tabular-nums text-red-600">{t.drops}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No team activity yet.</p>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">Select a team to filter the activity feed.</p>
          </section>

          <section className={cn(playbookCardClass, "p-5")}>
            <div className="flex items-baseline justify-between">
              <h2 className={playbookPanelTitleClass}>
                {insightTab === "trending" ? "Trending on Sleeper" : "Best Pickups"}
              </h2>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                {insightTab === "trending" ? "Last 24 Hours" : "Season"}
              </span>
            </div>
            <div className="mt-3 flex gap-1 border-b border-border">
              {(
                [
                  ["trending", "Trending"],
                  ["pickups", "Best Pickups"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setInsightTab(id)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
                    insightTab === id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {insightTab === "trending" ? (
              <>
                <div className="mt-3 flex gap-1">
                  {(
                    [
                      ["add", "Adds"],
                      ["drop", "Drops"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTrendType(id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        trendType === id
                          ? "bg-primary/10 font-semibold text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {trendingLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading trends…</p>
                ) : trendingRows.length ? (
                  <ol className="mt-1">
                    {trendingRows.map((r, i) => {
                      const p = playerById.get(r.player_id)!;
                      const owner = ownerByPlayer.get(r.player_id);
                      return (
                        <PlayerLine
                          key={r.player_id}
                          rank={i + 1}
                          id={p.id}
                          name={p.name}
                          pos={p.pos}
                          nflTeam={p.team}
                          detail={
                            owner ? (
                              <span className={owner.isMine ? "font-semibold text-primary" : undefined}>
                                {owner.isMine ? "On your team" : owner.team}
                              </span>
                            ) : (
                              <Link to="/waiver" className="font-semibold text-emerald-600 hover:underline">
                                Available
                              </Link>
                            )
                          }
                          value={
                            <span
                              className={cn(
                                "font-mono text-sm font-bold tabular-nums",
                                trendType === "add" ? "text-emerald-600" : "text-red-600",
                              )}
                            >
                              {trendType === "add" ? "+" : "-"}
                              {compactCount(r.count)}
                            </span>
                          }
                        />
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Sleeper trends are unavailable right now.</p>
                )}
              </>
            ) : bestPickups.length ? (
              <ol className="mt-1">
                {bestPickups.map((r, i) => {
                  const p = playerById.get(r.playerId);
                  const mine = logoByTeam.get(r.team)?.isMine;
                  return (
                    <PlayerLine
                      key={r.key}
                      rank={i + 1}
                      id={r.playerId}
                      name={p?.name ?? r.move.name}
                      pos={p?.pos ?? r.move.pos}
                      nflTeam={p?.team ?? r.move.team}
                      detail={
                        <span className={mine ? "font-semibold text-primary" : undefined}>
                          {mine ? "Your pickup" : r.team}
                        </span>
                      }
                      value={
                        <span className="block text-right leading-tight">
                          <span className="block font-mono text-sm font-bold tabular-nums text-emerald-600">
                            {r.result!.pts.toFixed(1)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {r.result!.games} {r.result!.games === 1 ? "game" : "games"}
                          </span>
                        </span>
                      }
                    />
                  );
                })}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {pickupRequests.length ? "Calculating pickup production…" : "No waiver or free agent pickups yet."}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

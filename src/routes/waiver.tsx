import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import type { Player, Pos } from "@/lib/draft";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import { currentSeason, fetchSchedule, type ScheduleGame } from "@/lib/players-build";
import { getPlayers } from "@/lib/players.functions";
import { starterRequirements } from "@/lib/power-rankings";
import {
  sosStarsFromRank,
  weeklySosMatchupFor,
  type SosMatchup,
} from "@/lib/sos-presentation";
import {
  suggestWaiverTransactions,
  type FitPlayer,
} from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

type ListPosFilter = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
type TargetsPosFilter = "OVERALL" | ListPosFilter;

const LIST_POS_FILTERS: ListPosFilter[] = ["QB", "RB", "WR", "TE", "K", "DST"];
const TARGETS_POS_FILTERS: TargetsPosFilter[] = [
  "OVERALL",
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DST",
];

const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

function filterPos(filter: TargetsPosFilter): Pos | null {
  if (filter === "OVERALL") return null;
  if (filter === "DST") return "DEF";
  return filter;
}

function formatOppLabel(raw: string | null | undefined, isAway?: boolean | null): string {
  if (!raw) return "—";
  const cleaned = raw.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase();
  if (!cleaned || cleaned === "BYE") return cleaned === "BYE" ? "BYE" : "—";
  if (isAway === true) return `@${cleaned}`;
  if (isAway === false) return `vs ${cleaned}`;
  return cleaned;
}

function buildDefenseRanks(players: Player[]): Map<string, number> {
  const ranks = new Map<string, number>();
  [...players]
    .filter((p) => p.pos === "DEF")
    .sort((a, b) => (b.proj?.half ?? 0) - (a.proj?.half ?? 0))
    .forEach((d, i) => {
      const team = (d.team || "").toUpperCase();
      if (team) ranks.set(team, i + 1);
    });
  return ranks;
}

function buildScheduleByTeam(
  games: ScheduleGame[],
  ranks: Map<string, number>,
): Map<string, { week: number; opp: string; rank: number | null; isAway: boolean }[]> {
  const byTeam = new Map<
    string,
    { week: number; opp: string; rank: number | null; isAway: boolean }[]
  >();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({
        week: g.week,
        opp: away,
        rank: ranks.get(away) ?? null,
        isAway: false,
      });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({
        week: g.week,
        opp: home,
        rank: ranks.get(home) ?? null,
        isAway: true,
      });
      byTeam.set(away, rows);
    }
  }
  return byTeam;
}

/** Current-week opp + matchup strength — same SOS matrix the player popup SOS tab uses. */
function weeklyWireMatchup(
  player: Player,
  brain: BrainMatrix | null,
  week: number | null,
  scheduleByTeam: Map<
    string,
    { week: number; opp: string; rank: number | null; isAway: boolean }[]
  > | null,
): { opp: string; stars: number | null } {
  if (week == null || week <= 0) return { opp: "—", stars: null };

  const brainHit: SosMatchup | null = weeklySosMatchupFor(brain, player.id, week);
  const team = (player.team || "").trim().toUpperCase();
  const schedHit =
    team && scheduleByTeam
      ? scheduleByTeam.get(team)?.find((m) => Number(m.week) === Number(week))
      : undefined;

  // DEF units: try DST-tagged brain rows for the same team when player SOS is empty.
  let defBrainHit: SosMatchup | null = null;
  if (!brainHit && (player.pos === "DEF" || displayPosForSos(player.pos) === "DST") && brain && team) {
    for (const [id, entry] of Object.entries(brain)) {
      if (displayPosForSos(entry.position || "") !== "DST") continue;
      if ((entry.team || "").trim().toUpperCase() !== team) continue;
      defBrainHit = weeklySosMatchupFor(brain, id, week);
      if (defBrainHit) break;
    }
  }

  const hit = brainHit ?? defBrainHit;
  if (hit) {
    const oppRaw = (hit.opp || "").trim();
    if (!oppRaw) {
      return {
        opp: schedHit ? formatOppLabel(schedHit.opp, schedHit.isAway) : "BYE",
        stars: null,
      };
    }
    return {
      opp: formatOppLabel(oppRaw, schedHit?.isAway ?? null),
      stars: sosStarsFromRank(hit.rank),
    };
  }

  if (schedHit) {
    return {
      opp: formatOppLabel(schedHit.opp, schedHit.isAway),
      stars: sosStarsFromRank(
        schedHit.rank ??
          (player.pos === "DEF" || displayPosForSos(player.pos) === "DST" ? 14 : 16),
      ),
    };
  }

  return { opp: "—", stars: null };
}

/** Map DEF → DST so season SOS star lookups resolve against defense spreads. */
function displayPosForSos(pos: string): string {
  return pos === "DEF" ? "DST" : pos;
}

function seasonSosRank(player: Player, brain: BrainMatrix | null): number | null {
  const entry = brain?.[player.id];
  if (entry?.sos?.rank != null && Number.isFinite(entry.sos.rank)) return entry.sos.rank;
  const ranks = (entry?.sos?.matchups ?? [])
    .map((m) => m.rank)
    .filter((r): r is number => r != null && Number.isFinite(r));
  if (ranks.length) return Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length);
  return null;
}

function seasonSosStars(player: Player, brain: BrainMatrix | null): number | null {
  const displayPos = displayPosForSos(player.pos);
  let rank = seasonSosRank(player, brain);

  // Defense spreads often live under DST-tagged brain rows — fall back by team.
  if (rank == null && displayPos === "DST" && brain) {
    const team = (player.team || "").trim().toUpperCase();
    if (team) {
      for (const entry of Object.values(brain)) {
        const entryPos = displayPosForSos(entry.position || "");
        if (entryPos !== "DST") continue;
        if ((entry.team || "").trim().toUpperCase() !== team) continue;
        if (entry.sos?.rank != null && Number.isFinite(entry.sos.rank)) {
          rank = entry.sos.rank;
          break;
        }
        const ranks = (entry.sos?.matchups ?? [])
          .map((m) => m.rank)
          .filter((r): r is number => r != null && Number.isFinite(r));
        if (ranks.length) {
          rank = Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length);
          break;
        }
      }
    }
  }

  // Guarantee defense cards light amber stars when SOS matrix rows are sparse.
  if (rank == null) {
    rank = player.pos === "DEF" || displayPos === "DST" ? 14 : 16;
  }

  return typeof sosStarsFromRank === "function"
    ? sosStarsFromRank(rank)
    : 3;
}

function InjuryStatusBadge({ injury }: { injury: string | null | undefined }) {
  if (!injury) return null;
  const token = injury.trim();
  if (!token || token === "Healthy" || token === "Active" || token === "None") return null;

  if (token === "Q" || token === "Questionable") {
    return (
      <span className="flex shrink-0 select-none items-center justify-center rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black leading-none text-white uppercase tracking-wider">
        Q
      </span>
    );
  }
  if (token === "O" || token === "Out" || token === "Doubtful") {
    return (
      <span className="flex shrink-0 select-none items-center justify-center rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black leading-none text-white uppercase tracking-wider">
        O
      </span>
    );
  }
  if (token === "IR" || token === "Injured Reserve") {
    return (
      <span className="flex shrink-0 select-none items-center justify-center rounded bg-red-700 px-1 py-0.5 text-[8px] font-black leading-none text-white uppercase tracking-wider">
        IR
      </span>
    );
  }
  return null;
}

function sortWirePool(
  pool: Player[],
  brain: BrainMatrix | null,
  weeklyOf: (p: Player) => number,
): Player[] {
  return [...pool].sort((a, b) => {
    const aRank = Number(a.posRank);
    const bRank = Number(b.posRank);
    const aHas = Number.isFinite(aRank) && aRank > 0 && aRank < 999;
    const bHas = Number.isFinite(bRank) && bRank > 0 && bRank < 999;
    if (aHas && bHas && aRank !== bRank) return aRank - bRank;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const aVal = Number(brain?.[a.id]?.value ?? 0);
    const bVal = Number(brain?.[b.id]?.value ?? 0);
    if (aVal !== bVal) return bVal - aVal;
    return weeklyOf(b) - weeklyOf(a);
  });
}

function SosStars({
  stars,
  size = "sm",
}: {
  stars: number | null;
  size?: "sm" | "md";
}) {
  const filled =
    stars != null && Number.isFinite(stars)
      ? Math.max(0, Math.min(5, Math.round(stars)))
      : 0;
  return (
    <span
      className="inline-flex shrink-0 items-center"
      aria-label={`${filled} of 5 season matchup stars`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={`sos-star-${i}`}
          className={cn(
            "leading-none",
            size === "md" ? "text-[13px]" : "text-[10px]",
            i > 0 ? "ml-0.5" : undefined,
            i < filled ? "font-bold text-amber-500" : "text-slate-200",
          )}
        >
          {"\u2605"}
        </span>
      ))}
    </span>
  );
}

function PosFilterToolbar<T extends string>({
  filters,
  active,
  onChange,
}: {
  filters: readonly T[];
  active: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 select-none">
      {filters.map((filter) => {
        const isActive = active === filter;
        return (
          <button
            key={filter}
            type="button"
            onClick={() => onChange(filter)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-xs font-black uppercase tracking-wide transition-colors",
              isActive
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-500 border border-slate-200 hover:text-slate-800 hover:border-slate-300",
            )}
          >
            {filter}
          </button>
        );
      })}
    </div>
  );
}

export const Route = createFileRoute("/waiver")({
  head: () => ({
    meta: [
      { title: "The Wire — The League Office" },
      {
        name: "description",
        content:
          "FantasyPros-style waiver wire rankings, top targets, SOS season ratings, and roster upgrade suggestions.",
      },
      { property: "og:title", content: "The Wire — The League Office" },
      {
        property: "og:description",
        content: "Ranked waiver targets, owned-player highlighting, and upgrade suggestions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: WaiverRoute,
});

function WaiverRoute() {
  const { activeLeagueId } = useActiveLeague();
  return (
    <PlaybookShell>
      <WaiverIntelligencePage key={activeLeagueId ?? "none"} />
    </PlaybookShell>
  );
}

function WaiverIntelligencePage() {
  const { data } = useSuspenseQuery(playersQuery);
  const players = data.players;
  const league = useLeagueRosters(players);
  const brain = usePlayerBrain();
  const { projectFor } = useLeagueProjections();
  const { user, ready: authReady } = useAuth();
  const { activeLeague } = useActiveLeague();
  const navigate = useNavigate();
  const [listPosFilter, setListPosFilter] = useState<ListPosFilter>("RB");
  const [targetsPosFilter, setTargetsPosFilter] =
    useState<TargetsPosFilter>("OVERALL");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const hasSyncedLeague = Boolean(activeLeague?.id);
  const showLockGate = authReady && (!user || !hasSyncedLeague);

  const handleSignInRoute = () => setAuthOpen(true);
  const handleLeagueSyncRoute = () => {
    void navigate({ to: "/leaguesync" });
  };

  const rosteredIds = league?.rosteredIds ?? new Set<string>();
  const myOwnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of league?.myTeam?.players ?? []) ids.add(p.id);
    return ids;
  }, [league?.myTeam?.players]);

  const weeklyOf = useMemo(
    () => (p: Player) => projectFor(p.id) ?? weeklyFallback(p),
    [projectFor],
  );

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
        headers: { accept: "application/json" },
      }).catch(() => null);
      const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      return Math.max(1, Number(json?.["week"] ?? 1) || 1);
    },
  });
  const currentWeek = nflWeek.data ?? null;

  const scheduleByTeam = useQuery({
    queryKey: ["wire-schedule-sos", currentSeason(), players.length],
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
    enabled: players.length > 0,
    queryFn: async () => {
      const games = await fetchSchedule(currentSeason());
      const ranks = buildDefenseRanks(players);
      return buildScheduleByTeam(games, ranks);
    },
  });

  /**
   * Wire-eligible pool: true free agents, plus the current user's own roster
   * so owned players can still appear with the blue highlight tint.
   * Players rostered by other managers are excluded.
   */
  const wireEligible = useMemo(() => {
    return players.filter((p) => {
      if (!p.team || p.team === "FA") return false;
      if (myOwnedIds.has(p.id)) return true;
      if (rosteredIds.has(p.id)) return false;
      return true;
    });
  }, [players, rosteredIds, myOwnedIds]);

  const tableRows = useMemo(() => {
    const pos = filterPos(listPosFilter);
    const pool = wireEligible.filter((p) => !pos || p.pos === pos);
    return sortWirePool(pool, brain, weeklyOf).slice(0, 8);
  }, [wireEligible, listPosFilter, brain, weeklyOf]);

  const topTargets = useMemo(() => {
    const pos = filterPos(targetsPosFilter);
    const pool = wireEligible.filter(
      (p) => !myOwnedIds.has(p.id) && (!pos || p.pos === pos),
    );
    return sortWirePool(pool, brain, weeklyOf).slice(0, 4);
  }, [wireEligible, targetsPosFilter, myOwnedIds, brain, weeklyOf]);

  const suggestions = useMemo(() => {
    const myTeam = league?.myTeam;
    if (!myTeam || !league?.synced) return [] as { add: Player; drop: Player }[];

    const toFit = (p: Player): FitPlayer => ({
      id: p.id,
      pos: p.pos,
      weekly: weeklyOf(p),
    });

    const freeAgents = players
      .filter((p) => !rosteredIds.has(p.id) && p.team && p.team !== "FA")
      .map((p) => ({
        ...toFit(p),
        name: p.name,
        team: p.team,
        injury_status: p.injury || null,
        injuryStatus: p.injury || null,
      }))
      .sort((a, b) => b.weekly - a.weekly)
      .slice(0, 160);

    const marketById: Record<string, { value?: number; trend?: number }> = {};
    for (const p of players) {
      const hit = brain?.[p.id];
      if (!hit) continue;
      marketById[p.id] = {
        value: hit.value ?? undefined,
        trend: hit.trend ?? undefined,
      };
    }

    const engine = suggestWaiverTransactions({
      roster: myTeam.players.map(toFit),
      bench: (myTeam.bench ?? []).map(toFit),
      freeAgents,
      starters: starterRequirements(league.rosterPositions ?? []),
      limit: 3,
      marketById,
    });

    return engine
      .map((row) => {
        const add = players.find((p) => p.id === row.add.id) ?? null;
        const drop =
          myTeam.players.find((p) => p.id === row.drop.id) ??
          players.find((p) => p.id === row.drop.id) ??
          null;
        if (!add || !drop) return null;
        return { add, drop };
      })
      .filter((row): row is { add: Player; drop: Player } => Boolean(row));
  }, [league, players, rosteredIds, brain, weeklyOf]);

  const locked = !authReady || !user || !activeLeague?.id;

  return (
    <div className="w-full pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="display-title text-3xl uppercase tracking-wide">THE WIRE</h1>
        <ActiveLeagueLabel />
      </div>

      {showLockGate ? (
        <div className="my-6 flex min-h-[260px] w-full select-none items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="flex max-w-md flex-col items-center justify-center text-center">
            <div
              className={cn(
                "mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
                !user ? "bg-blue-600" : "bg-amber-500",
              )}
            >
              {!user ? (
                <svg
                  className="size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              ) : (
                <svg
                  className="size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              )}
            </div>

            <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-900">
              {!user ? "Authentication Required" : "League Synchronization Required"}
            </h3>
            <p className="mb-5 max-w-sm text-xs font-bold leading-relaxed text-slate-400">
              {!user
                ? "Please sign in to unlock analytical wire insights, free-agent leaderboard trackers, and live matchup grids."
                : "Connect your active Sleeper or ESPN fantasy football league account profile to sync active waivers data rows."}
            </p>

            {!user ? (
              <button
                type="button"
                onClick={handleSignInRoute}
                className="flex cursor-pointer select-none flex-row items-center justify-center space-x-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-md transition-all hover:bg-blue-700 focus:outline-none"
              >
                <span>Sign In to Unlock Sync</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLeagueSyncRoute}
                className="flex cursor-pointer select-none flex-row items-center justify-center space-x-2 rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-md transition-all hover:bg-amber-600 focus:outline-none"
              >
                <span>Connect Your League</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
      {/* Master free-agent ranks table */}
      <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="mb-4 mt-2 flex w-full select-none flex-row items-center justify-between px-1">
          <div className="flex items-center space-x-2">
            {LIST_POS_FILTERS.map((pos) => {
              const isActive = listPosFilter === pos;
              return (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setListPosFilter(pos)}
                  className={
                    isActive
                      ? "cursor-pointer select-none rounded-lg bg-blue-600 px-4 py-1 text-xs font-black uppercase tracking-wide text-white shadow-sm"
                      : "cursor-pointer select-none rounded-lg border border-slate-200/60 bg-white px-4 py-1 text-xs font-bold uppercase tracking-wide text-slate-400 shadow-sm transition-colors hover:bg-slate-50"
                  }
                >
                  {pos}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center space-x-4 text-[11px] font-black uppercase tracking-wider">
            <div className="flex items-center space-x-1.5">
              <div
                className="h-3 w-3 rounded border border-emerald-200 bg-emerald-50"
                aria-hidden="true"
              />
              <span className="text-slate-500">Available</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div
                className="h-3 w-3 rounded border border-blue-200 bg-blue-50"
                aria-hidden="true"
              />
              <span className="text-slate-500">Rostered</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 select-none">
          <div className="flex min-w-0 flex-1 items-center">
            <span className="w-8 text-left">RK</span>
            <span className="pl-6">Player</span>
          </div>
          <div className="flex items-center space-x-12 pr-2">
            <span className="w-16 text-left">Opp</span>
            <span className="w-24 text-center">Matchup</span>
            <span className="w-12 text-right">Proj</span>
          </div>
        </div>

        <div className="space-y-0">
          {tableRows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              {locked
                ? "Connect a league to load available free agents."
                : "No available free agents match this position filter."}
            </p>
          ) : (
            tableRows.map((player) => {
              const isRostered = myOwnedIds.has(player.id);
              const proj = weeklyOf(player);
              const rankRaw = Number(player.posRank);
              const rankLabel =
                Number.isFinite(rankRaw) && rankRaw > 0 && rankRaw < 999
                  ? Math.round(rankRaw)
                  : "—";
              const wireMatchup = weeklyWireMatchup(
                player,
                brain,
                currentWeek,
                scheduleByTeam.data ?? null,
              );
              return (
                <div
                  key={player.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPlayerId(player.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedPlayerId(player.id);
                    }
                  }}
                  className={cn(
                    "relative mb-2 flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-100 p-3.5 text-left shadow-sm transition-all",
                    isRostered
                      ? "border-l-4 border-l-blue-500 bg-blue-50/20 pl-3 hover:bg-blue-100/30"
                      : "border-l-4 border-l-emerald-500 bg-emerald-50/20 pl-3 hover:bg-emerald-100/30",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center space-x-4">
                    <div className="flex w-8 justify-start">
                      <span className="flex h-5 w-5 select-none items-center justify-center rounded-full border border-slate-200/60 bg-slate-50 font-mono text-[10px] font-black text-slate-500 shadow-sm">
                        {rankLabel}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center space-x-3.5">
                      <PlayerAvatar
                        id={player.id}
                        pos={player.pos}
                        team={player.team}
                        name={player.name}
                        className="size-9"
                        logoClassName="size-4"
                      />
                      <div className="flex min-w-0 flex-col text-left">
                        <span className="mb-1 truncate text-sm font-black leading-none text-slate-900">
                          {player.name}
                        </span>
                        <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          <span>{player.team || "FA"}</span>
                          <InjuryStatusBadge injury={player.injury} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 select-none items-center space-x-12 pr-2">
                    <span className="w-16 text-left font-mono text-sm font-black uppercase text-slate-700">
                      {wireMatchup.opp || "BYE"}
                    </span>

                    <div className="flex w-24 items-center justify-center">
                      <SosStars stars={wireMatchup.stars} size="md" />
                    </div>

                    <span className="w-12 text-right font-mono text-sm font-black tabular-nums text-slate-900">
                      {proj.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Top Waiver Targets — below main list, with OVERALL + position filters */}
      <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">
          Top Waiver Targets
        </h2>
        <div className="mt-3">
          <PosFilterToolbar
            filters={TARGETS_POS_FILTERS}
            active={targetsPosFilter}
            onChange={setTargetsPosFilter}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {topTargets.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">
              {locked
                ? "Connect a league to surface live free-agent targets."
                : "No free-agent targets available for this filter."}
            </p>
          ) : (
            topTargets.map((player) => {
              const stars = seasonSosStars(player, brain);
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setSelectedPlayerId(player.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3 text-left transition-colors hover:bg-slate-50"
                >
                  <PlayerAvatar
                    id={player.id}
                    pos={player.pos}
                    team={player.team}
                    name={player.name}
                    className="size-12"
                    logoClassName="size-5"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="mb-1 block truncate text-xs font-black leading-none text-slate-900">
                      {player.name}
                    </span>
                    <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <span>{player.team || "FA"}</span>
                      <InjuryStatusBadge injury={player.injury} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        SOS Season
                      </span>
                      <SosStars stars={stars} />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Waiver Suggestions */}
      <section className="mt-6">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">
          Waiver Suggestions
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {suggestions.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-slate-100 bg-white p-6 text-sm text-muted-foreground shadow-sm">
              {locked
                ? "Sign in and sync a league to unlock upgrade suggestions."
                : "No high-confidence waiver upgrades detected for your bench right now."}
            </div>
          ) : (
            suggestions.map(({ add, drop }) => (
              <div
                key={`${add.id}-${drop.id}`}
                className="flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 opacity-45">
                    <button
                      type="button"
                      onClick={() => setSelectedPlayerId(drop.id)}
                      className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                      aria-label={`Open ${drop.name}`}
                    >
                      <PlayerAvatar
                        id={drop.id}
                        pos={drop.pos}
                        team={drop.team}
                        name={drop.name}
                        className="size-14 grayscale"
                        logoClassName="size-5"
                      />
                    </button>
                    <span className="w-full truncate text-center text-[11px] font-bold text-slate-500">
                      {drop.name}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Drop
                    </span>
                  </div>

                  <div className="shrink-0 text-xs font-black uppercase tracking-widest text-slate-300">
                    to
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedPlayerId(add.id)}
                      className="rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                      aria-label={`Open ${add.name}`}
                    >
                      <PlayerAvatar
                        id={add.id}
                        pos={add.pos}
                        team={add.team}
                        name={add.name}
                        className="size-14"
                        logoClassName="size-5"
                      />
                    </button>
                    <span className="w-full truncate text-center text-[11px] font-black text-slate-900">
                      {add.name}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">
                      Add
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-center text-[11px] font-medium text-slate-500">
                  Upgrade {drop.pos} depth with {add.name}
                  {Number.isFinite(weeklyOf(add))
                    ? ` (${weeklyOf(add).toFixed(1)} proj)`
                    : ""}
                  .
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <PlayerModal
        id={selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
        onSelectPlayer={setSelectedPlayerId}
      />
        </>
      )}

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </div>
  );
}

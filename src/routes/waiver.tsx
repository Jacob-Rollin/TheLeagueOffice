import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import { SosStars } from "@/components/sos/SosStars";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
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
import { PROJECTION_OWNERSHIP_META } from "@/components/research/ProjectionListRow";
import { PLAYER_LIST_HEADER_ROW } from "@/components/research/SortHeader";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
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

/** NFL schedule opponents only — ranks come from positional FPA, never DEF projections. */
function buildScheduleByTeam(
  games: ScheduleGame[],
): Map<string, { week: number; opp: string; isAway: boolean }[]> {
  const byTeam = new Map<string, { week: number; opp: string; isAway: boolean }[]>();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({ week: g.week, opp: away, isAway: false });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({ week: g.week, opp: home, isAway: true });
      byTeam.set(away, rows);
    }
  }
  return byTeam;
}

/** Canonical SOS position key (warehouse / FPA board use DEF, not DST). */
function sosPosKey(pos: string | null | undefined): string {
  const p = (pos || "").toUpperCase();
  return p === "DST" ? "DEF" : p;
}

/**
 * Current-week opp + matchup strength — same positional FPA path as Matchup / My Team.
 * Never invents ranks; never uses DEF projection ladders.
 */
function weeklyWireMatchup(
  player: Player,
  brain: BrainMatrix | null,
  week: number | null,
  scheduleByTeam: Map<string, { week: number; opp: string; isAway: boolean }[]> | null,
  positionalRankFor: (pos: string | null | undefined, opp: string | null | undefined) => number | null,
): { opp: string; stars: number | null } {
  if (week == null || week <= 0) return { opp: "—", stars: null };

  const brainHit: SosMatchup | null = weeklySosMatchupFor(brain, player.id, week);
  const team = (player.team || "").trim().toUpperCase();
  const schedHit =
    team && scheduleByTeam
      ? scheduleByTeam.get(team)?.find((m) => Number(m.week) === Number(week))
      : undefined;

  // DEF units: brain rows are tagged DEF — find any same-team DEF SOS week row.
  let defBrainHit: SosMatchup | null = null;
  if (!brainHit && sosPosKey(player.pos) === "DEF" && brain && team) {
    for (const [id, entry] of Object.entries(brain)) {
      if (sosPosKey(entry.position) !== "DEF") continue;
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
    const rank =
      hit.rank != null && Number.isFinite(Number(hit.rank))
        ? Number(hit.rank)
        : positionalRankFor(player.pos, oppRaw);
    return {
      opp: formatOppLabel(oppRaw, schedHit?.isAway ?? null),
      stars: sosStarsFromRank(rank),
    };
  }

  if (schedHit) {
    const rank = positionalRankFor(player.pos, schedHit.opp);
    return {
      opp: formatOppLabel(schedHit.opp, schedHit.isAway),
      stars: sosStarsFromRank(rank),
    };
  }

  return { opp: "—", stars: null };
}

function seasonSosRank(
  player: Player,
  brain: BrainMatrix | null,
  scheduleByTeam: Map<string, { week: number; opp: string; isAway: boolean }[]> | null,
  positionalRankFor: (
    pos: string | null | undefined,
    opp: string | null | undefined,
  ) => number | null,
): number | null {
  const collectRanks = (sos: NonNullable<BrainMatrix[string]["sos"]> | null | undefined) =>
    (sos?.matchups ?? [])
      .map((m) => m.rank)
      .filter((r): r is number => r != null && Number.isFinite(r) && r > 0);

  const entry = brain?.[player.id];
  let ranks = collectRanks(entry?.sos);
  if (entry?.sos?.rank != null && Number.isFinite(entry.sos.rank) && entry.sos.rank > 0) {
    // Prefer full weekly series when present; otherwise use season avg stamp.
    if (!ranks.length) ranks = [entry.sos.rank];
  }

  // DEF units: warehouse SOS is keyed DEF — fall back to any same-team DEF row.
  if (!ranks.length && sosPosKey(player.pos) === "DEF" && brain) {
    const team = (player.team || "").trim().toUpperCase();
    if (team) {
      for (const peer of Object.values(brain)) {
        if (sosPosKey(peer.position) !== "DEF") continue;
        if ((peer.team || "").trim().toUpperCase() !== team) continue;
        ranks = collectRanks(peer.sos);
        if (peer.sos?.rank != null && Number.isFinite(peer.sos.rank) && peer.sos.rank > 0 && !ranks.length) {
          ranks = [peer.sos.rank];
        }
        if (ranks.length) break;
      }
    }
  }

  // Schedule × positional FPA fallback (same board as Matchup / My Team).
  if (!ranks.length && scheduleByTeam) {
    const team = (player.team || "").trim().toUpperCase();
    const weeks = team ? scheduleByTeam.get(team) ?? [] : [];
    for (const week of weeks) {
      const r = positionalRankFor(player.pos, week.opp);
      if (r != null && Number.isFinite(r) && r > 0) ranks.push(r);
    }
  }

  if (!ranks.length) return null;
  return ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
}

/**
 * Season SOS stars = average weekly positional SOS rank → 1–5 stars.
 * Uses the same FPA-vs-position ladder as the player SOS tab (never invents ranks).
 */
function seasonSosStars(
  player: Player,
  brain: BrainMatrix | null,
  scheduleByTeam: Map<string, { week: number; opp: string; isAway: boolean }[]> | null,
  positionalRankFor: (
    pos: string | null | undefined,
    opp: string | null | undefined,
  ) => number | null,
): number | null {
  const avgRank = seasonSosRank(player, brain, scheduleByTeam, positionalRankFor);
  return sosStarsFromRank(avgRank);
}

function wirePlayerMetaLine(player: Player): string {
  const posLabel = player.pos === "DEF" ? "DST" : player.pos;
  const team = player.team?.trim() || "FA";
  return player.bye != null && player.bye > 0
    ? `${posLabel} · ${team} · Bye ${player.bye}`
    : `${posLabel} · ${team}`;
}

function sortWirePool(
  pool: Player[],
  brain: BrainMatrix | null,
  weeklyOf: (p: Player) => number,
  posRankFor: (playerId: string) => number | null,
): Player[] {
  return [...pool].sort((a, b) => {
    const aRank = posRankFor(a.id);
    const bRank = posRankFor(b.id);
    const aHas = aRank != null && Number.isFinite(aRank) && aRank > 0;
    const bHas = bRank != null && Number.isFinite(bRank) && bRank > 0;
    if (aHas && bHas && aRank !== bRank) return aRank! - bRank!;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const aVal = Number(brain?.[a.id]?.value ?? 0);
    const bVal = Number(brain?.[b.id]?.value ?? 0);
    if (aVal !== bVal) return bVal - aVal;
    return weeklyOf(b) - weeklyOf(a);
  });
}

/** Skill-first weekly advantage score for OVERALL top targets. */
function wireAdvantageScore(
  player: Player,
  brain: BrainMatrix | null,
  weeklyOf: (p: Player) => number,
): number {
  const weekly = Math.max(0, weeklyOf(player));
  const value = Math.max(0, Number(brain?.[player.id]?.value ?? 0));
  const trend = Number(brain?.[player.id]?.trend ?? 0);
  const pos = sosPosKey(player.pos);
  // Keep K/DEF available but don't let them crowd out skill advantages on OVERALL.
  const posWeight = pos === "K" || pos === "DEF" ? 0.45 : 1;
  return (weekly * 12 + value * 0.35 + Math.max(0, trend) * 0.15) * posWeight;
}

/**
 * OVERALL top targets: highest weekly/value advantages, diversified so the
 * board isn't four kickers/defenses when skill free agents are available.
 */
function pickOverallTopTargets(
  pool: Player[],
  brain: BrainMatrix | null,
  weeklyOf: (p: Player) => number,
  limit = 4,
): Player[] {
  const ranked = [...pool].sort(
    (a, b) =>
      wireAdvantageScore(b, brain, weeklyOf) - wireAdvantageScore(a, brain, weeklyOf) ||
      a.name.localeCompare(b.name),
  );

  const out: Player[] = [];
  const seenPos = new Set<string>();
  const skillPass = ranked.filter((p) => {
    const pos = sosPosKey(p.pos);
    return pos !== "K" && pos !== "DEF";
  });

  // Pass 1 — best unique skill positions (RB/WR/TE/QB…).
  for (const p of skillPass) {
    if (out.length >= limit) break;
    const pos = sosPosKey(p.pos);
    if (seenPos.has(pos)) continue;
    out.push(p);
    seenPos.add(pos);
  }

  // Pass 2 — fill remaining slots with next-best advantages (any position).
  for (const p of ranked) {
    if (out.length >= limit) break;
    if (out.some((x) => x.id === p.id)) continue;
    out.push(p);
  }

  return out;
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
  const { projectFor, rankFor: sleeperRankFor } = useLeagueProjections();
  const { rankFor: positionalDefenseRank } = usePositionalDefenseRanks();
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

  /** Sleeper YTD fantasy-points pos rank — same source as the player header. */
  const posRankFor = useMemo(
    () => (playerId: string): number | null => sleeperRankFor(playerId).pos,
    [sleeperRankFor],
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
    queryKey: ["wire-schedule-sos", "v2-no-def-proj", currentSeason()],
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const games = await fetchSchedule(currentSeason());
      return buildScheduleByTeam(games);
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
    return sortWirePool(pool, brain, weeklyOf, posRankFor).slice(0, 10);
  }, [wireEligible, listPosFilter, brain, weeklyOf, posRankFor]);

  const topTargets = useMemo(() => {
    const pos = filterPos(targetsPosFilter);
    const pool = wireEligible.filter(
      (p) => !myOwnedIds.has(p.id) && (!pos || p.pos === pos),
    );
    if (targetsPosFilter === "OVERALL") {
      return pickOverallTopTargets(pool, brain, weeklyOf, 4);
    }
    return sortWirePool(pool, brain, weeklyOf, posRankFor).slice(0, 4);
  }, [
    wireEligible,
    targetsPosFilter,
    myOwnedIds,
    brain,
    weeklyOf,
    posRankFor,
  ]);

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
        <h1 className="display-title text-3xl">
          THE <span className="text-primary">WIRE</span>
        </h1>
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
      <section className="mt-4">
        <div className="mb-3 flex w-full select-none flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {LIST_POS_FILTERS.map((pos) => {
              const isActive = listPosFilter === pos;
              return (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setListPosFilter(pos)}
                  className={
                    isActive
                      ? "cursor-pointer select-none rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white"
                      : "cursor-pointer select-none rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50"
                  }
                >
                  {pos}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-3 w-3 rounded border",
                  PROJECTION_OWNERSHIP_META.available.swatch,
                )}
                aria-hidden="true"
              />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-3 w-3 rounded border",
                  PROJECTION_OWNERSHIP_META.roster.swatch,
                )}
                aria-hidden="true"
              />
              <span>Rostered</span>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className={PLAYER_LIST_HEADER_ROW}>
                  <th className="w-10 px-2 py-1.5 text-center">Rk</th>
                  <th className="px-3 py-1.5 text-left">Player</th>
                  <th className="w-20 px-2 py-1.5 text-left">Opp</th>
                  <th className="w-28 px-2 py-1.5 text-center">Matchup</th>
                  <th className="w-20 px-2 py-1.5 text-right">Proj</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      {locked
                        ? "Connect a league to load available free agents."
                        : "No available free agents match this position filter."}
                    </td>
                  </tr>
                ) : (
                  tableRows.map((player) => {
                    const isRostered = myOwnedIds.has(player.id);
                    const ownership = isRostered ? "roster" : "available";
                    const rowTone = PROJECTION_OWNERSHIP_META[ownership].row;
                    const proj = weeklyOf(player);
                    const sleeperPos = posRankFor(player.id);
                    const rankLabel =
                      sleeperPos != null && Number.isFinite(sleeperPos) && sleeperPos > 0
                        ? Math.round(sleeperPos)
                        : "—";
                    const wireMatchup = weeklyWireMatchup(
                      player,
                      brain,
                      currentWeek,
                      scheduleByTeam.data ?? null,
                      positionalDefenseRank,
                    );
                    const badge = injuryMicroBadge(
                      resolveInjuryStatus(player, brain),
                    );
                    return (
                      <tr
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
                          "cursor-pointer border-b border-slate-100 transition-opacity hover:opacity-90",
                          rowTone,
                        )}
                      >
                        <td className="w-10 px-2 py-2.5 text-center text-sm tabular-nums text-slate-500">
                          {rankLabel}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
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
                                <span className="truncate font-semibold text-blue-700">
                                  {player.name}
                                </span>
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
                                {wirePlayerMetaLine(player)}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-left text-sm font-semibold uppercase tabular-nums text-slate-800">
                          {wireMatchup.opp || "BYE"}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-center">
                            <SosStars stars={wireMatchup.stars} size="md" />
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                          {proj.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Top Waiver Targets — below main list, with OVERALL + position filters */}
      <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
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
              const stars = seasonSosStars(
                player,
                brain,
                scheduleByTeam.data ?? null,
                positionalDefenseRank,
              );
              const badge = injuryMicroBadge(resolveInjuryStatus(player, brain));
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
                    className="size-12 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
                    logoClassName="size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-blue-700">
                        {player.name}
                      </span>
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
                      {wirePlayerMetaLine(player)}
                    </span>
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
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
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

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos } from "@/lib/draft";
import { scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/weekly-projections")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Weekly Projections — The League Office" },
      {
        name: "description",
        content:
          "Week-by-week fantasy projections ranked high to low, filtered by roster, taken, and available players in your synced league.",
      },
    ],
  }),
  component: WeeklyProjectionsRoute,
});

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type Ownership = "roster" | "taken" | "available";

const POS_FILTERS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const FLEX_OK = new Set<Pos>(["RB", "WR", "TE"]);
const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

const OWNERSHIP_META: Record<
  Ownership,
  { label: string; swatch: string; row: string; chip: string }
> = {
  roster: {
    label: "Roster",
    swatch: "bg-sky-100 border-sky-300",
    row: "bg-sky-50/90",
    chip: "bg-sky-100 text-sky-800",
  },
  taken: {
    label: "Taken",
    swatch: "bg-white border-slate-300",
    row: "bg-white",
    chip: "bg-slate-100 text-slate-600",
  },
  available: {
    label: "Available",
    swatch: "bg-emerald-100 border-emerald-300",
    row: "bg-emerald-50/80",
    chip: "bg-emerald-100 text-emerald-800",
  },
};

function WeeklyProjectionsRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <WeeklyProjectionsPage key={activeLeagueId ?? "none"} />;
}

function WeeklyProjectionsPage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, myTeam, rosteredIds, loading: rostersLoading } = useLeagueRosters(players);
  const brain = usePlayerBrain();
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

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

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  useEffect(() => {
    if (nflWeek.data != null) setSelectedWeek(nflWeek.data);
  }, [nflWeek.data, activeLeague?.id]);

  const activeWeek = selectedWeek ?? nflWeek.data ?? 1;
  const { projectFor, loading: projectionsLoading } = useLeagueProjections(activeWeek);

  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [query, setQuery] = useState("");

  const myOwnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of myTeam?.players ?? []) ids.add(p.id);
    return ids;
  }, [myTeam?.players]);

  const ownershipOf = (id: string): Ownership => {
    if (myOwnedIds.has(id)) return "roster";
    if (rosteredIds.has(id)) return "taken";
    return "available";
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = players
      .filter((p) => {
        if (posFilter === "ALL") return true;
        if (posFilter === "FLEX") return FLEX_OK.has(p.pos);
        return p.pos === posFilter;
      })
      .filter((p) => {
        const own = ownershipOf(p.id);
        if (own === "roster") return showRoster;
        if (own === "taken") return showTaken;
        return showAvailable;
      })
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          p.pos.toLowerCase().includes(q)
        );
      })
      .map((p) => {
        const proj = projectFor(p.id) ?? weeklyFallback(p);
        const entry = brain?.[p.id];
        const value = scaleValue(entry?.value ?? 0);
        const trend = entry?.trend ?? 0;
        return {
          player: p,
          proj,
          ownership: ownershipOf(p.id),
          value,
          trend,
        };
      })
      .sort((a, b) => b.proj - a.proj || a.player.name.localeCompare(b.player.name));

    return list;
  }, [
    players,
    posFilter,
    showRoster,
    showTaken,
    showAvailable,
    query,
    projectFor,
    brain,
    myOwnedIds,
    rosteredIds,
  ]);

  const loading = playersLoading || rostersLoading || projectionsLoading || nflWeek.isLoading;
  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1);
  const hasLeague = Boolean(activeLeague?.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display-title text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl">
              Weekly Projections
            </h1>
            <ActiveLeagueLabel />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Ranked by projected points for Week {activeWeek}
            {hasLeague
              ? ` in ${activeLeague?.name?.trim() || "your synced league"}`
              : " — sync a league to color-code roster ownership"}
            .
          </p>
        </div>
        <div className="w-full max-w-[11rem] shrink-0">
          <Select
            value={String(activeWeek)}
            onValueChange={(value) => setSelectedWeek(Math.max(1, Number(value) || 1))}
          >
            <SelectTrigger className="h-9 border-slate-200 bg-white text-sm font-semibold text-slate-800">
              <SelectValue placeholder="Select week" />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((week) => (
                <SelectItem key={week} value={String(week)}>
                  Week {week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_FILTERS.map((pos) => {
          const active = posFilter === pos;
          return (
            <button
              key={pos}
              type="button"
              onClick={() => setPosFilter(pos)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800",
              )}
            >
              {pos === "DEF" ? "DST" : pos}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["roster", showRoster, setShowRoster],
              ["taken", showTaken, setShowTaken],
              ["available", showAvailable, setShowAvailable],
            ] as const
          ).map(([key, on, setOn]) => {
            const meta = OWNERSHIP_META[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setOn((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
                  on
                    ? cn(meta.swatch, "text-slate-800")
                    : "border-slate-200 bg-slate-50 text-slate-400 opacity-70",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-2.5 rounded-sm border",
                    on ? meta.swatch : "border-slate-300 bg-slate-200",
                  )}
                  aria-hidden="true"
                />
                {meta.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex w-full items-center gap-4 border-b border-slate-200/80 bg-slate-50 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 select-none sm:px-4">
          <div className="flex min-w-0 flex-[1.35] items-center">
            <span className="w-12 shrink-0">Pos</span>
            <span>Player</span>
          </div>
          <div className="grid w-full max-w-xl flex-1 grid-cols-3 items-center gap-3">
            <span className="text-center">Status</span>
            <span className="text-center">Value / Trend</span>
            <span className="text-right">Proj</span>
          </div>
        </div>

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Loading weekly projections…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No players match the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(({ player, proj, ownership, value, trend }) => {
              const meta = OWNERSHIP_META[ownership];
              const byeLabel =
                player.bye != null && player.bye > 0
                  ? `${player.team?.trim() || "FA"} · Bye ${player.bye}`
                  : player.team?.trim() || "FA";
              const trendUp = trend > 0.05;
              const trendDown = trend < -0.05;
              return (
                <li key={player.id} className={cn("select-none", meta.row)}>
                  <button
                    type="button"
                    onClick={() => openPlayer(player.id)}
                    className="flex w-full cursor-pointer items-center gap-4 px-3 py-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-4"
                  >
                    <div className="flex min-w-0 flex-[1.35] items-center gap-3">
                      <span className="flex w-12 shrink-0 justify-start">
                        <PositionBadge pos={player.pos} />
                      </span>
                      <span className="flex min-w-0 items-center gap-3">
                        <PlayerAvatar
                          id={player.id}
                          pos={player.pos}
                          team={player.team}
                          name={player.name}
                          className="size-10 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
                          logoClassName="size-3.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">
                            {player.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
                            {byeLabel}
                          </span>
                        </span>
                      </span>
                    </div>

                    <div className="grid w-full max-w-xl flex-1 grid-cols-3 items-center gap-3 text-sm tabular-nums">
                      <span className="flex justify-center">
                        <span
                          className={cn(
                            "inline-flex min-w-[4.75rem] items-center justify-center rounded px-2 py-0.5 text-center text-[9px] font-black uppercase tracking-wider",
                            meta.chip,
                          )}
                        >
                          {meta.label}
                        </span>
                      </span>
                      <span className="inline-flex items-center justify-center gap-1.5 text-slate-500">
                        <span>{value.toFixed(1)}</span>
                        <span className="text-slate-300">/</span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 font-semibold",
                            trendUp
                              ? "text-emerald-600"
                              : trendDown
                                ? "text-rose-600"
                                : "text-slate-400",
                          )}
                        >
                          <span aria-hidden="true">{trendUp ? "▲" : trendDown ? "▼" : "–"}</span>
                          <span>{Math.abs(trend).toFixed(1)}</span>
                        </span>
                      </span>
                      <span className="text-right font-semibold text-slate-900">
                        {proj.toFixed(1)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!hasLeague ? (
        <p className="mt-3 text-xs text-slate-400">
          Sync a league to classify players as Roster, Taken, or Available against your active
          rosters.
        </p>
      ) : teams.length === 0 && !rostersLoading ? (
        <p className="mt-3 text-xs text-slate-400">
          Roster ownership colors appear once synced league rosters finish loading.
        </p>
      ) : null}

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

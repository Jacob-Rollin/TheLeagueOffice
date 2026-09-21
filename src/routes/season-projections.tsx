import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos, Scoring } from "@/lib/draft";
import { scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/season-projections")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Season Projections — The League Office" },
      {
        name: "description",
        content:
          "Full-season fantasy projections ranked high to low, filtered by roster, taken, and available players in your synced league.",
      },
    ],
  }),
  component: SeasonProjectionsRoute,
});

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type Ownership = "roster" | "taken" | "available";

const POS_FILTERS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const FLEX_OK = new Set<Pos>(["RB", "WR", "TE"]);

function seasonProjFor(player: Player, format: Scoring): number {
  const bucket = player.proj;
  if (!bucket) return 0;
  const raw = bucket[format] ?? bucket.half ?? bucket.ppr ?? bucket.std ?? 0;
  return Math.max(0, Number(raw) || 0);
}

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

function SeasonProjectionsRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <SeasonProjectionsPage key={activeLeagueId ?? "none"} />;
}

function SeasonProjectionsPage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, myTeam, rosteredIds, loading: rostersLoading } = useLeagueRosters(players);
  const brain = usePlayerBrain();
  const { format, loading: scoringLoading } = useLeagueProjections();
  const scoringFormat: Scoring =
    format === "std" || format === "half" || format === "ppr" ? format : "half";
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

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
    return players
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
        const proj = seasonProjFor(p, scoringFormat);
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
  }, [
    players,
    posFilter,
    showRoster,
    showTaken,
    showAvailable,
    query,
    scoringFormat,
    brain,
    myOwnedIds,
    rosteredIds,
  ]);

  const loading = playersLoading || rostersLoading || scoringLoading;
  const hasLeague = Boolean(activeLeague?.id);
  const seasonLabel = String(new Date().getFullYear());

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display-title text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl">
              Season Projections
            </h1>
            <ActiveLeagueLabel />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Ranked by projected season fantasy points for {seasonLabel}
            {hasLeague
              ? ` in ${activeLeague?.name?.trim() || "your synced league"}`
              : " — sync a league to color-code roster ownership"}
            .
          </p>
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
        <div className="grid w-full grid-cols-[2.5rem_minmax(0,1.35fr)_minmax(5rem,0.7fr)_minmax(7.5rem,0.95fr)_3.5rem] items-center gap-x-2 border-b border-slate-200/80 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 select-none sm:grid-cols-[2.75rem_minmax(12rem,1.45fr)_minmax(5.5rem,0.75fr)_minmax(8.5rem,1fr)_4rem] sm:gap-x-4 sm:px-4">
          <span className="text-center">Rk</span>
          <span>Player</span>
          <span className="text-center">Status</span>
          <span className="text-center">Value / Trend</span>
          <span className="text-right">Proj</span>
        </div>

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Loading season projections…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No players match the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(({ player, proj, ownership, value, trend }, index) => {
              const meta = OWNERSHIP_META[ownership];
              const posLabel = player.pos === "DEF" ? "DST" : player.pos;
              const team = player.team?.trim() || "FA";
              const metaLine =
                player.bye != null && player.bye > 0
                  ? `${posLabel} · ${team} · Bye ${player.bye}`
                  : `${posLabel} · ${team}`;
              const trendUp = trend > 0.05;
              const trendDown = trend < -0.05;
              return (
                <li key={player.id} className={cn("select-none", meta.row)}>
                  <button
                    type="button"
                    onClick={() => openPlayer(player.id)}
                    className="grid w-full cursor-pointer grid-cols-[2.5rem_minmax(0,1.35fr)_minmax(5rem,0.7fr)_minmax(7.5rem,0.95fr)_3.5rem] items-center gap-x-2 px-3 py-2.5 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:grid-cols-[2.75rem_minmax(12rem,1.45fr)_minmax(5.5rem,0.75fr)_minmax(8.5rem,1fr)_4rem] sm:gap-x-4 sm:px-4"
                  >
                    <span className="text-center text-sm tabular-nums text-slate-500">
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PlayerAvatar
                        id={player.id}
                        pos={player.pos}
                        team={player.team}
                        name={player.name}
                        className="size-9 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
                        logoClassName="size-3"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-blue-700">
                          {player.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
                          {metaLine}
                        </span>
                      </span>
                    </span>
                    <span className="flex justify-center">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center rounded px-2 py-0.5 text-center text-[9px] font-black uppercase tracking-wider",
                          meta.chip,
                        )}
                      >
                        {meta.label}
                      </span>
                    </span>
                    <span className="inline-flex items-center justify-center gap-1.5 text-sm tabular-nums text-slate-500">
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
                    <span className="text-right text-sm font-semibold tabular-nums text-slate-900">
                      {proj.toFixed(1)}
                    </span>
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

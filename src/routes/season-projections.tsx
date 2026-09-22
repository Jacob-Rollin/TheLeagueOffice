import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { createFileRoute } from "@tanstack/react-router";
import { startTransition, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import {
  ProjectionListRow,
  PROJECTION_OWNERSHIP_META,
  PROJECTION_ROW_HEIGHT,
  type ProjectionOwnership,
  type ProjectionRowData,
} from "@/components/research/ProjectionListRow";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos, Scoring } from "@/lib/draft";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
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

const POS_FILTERS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const FLEX_OK = new Set<Pos>(["RB", "WR", "TE"]);

function seasonProjFor(player: Player, format: Scoring): number | null {
  const bucket = player.proj;
  if (!bucket) return null;
  const raw = bucket[format] ?? bucket.half ?? bucket.ppr ?? bucket.std;
  const n = Number(raw);
  // Catalog is built from Sleeper season pts_* — treat missing/zero as "—".
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

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
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const myOwnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of myTeam?.players ?? []) ids.add(p.id);
    return ids;
  }, [myTeam?.players]);

  const rows = useMemo((): ProjectionRowData[] => {
    const q = deferredQuery.trim().toLowerCase();
    const ownershipOf = (id: string): ProjectionOwnership => {
      if (myOwnedIds.has(id)) return "roster";
      if (rosteredIds.has(id)) return "taken";
      return "available";
    };

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
        const badge = injuryMicroBadge(resolveInjuryStatus(p, brain));
        const posLabel = p.pos === "DEF" ? "DST" : p.pos;
        const team = p.team?.trim() || "FA";
        const metaLine =
          p.bye != null && p.bye > 0
            ? `${posLabel} · ${team} · Bye ${p.bye}`
            : `${posLabel} · ${team}`;
        return {
          player: p,
          proj,
          ownership: ownershipOf(p.id),
          value,
          trend,
          injuryLabel: badge?.label ?? null,
          injuryClass: badge?.className ?? null,
          metaLine,
        };
      })
      .sort(
        (a, b) =>
          (b.proj ?? -1) - (a.proj ?? -1) || a.player.name.localeCompare(b.player.name),
      );
  }, [
    players,
    posFilter,
    showRoster,
    showTaken,
    showAvailable,
    deferredQuery,
    scoringFormat,
    brain,
    myOwnedIds,
    rosteredIds,
  ]);

  const loading = playersLoading || rostersLoading || scoringLoading;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [loading, rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: loading ? 0 : rows.length,
    estimateSize: () => PROJECTION_ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  });
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
              onClick={() => startTransition(() => setPosFilter(pos))}
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
            const meta = PROJECTION_OWNERSHIP_META[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => startTransition(() => setOn((v) => !v))}
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
          <div ref={listRef}>
            <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]!;
                return (
                  <ProjectionListRow
                    key={row.player.id}
                    row={row}
                    rank={item.index + 1}
                    onOpen={openPlayer}
                    style={{
                      height: item.size,
                      transform: `translateY(${item.start - scrollMargin}px)`,
                    }}
                  />
                );
              })}
            </ul>
          </div>
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

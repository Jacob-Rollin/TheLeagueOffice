import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import {
  PROJECTION_OWNERSHIP_META,
  PROJECTION_ROW_HEIGHT,
  type ProjectionOwnership,
  type ProjectionRowData,
} from "@/components/research/ProjectionListRow";
import {
  flattenProjectionGroups,
  formatProjectionStat,
  PROJECTION_FLEX_OK,
  PROJECTION_POS_FILTERS,
  projectionGroupsForPos,
  projectionStatNumber,
  type FlatProjectionStatCol,
  type ProjectionPosFilter,
  type ProjectionStatSortKey,
} from "@/components/research/projectionStatColumns";
import {
  scoreResearchProjection,
  ScoringFormatSelect,
  useResearchScoringFormat,
} from "@/components/research/ScoringFormatSelect";
import {
  nextSortState,
  PLAYER_LIST_COL_HEADER_ROW,
  PLAYER_LIST_GROUP_HEADER_ROW,
  PLAYER_LIST_GROUP_TH,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
import { ValueTrendCell } from "@/components/research/ValueTrendCell";
import { competitionRanksByMetric } from "@/components/research/statRanks";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections, useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { hasDisplayableProjection } from "@/lib/scoring-map";
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

type SortKey = "player" | "value" | "proj" | ProjectionStatSortKey;

type EnrichedWeeklyRow = ProjectionRowData & {
  stats: Record<string, number> | null;
  /** Competition rank by this page's primary metric (projected fantasy points). */
  statRank: number;
};

function WeeklyProjectionsRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <WeeklyProjectionsPage key={activeLeagueId ?? "none"} />;
}

function WeeklyProjectionsPage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const catalogPlayers = playersPayload?.players ?? [];
  const brain = usePlayerBrain();
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const nflState = useNflState();
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  useEffect(() => {
    if (nflState.data?.week != null) setSelectedWeek(nflState.data.week);
  }, [nflState.data?.week, activeLeague?.id]);

  const activeWeek = selectedWeek ?? nflState.data?.week ?? 1;
  const {
    statsFor,
    format: leagueFormat,
    scoringMap,
    loading: projectionsLoading,
  } = useLeagueProjections(activeWeek);
  // Catalog only — same player universe as PlayerDetail / getPlayerDetail.
  // Projection-only stubs opened "Player not found" in the shared popup.
  const players = catalogPlayers;
  const { teams, myTeam, rosteredIds, loading: rostersLoading } = useLeagueRosters(players);
  const { format: scoringFormat, override: scoringOverride, setFormat: setScoringFormat } =
    useResearchScoringFormat(leagueFormat);

  const [posFilter, setPosFilter] = useState<ProjectionPosFilter>("QB");
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sortKey, setSortKey] = useState<SortKey | null>("proj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const statGroups = useMemo(() => projectionGroupsForPos(posFilter), [posFilter]);
  const statCols = useMemo(() => flattenProjectionGroups(statGroups), [statGroups]);

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "player" ? "asc" : "desc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const setPos = (pos: ProjectionPosFilter) => {
    setPosFilter(pos);
    setSortKey("proj");
    setSortDir("desc");
  };

  const myOwnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of myTeam?.players ?? []) ids.add(p.id);
    return ids;
  }, [myTeam?.players]);

  const rows = useMemo((): EnrichedWeeklyRow[] => {
    const q = deferredQuery.trim().toLowerCase();
    const ownershipOf = (id: string): ProjectionOwnership => {
      if (myOwnedIds.has(id)) return "roster";
      if (rosteredIds.has(id)) return "taken";
      return "available";
    };
    const effectiveKey = sortKey ?? "proj";
    const effectiveDir = sortKey == null ? "desc" : sortDir;
    const activeStatCol =
      effectiveKey !== "player" && effectiveKey !== "value" && effectiveKey !== "proj"
        ? statCols.find((c) => c.key === effectiveKey) ?? null
        : null;

    const enriched = players
      .filter((p) => {
        if (posFilter === "FLEX") return PROJECTION_FLEX_OK.has(p.pos);
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
        const bye = p.bye != null && p.bye === activeWeek;
        const stats = bye ? null : statsFor(p.id);
        const proj = bye
          ? null
          : scoreResearchProjection(stats, scoringFormat, scoringOverride, scoringMap);
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
          stats,
          statRank: 0,
        };
      })
      // Hide bye / unprojected clutter — same gate as popup depth "—" (proj > 0).
      .filter((row) => row.stats != null && hasDisplayableProjection(row.proj));

    // Rk = competition rank for the active numeric column (Proj by default).
    const rankMetric = (row: (typeof enriched)[number]): number | null => {
      if (effectiveKey === "value") return row.value;
      if (effectiveKey === "proj" || effectiveKey === "player") return row.proj;
      if (activeStatCol) return projectionStatNumber(row.stats, activeStatCol);
      return row.proj;
    };
    const ranks = competitionRanksByMetric(
      enriched,
      rankMetric,
      (row) => row.player.id,
    );

    return enriched
      .map((row) => ({ ...row, statRank: ranks.get(row.player.id) ?? 0 }))
      .sort((a, b) => {
        let cmp = 0;
        if (effectiveKey === "player") {
          cmp = a.player.name.localeCompare(b.player.name);
        } else if (effectiveKey === "value") {
          cmp = a.value - b.value || a.trend - b.trend;
        } else if (effectiveKey === "proj") {
          cmp = (a.proj ?? -1) - (b.proj ?? -1);
        } else if (activeStatCol) {
          cmp =
            (projectionStatNumber(a.stats, activeStatCol) ?? -1) -
            (projectionStatNumber(b.stats, activeStatCol) ?? -1);
        }
        if (cmp !== 0) return effectiveDir === "asc" ? cmp : -cmp;
        return a.player.name.localeCompare(b.player.name);
      });
  }, [
    players,
    posFilter,
    showRoster,
    showTaken,
    showAvailable,
    deferredQuery,
    statsFor,
    scoringFormat,
    scoringOverride,
    scoringMap,
    brain,
    myOwnedIds,
    rosteredIds,
    sortKey,
    sortDir,
    activeWeek,
    statCols,
  ]);

  const loading = playersLoading || rostersLoading || projectionsLoading || nflState.isLoading;
  const ready = !loading && rows.length > 0;
  const colSpan = 4 + statCols.length;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ready, rows.length, posFilter]);

  const virtualizer = useWindowVirtualizer({
    count: ready ? rows.length : 0,
    estimateSize: () => PROJECTION_ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? Math.max(0, items[0]!.start - scrollMargin) : 0;
  const paddingBottom =
    items.length > 0
      ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1]!.end - scrollMargin))
      : 0;

  const weekOptions = Array.from({ length: 18 }, (_, i) => i + 1);
  const hasLeague = Boolean(activeLeague?.id);
  const minWidth =
    posFilter === "K"
      ? "min-w-[720px]"
      : posFilter === "DEF"
        ? "min-w-[900px]"
        : "min-w-[980px]";

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display-title text-3xl text-slate-900">
              Weekly <span className="text-primary">Projections</span>
            </h1>
            <ActiveLeagueLabel />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Sleeper week {activeWeek} projections
            {hasLeague
              ? `, scored for ${activeLeague?.name?.trim() || "your synced league"}`
              : ""}
            .
          </p>
        </div>
        <div className="w-full max-w-[11rem] shrink-0">
          <Select
            value={String(activeWeek)}
            onValueChange={(value) =>
              startTransition(() => setSelectedWeek(Math.max(1, Number(value) || 1)))
            }
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
        {PROJECTION_POS_FILTERS.map((pos) => {
          const active = posFilter === pos;
          return (
            <button
              key={pos}
              type="button"
              onClick={() => startTransition(() => setPos(pos))}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
              )}
            >
              {pos === "DEF" ? "DST" : pos}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-between">
        <div className="flex flex-nowrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30">
              Availability
              <ChevronDown className="size-4 opacity-50" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 p-1">
              {(
                [
                  ["roster", showRoster, setShowRoster],
                  ["taken", showTaken, setShowTaken],
                  ["available", showAvailable, setShowAvailable],
                ] as const
              ).map(([key, on, setOn]) => {
                const meta = PROJECTION_OWNERSHIP_META[key];
                return (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={on}
                    onCheckedChange={(checked) =>
                      startTransition(() => setOn(Boolean(checked)))
                    }
                    onSelect={(e) => e.preventDefault()}
                    className={cn("rounded-sm", on ? meta.row : undefined)}
                  >
                    {meta.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <ScoringFormatSelect
            value={scoringFormat}
            onChange={(next) => startTransition(() => setScoringFormat(next))}
          />
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-64"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div ref={listRef} className="overflow-x-auto">
          <table className={cn("w-full border-collapse text-sm", minWidth)}>
            <thead className="sticky top-0 z-10">
              <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
                <th colSpan={2} className="px-3 py-2" aria-hidden="true" />
                {statGroups.map((group) => (
                  <th
                    key={group.label}
                    colSpan={group.cols.length}
                    className={PLAYER_LIST_GROUP_TH}
                  >
                    {group.label}
                  </th>
                ))}
                <th colSpan={2} className={PLAYER_LIST_GROUP_TH}>
                  Misc
                </th>
              </tr>
              <tr className={PLAYER_LIST_COL_HEADER_ROW}>
                <th className="w-10 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Rk"
                    active={sortKey === "proj"}
                    dir={sortDir}
                    onClick={() => toggleSort("proj")}
                  />
                </th>
                <th className="px-2 py-1.5 text-left">
                  <SortHeaderButton
                    label="Player"
                    active={sortKey === "player"}
                    dir={sortDir}
                    onClick={() => toggleSort("player")}
                    align="left"
                  />
                </th>
                {statCols.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-1.5 py-1.5 text-center",
                      col.groupStart ? "border-l border-slate-100" : "",
                    )}
                  >
                    <SortHeaderButton
                      label={col.label}
                      active={sortKey === col.key}
                      dir={sortDir}
                      onClick={() => toggleSort(col.key)}
                    />
                  </th>
                ))}
                <th className="border-l border-slate-100 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Value / Trend"
                    active={sortKey === "value"}
                    dir={sortDir}
                    onClick={() => toggleSort("value")}
                  />
                </th>
                <th className="px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Proj"
                    active={sortKey === "proj"}
                    dir={sortDir}
                    onClick={() => toggleSort("proj")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    Loading weekly projections…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    No players match the current filters.
                  </td>
                </tr>
              ) : (
                <>
                  {paddingTop > 0 ? (
                    <tr aria-hidden="true">
                      <td
                        colSpan={colSpan}
                        style={{ height: paddingTop, padding: 0, border: 0 }}
                      />
                    </tr>
                  ) : null}
                  {items.map((item) => {
                    const row = rows[item.index]!;
                    return (
                      <WeeklyProjRow
                        key={row.player.id}
                        row={row}
                        rank={row.statRank}
                        statCols={statCols}
                        onOpen={openPlayer}
                      />
                    );
                  })}
                  {paddingBottom > 0 ? (
                    <tr aria-hidden="true">
                      <td
                        colSpan={colSpan}
                        style={{ height: paddingBottom, padding: 0, border: 0 }}
                      />
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!hasLeague ? (
        <p className="mt-3 text-xs text-slate-400">
          Sync a league to classify players as Rostered, Taken, or Available against your active
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

const WeeklyProjRow = memo(function WeeklyProjRow({
  row,
  rank,
  statCols,
  onOpen,
}: {
  row: EnrichedWeeklyRow;
  rank: number;
  statCols: FlatProjectionStatCol[];
  onOpen: (id: string) => void;
}) {
  const meta = PROJECTION_OWNERSHIP_META[row.ownership];
  const { player } = row;

  return (
    <tr className={cn("border-b border-slate-100", meta.row)}>
      <td className="w-10 px-2 py-2.5 text-center text-sm tabular-nums text-slate-500">
        {rank}
      </td>
      <td className="px-3 py-2.5">
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
              {row.injuryLabel && row.injuryClass ? (
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-0.5 text-[9px] font-bold text-white",
                    row.injuryClass,
                  )}
                >
                  {row.injuryLabel}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
              {row.metaLine}
            </span>
          </span>
        </button>
      </td>
      {statCols.map((col) => (
        <td
          key={col.key}
          className={cn(
            "px-1.5 py-2.5 text-center tabular-nums text-slate-700",
            col.groupStart ? "border-l border-slate-100" : "",
          )}
        >
          {formatProjectionStat(row.stats, col)}
        </td>
      ))}
      <td className="border-l border-slate-100 px-2 py-2.5 text-center">
        <ValueTrendCell value={row.value} trend={row.trend} />
      </td>
      <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">
        {row.proj != null && Number.isFinite(row.proj) ? row.proj.toFixed(2) : "—"}
      </td>
    </tr>
  );
});

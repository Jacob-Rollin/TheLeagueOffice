import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
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
import {
  nextSortState,
  PLAYER_LIST_HEADER_ROW,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
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
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getMostTargetedPlayers } from "@/lib/players.functions";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import type { TargetedPlayerRow, TargetPos } from "@/lib/targets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/most-targeted-players")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Most Targeted Players — The League Office" },
      {
        name: "description",
        content:
          "NFL pass targets by week for RB, WR, and TE — see who is getting the ball in PPR formats.",
      },
    ],
  }),
  component: MostTargetedRoute,
});

type PosFilter = "ALL" | TargetPos;
type Ownership = "roster" | "taken" | "available";
type SortKey = "player" | "week" | "total" | "avg";

type EnrichedRow = TargetedPlayerRow & {
  ownership: Ownership;
  injuryLabel: string | null;
  injuryClass: string | null;
  weekTargets: number;
  metaLine: string;
  /** Competition rank for the active / page-default target metric. */
  statRank: number;
};

const POS_TABS: PosFilter[] = ["ALL", "RB", "WR", "TE"];
const ROW_HEIGHT = 58;

const OWNERSHIP_META: Record<
  Ownership,
  { label: string; swatch: string; row: string }
> = {
  roster: {
    label: "Rostered",
    swatch: "bg-sky-100 border-sky-300",
    row: "bg-sky-50/90",
  },
  taken: {
    label: "Taken",
    swatch: "bg-white border-slate-300",
    row: "bg-white",
  },
  available: {
    label: "Available",
    swatch: "bg-emerald-100 border-emerald-300",
    row: "bg-emerald-50/80",
  },
};

function seasonOptions(): string[] {
  const current =
    new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  return Array.from({ length: 5 }, (_, i) => String(current - i));
}

function MostTargetedRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <MostTargetedPage key={activeLeagueId ?? "none"} />;
}

function MostTargetedPage() {
  const seasons = useMemo(() => seasonOptions(), []);
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [season, setSeason] = useState(seasons[0] ?? String(new Date().getFullYear()));
  const [week, setWeek] = useState<number | null>(null);
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>("avg");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const brain = usePlayerBrain();
  const playerById = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);
  const { myTeam, rosteredIds } = useLeagueRosters(players);

  const myOwnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of myTeam?.players ?? []) ids.add(p.id);
    return ids;
  }, [myTeam?.players]);

  const query = useQuery({
    queryKey: ["most-targeted-players", season],
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: () => getMostTargetedPlayers({ data: { season } }),
  });

  const payload = query.data;
  const maxWeek = payload?.maxWeek ?? 0;

  useEffect(() => {
    if (maxWeek <= 0) return;
    setWeek((prev) => (prev != null && prev >= 1 && prev <= maxWeek ? prev : maxWeek));
  }, [maxWeek, season]);

  const activeWeek = week ?? maxWeek;

  const rows = useMemo((): EnrichedRow[] => {
    const list = payload?.rows ?? [];
    const needle = deferredQ.trim().toLowerCase();
    const effectiveKey = sortKey ?? "avg";
    const effectiveDir = sortKey == null ? "desc" : sortDir;

    const enriched = list
      .filter((r) => (pos === "ALL" ? true : r.pos === pos))
      .filter((r) => r.total > 0)
      .filter((r) => {
        const own: Ownership = myOwnedIds.has(r.id)
          ? "roster"
          : rosteredIds.has(r.id)
            ? "taken"
            : "available";
        if (own === "roster" && !showRoster) return false;
        if (own === "taken" && !showTaken) return false;
        if (own === "available" && !showAvailable) return false;
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle) ||
          r.team.toLowerCase().includes(needle) ||
          r.pos.toLowerCase().includes(needle)
        );
      })
      .map((r) => {
        const ownership: Ownership = myOwnedIds.has(r.id)
          ? "roster"
          : rosteredIds.has(r.id)
            ? "taken"
            : "available";
        const badge = injuryMicroBadge(
          resolveInjuryStatus(playerById.get(r.id) ?? { id: r.id }, brain),
        );
        const weekTargets =
          activeWeek > 0 && activeWeek < r.byWeek.length ? (r.byWeek[activeWeek] ?? 0) : 0;
        const sleeper = playerById.get(r.id);
        const team = (sleeper?.team ?? r.team)?.trim() || "FA";
        const bye = sleeper?.bye;
        const metaLine =
          bye != null && bye > 0 ? `${r.pos} · ${team} · Bye ${bye}` : `${r.pos} · ${team}`;
        return {
          ...r,
          team,
          ownership,
          injuryLabel: badge?.label ?? null,
          injuryClass: badge?.className ?? null,
          weekTargets,
          metaLine,
          statRank: 0,
        };
      });

    const rankMetric = (row: EnrichedRow): number => {
      if (effectiveKey === "week") return row.weekTargets;
      if (effectiveKey === "total") return row.total;
      // avg (default) and player-name sort fall back to avg targets.
      return row.avg;
    };
    const ranks = competitionRanksByMetric(enriched, rankMetric, (row) => row.id);

    return enriched
      .map((row) => ({ ...row, statRank: ranks.get(row.id) ?? 0 }))
      .sort((a, b) => {
        let cmp = 0;
        if (effectiveKey === "player") {
          cmp = a.name.localeCompare(b.name);
        } else if (effectiveKey === "week") {
          cmp = a.weekTargets - b.weekTargets;
        } else if (effectiveKey === "total") {
          cmp = a.total - b.total;
        } else {
          cmp = a.avg - b.avg;
        }
        if (cmp !== 0) return effectiveDir === "asc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      });
  }, [
    payload?.rows,
    pos,
    deferredQ,
    showRoster,
    showTaken,
    showAvailable,
    myOwnedIds,
    rosteredIds,
    playerById,
    brain,
    activeWeek,
    sortKey,
    sortDir,
  ]);

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "player" ? "asc" : "desc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  const ready = !query.isLoading && !query.isError && rows.length > 0;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ready, rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: ready ? rows.length : 0,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? Math.max(0, items[0]!.start - scrollMargin) : 0;
  const paddingBottom =
    items.length > 0
      ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1]!.end - scrollMargin))
      : 0;

  const weekLabel =
    payload && maxWeek > 0
      ? activeWeek > 0
        ? `Week ${activeWeek} targets · ${payload.season} season average through Week ${maxWeek}`
        : `Season ${payload.season}`
      : payload
        ? `Season ${payload.season}`
        : "Loading target board…";

  const filterTriggerClass =
    "inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30";

  const weekOptions = maxWeek > 0 ? Array.from({ length: maxWeek }, (_, i) => i + 1) : [];
  const colSpan = 5;

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Most Targeted <span className="text-primary">Players</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">{weekLabel}</p>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">What are NFL targets?</p>
        <p className="mt-1 leading-relaxed">
          Targets count every pass thrown a player&apos;s way — completions and incompletions.
          High-target players are especially valuable in PPR and half-PPR leagues. The week column
          shows the selected week only; AVG is the season average across all weeks so far.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => startTransition(() => setPos(tab))}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
              pos === tab
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
            )}
          >
            {tab === "ALL" ? "Overall" : tab}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className={filterTriggerClass}>
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
                const meta = OWNERSHIP_META[key];
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

          <Select
            value={season}
            onValueChange={(v) => startTransition(() => setSeason(v))}
          >
            <SelectTrigger className="h-9 w-[7.5rem] border-slate-200 bg-white shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(activeWeek > 0 ? activeWeek : "")}
            onValueChange={(v) =>
              startTransition(() => setWeek(Math.max(1, Number(v) || 1)))
            }
            disabled={weekOptions.length === 0}
          >
            <SelectTrigger className="h-9 w-[8.5rem] border-slate-200 bg-white shadow-none">
              <SelectValue placeholder="Week" />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Week {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search players"
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div ref={listRef} className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="w-10 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Rk"
                    active={sortKey === "avg"}
                    dir={sortDir}
                    onClick={() => toggleSort("avg")}
                  />
                </th>
                <th className="px-3 py-1.5 text-left">
                  <SortHeaderButton
                    label="Player"
                    active={sortKey === "player"}
                    dir={sortDir}
                    onClick={() => toggleSort("player")}
                    align="left"
                  />
                </th>
                {(
                  [
                    ["week", activeWeek > 0 ? `Week ${activeWeek}` : "Week"],
                    ["total", "Ttl"],
                    ["avg", "Avg"],
                  ] as const
                ).map(([key, label]) => (
                  <th key={key} className="px-2 py-1.5 text-center">
                    <SortHeaderButton
                      label={label}
                      active={sortKey === key}
                      dir={sortDir}
                      onClick={() => toggleSort(key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    Loading most targeted players…
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-rose-600">
                    Could not load target data. Try again shortly.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    No target stats match the current filters.
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
                      <TargetRow
                        key={row.id}
                        row={row}
                        rank={row.statRank}
                        zebra={item.index % 2 === 1}
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

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

const TargetRow = memo(function TargetRow({
  row,
  rank,
  zebra,
  onOpen,
}: {
  row: EnrichedRow;
  rank: number;
  zebra: boolean;
  onOpen: (id: string) => void;
}) {
  const ownTone = OWNERSHIP_META[row.ownership].row;
  const tone = row.ownership === "taken" && zebra ? "bg-slate-50/50" : ownTone;

  return (
    <tr className={cn("border-b border-slate-100", tone)}>
      <td className="w-10 px-2 py-2.5 text-center text-sm tabular-nums text-slate-500">
        {rank}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          className="flex min-w-0 items-center gap-2.5 text-left transition-opacity hover:opacity-85"
        >
          <PlayerAvatar
            id={row.id}
            pos={row.pos}
            team={row.team}
            name={row.name}
            className="size-9 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
            logoClassName="size-3"
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-blue-700">{row.name}</span>
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
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-800">{row.weekTargets}</td>
      <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">
        {row.total}
      </td>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-600">
        {row.avg.toFixed(1)}
      </td>
    </tr>
  );
});

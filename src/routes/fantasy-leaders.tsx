import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  nextSortState,
  PLAYER_LIST_COL_HEADER_ROW,
  PLAYER_LIST_GROUP_HEADER_ROW,
  PLAYER_LIST_GROUP_TH,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
import { competitionRanksByMetric } from "@/components/research/statRanks";
import {
  ScoringFormatSelect,
  scoringFormatLabel,
  useResearchScoringFormat,
} from "@/components/research/ScoringFormatSelect";
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
import { useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import { fetchResearchFantasyLeaders } from "@/lib/research-cdn";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import type { ScoringFormat } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fantasy-leaders")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Fantasy Leaders — The League Office" },
      {
        name: "description",
        content:
          "Weekly fantasy football scoring leaders for Standard, Half PPR, and PPR leagues, broken down by week.",
      },
    ],
  }),
  component: FantasyLeadersRoute,
});

type PosTab = "ALL" | Pos;

const POS_TABS: { value: PosTab; label: string }[] = [
  { value: "ALL", label: "Overall" },
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "K", label: "K" },
  { value: "DEF", label: "DST" },
];

const ROW_HEIGHT = 58;
const FORMAT_INDEX: Record<ScoringFormat, 0 | 1 | 2> = { std: 0, half: 1, ppr: 2 };

type Ownership = "roster" | "taken" | "available";

const OWNERSHIP_META: Record<Ownership, { label: string; row: string }> = {
  roster: { label: "Rostered", row: "bg-sky-50/90" },
  taken: { label: "Taken", row: "bg-white" },
  available: { label: "Available", row: "bg-emerald-50/80" },
};

type SortKey = "rank" | "player" | "gp" | "avg" | "ttl" | `w${number}`;

type LeaderRow = {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  bye: number | null;
  metaLine: string;
  injuryLabel: string | null;
  injuryClass: string | null;
  ownership: Ownership;
  /** Points for each week in the selected range; null when the player did not appear. */
  weekPts: (number | null)[];
  gp: number;
  ttl: number;
  avg: number;
  rank: number;
};

function seasonOptions(): string[] {
  const current =
    new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  return Array.from({ length: 5 }, (_, i) => String(current - i));
}

function sortValue(row: LeaderRow, key: SortKey, weekFrom: number): number | string {
  switch (key) {
    case "rank":
      return row.rank;
    case "player":
      return row.name;
    case "gp":
      return row.gp;
    case "avg":
      return row.avg;
    case "ttl":
      return row.ttl;
    default: {
      const week = Number(key.slice(1));
      return row.weekPts[week - weekFrom] ?? -1;
    }
  }
}

function FantasyLeadersRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <FantasyLeadersPage key={activeLeagueId ?? "none"} />;
}

function FantasyLeadersPage() {
  const seasons = useMemo(() => seasonOptions(), []);
  const [pos, setPos] = useState<PosTab>("ALL");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [season, setSeason] = useState(seasons[0] ?? String(new Date().getFullYear()));
  /** Inclusive week range; null means the season's first / latest available week. */
  const [weekFrom, setWeekFrom] = useState<number | null>(null);
  const [weekTo, setWeekTo] = useState<number | null>(null);
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>("ttl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { format: leagueFormat } = useLeagueScoringMeta();
  const { format: scoringFormat, setFormat: setScoringFormat } =
    useResearchScoringFormat(leagueFormat);

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
    queryKey: ["fantasy-leaders", season],
    staleTime: 10 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: () => fetchResearchFantasyLeaders(season),
  });

  const payload = query.data;
  const maxWeek = payload?.maxWeek ?? 0;
  const weekOptions = useMemo(
    () => Array.from({ length: Math.max(0, maxWeek) }, (_, i) => i + 1),
    [maxWeek],
  );
  const shownFrom = maxWeek > 0 ? Math.min(weekFrom ?? 1, maxWeek) : 0;
  const shownTo = maxWeek > 0 ? Math.max(shownFrom, Math.min(weekTo ?? maxWeek, maxWeek)) : 0;
  const rangeWeeks = useMemo(
    () =>
      shownTo > 0 ? Array.from({ length: shownTo - shownFrom + 1 }, (_, i) => shownFrom + i) : [],
    [shownFrom, shownTo],
  );
  const rows = useMemo((): LeaderRow[] => {
    const list = payload?.rows ?? [];
    const needle = deferredQ.trim().toLowerCase();
    const fmt = FORMAT_INDEX[scoringFormat];
    const effectiveKey: SortKey = sortKey ?? "ttl";
    const effectiveDir: SortDir = sortKey == null ? "desc" : sortDir;

    const enriched: LeaderRow[] = [];
    for (const r of list) {
      if (pos !== "ALL" && r.pos !== pos) continue;
      const ownership: Ownership = myOwnedIds.has(r.id)
        ? "roster"
        : rosteredIds.has(r.id)
          ? "taken"
          : "available";
      if (ownership === "roster" && !showRoster) continue;
      if (ownership === "taken" && !showTaken) continue;
      if (ownership === "available" && !showAvailable) continue;

      const weekPts = rangeWeeks.map((w) => r.weeks[w - 1]?.[fmt] ?? null);
      const played = weekPts.filter((v): v is number => v != null);
      if (played.length === 0) continue;

      const sleeper = playerById.get(r.id);
      const name = sleeper?.name || r.name;
      const team = (sleeper?.team ?? r.team)?.trim() || "FA";
      if (needle && !name.toLowerCase().includes(needle) && !team.toLowerCase().includes(needle)) {
        continue;
      }

      const ttl = Math.round(played.reduce((sum, v) => sum + v, 0) * 10) / 10;
      const bye = sleeper?.bye != null && Number(sleeper.bye) > 0 ? Number(sleeper.bye) : null;
      const posLabel = r.pos === "DEF" ? "DST" : r.pos;
      const badge = injuryMicroBadge(resolveInjuryStatus(sleeper ?? { id: r.id }, brain));
      enriched.push({
        id: r.id,
        name,
        pos: r.pos,
        team,
        bye,
        metaLine: bye != null ? `${posLabel} · ${team} · Bye ${bye}` : `${posLabel} · ${team}`,
        injuryLabel: badge?.label ?? null,
        injuryClass: badge?.className ?? null,
        ownership,
        weekPts,
        gp: played.length,
        ttl,
        avg: Math.round((ttl / played.length) * 10) / 10,
        rank: 0,
      });
    }

    const rankMetric = (row: LeaderRow): number | null => {
      if (effectiveKey === "player" || effectiveKey === "rank") return row.ttl;
      const value = sortValue(row, effectiveKey, shownFrom);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const ranks = competitionRanksByMetric(enriched, rankMetric, (row) => row.id);

    return enriched
      .map((row) => ({ ...row, rank: ranks.get(row.id) ?? enriched.length }))
      .sort((a, b) => {
        const av = sortValue(a, effectiveKey, shownFrom);
        const bv = sortValue(b, effectiveKey, shownFrom);
        const cmp =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv)
            : Number(av) - Number(bv);
        if (cmp !== 0) return effectiveDir === "asc" ? cmp : -cmp;
        return b.ttl - a.ttl || a.name.localeCompare(b.name);
      });
  }, [
    payload?.rows,
    pos,
    deferredQ,
    scoringFormat,
    sortKey,
    sortDir,
    rangeWeeks,
    shownFrom,
    showRoster,
    showTaken,
    showAvailable,
    myOwnedIds,
    rosteredIds,
    playerById,
    brain,
  ]);

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "player" || key === "rank" ? "asc" : "desc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const posLabel = POS_TABS.find((t) => t.value === pos)?.label ?? "Overall";
  const subtitle =
    maxWeek > 0
      ? `Top ${posLabel} - ${
          shownFrom === shownTo ? `Week ${shownTo}` : `Weeks ${shownFrom} to ${shownTo}`
        } (${payload?.season ?? season})`
      : payload
        ? `No regular season games played yet in ${payload.season}`
        : "Loading fantasy leaders…";

  const filterTriggerClass =
    "inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30";

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Fantasy <span className="text-primary">Leaders</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">About Fantasy Leaders</p>
        <p className="mt-1 leading-relaxed">
          Fantasy scoring leaders broken down by week, using {scoringFormatLabel(scoringFormat)}{" "}
          scoring. Sort by total points, average points per game, or any single week to spot the
          top fantasy players over the selected range.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() =>
              startTransition(() => {
                setPos(tab.value);
                setSortKey("ttl");
                setSortDir("desc");
              })
            }
            className={cn(
              "rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
              pos === tab.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-between">
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
              ).map(([key, on, setOn]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={on}
                  onCheckedChange={(checked) => startTransition(() => setOn(Boolean(checked)))}
                  onSelect={(e) => e.preventDefault()}
                  className={cn("rounded-sm", on ? OWNERSHIP_META[key].row : undefined)}
                >
                  {OWNERSHIP_META[key].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select
            value={season}
            onValueChange={(v) =>
              startTransition(() => {
                setSeason(v);
                setWeekFrom(null);
                setWeekTo(null);
              })
            }
          >
            <SelectTrigger className="h-9 w-[7.5rem] shrink-0 border-slate-200 bg-white shadow-none">
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

          {weekOptions.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Select
                value={String(shownFrom)}
                onValueChange={(v) =>
                  startTransition(() => {
                    const next = Number(v);
                    setWeekFrom(next);
                    if (next > shownTo) setWeekTo(next);
                  })
                }
              >
                <SelectTrigger
                  aria-label="From week"
                  className="h-9 w-[7rem] shrink-0 border-slate-200 bg-white shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekOptions.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      Week {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs font-medium text-slate-500">to</span>
              <Select
                value={String(shownTo)}
                onValueChange={(v) =>
                  startTransition(() => {
                    const next = Number(v);
                    setWeekTo(next);
                    if (next < shownFrom) setWeekFrom(next);
                  })
                }
              >
                <SelectTrigger
                  aria-label="To week"
                  className="h-9 w-[7rem] shrink-0 border-slate-200 bg-white shadow-none"
                >
                  <SelectValue />
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
          ) : null}

          <ScoringFormatSelect
            value={scoringFormat}
            onChange={(next) => startTransition(() => setScoringFormat(next))}
          />
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search players"
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-64"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <LeadersTable
          rows={rows}
          weeks={rangeWeeks}
          loading={query.isLoading}
          error={query.isError}
          onOpen={openPlayer}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      </div>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

const LeaderPlayerCell = memo(function LeaderPlayerCell({
  row,
  onOpen,
}: {
  row: LeaderRow;
  onOpen: (id: string) => void;
}) {
  return (
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
  );
});

const LeaderRowCells = memo(function LeaderRowCells({
  row,
  weeks,
  onOpen,
}: {
  row: LeaderRow;
  weeks: number[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{row.rank}</td>
      <td className="px-2 py-2.5">
        <LeaderPlayerCell row={row} onOpen={onOpen} />
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.gp}</td>
      {weeks.map((week, i) => {
        const pts = row.weekPts[i];
        return (
          <td
            key={week}
            className={cn(
              "px-1.5 py-2.5 text-center tabular-nums",
              i === 0 && "border-l border-slate-100",
            )}
          >
            {pts != null ? (
              pts.toFixed(1)
            ) : row.bye === week ? (
              <span className="text-[10px] font-bold text-slate-400">BYE</span>
            ) : (
              <span className="text-slate-300">-</span>
            )}
          </td>
        );
      })}
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums text-slate-600">
        {row.avg.toFixed(1)}
      </td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums text-slate-900">
        {row.ttl.toFixed(1)}
      </td>
    </>
  );
});

/** Window-scrolled virtual table — sticky header, no nested page scrollbar. */
function LeadersTable({
  rows,
  weeks,
  loading,
  error,
  onOpen,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: LeaderRow[];
  weeks: number[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const ready = !loading && !error && rows.length > 0;
  const colSpan = 5 + weeks.length;

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

  const sortTh = (key: SortKey, label: string, className: string, align: "left" | "center" = "center") => (
    <th key={key} className={className}>
      <SortHeaderButton
        label={label}
        active={sortKey === key}
        dir={sortDir}
        onClick={() => onSort(key)}
        align={align}
      />
    </th>
  );

  return (
    <div ref={listRef} className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ minWidth: `${420 + weeks.length * 60 + 150}px` }}
      >
        <thead className="sticky top-0 z-10">
          <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
            <th colSpan={3} className="px-3 py-2" aria-hidden="true" />
            {weeks.length ? (
              <th colSpan={weeks.length} className={PLAYER_LIST_GROUP_TH}>
                Week
              </th>
            ) : null}
            <th colSpan={2} className={PLAYER_LIST_GROUP_TH}>
              Fantasy Points
            </th>
          </tr>
          <tr className={PLAYER_LIST_COL_HEADER_ROW}>
            {sortTh("rank", "Rk", "w-12 px-2 py-1.5 text-center")}
            {sortTh("player", "Player", "min-w-[220px] px-2 py-1.5 text-left", "left")}
            {sortTh("gp", "GP", "w-14 px-1.5 py-1.5 text-center")}
            {weeks.map((week, i) =>
              sortTh(
                `w${week}`,
                String(week),
                cn("w-[60px] px-1.5 py-1.5 text-center", i === 0 && "border-l border-slate-100"),
              ),
            )}
            {sortTh("avg", "Avg", "w-16 border-l border-slate-100 px-1.5 py-1.5 text-center")}
            {sortTh("ttl", "Ttl", "w-16 px-1.5 py-1.5 text-center text-slate-700")}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                Loading fantasy leaders…
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-rose-600">
                Could not load fantasy leaders. Try again shortly.
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
                  <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {items.map((item) => {
                const row = rows[item.index]!;
                return (
                  <tr
                    key={row.id}
                    className={cn("border-b border-slate-100", OWNERSHIP_META[row.ownership].row)}
                  >
                    <LeaderRowCells row={row} weeks={weeks} onOpen={onOpen} />
                  </tr>
                );
              })}
              {paddingBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

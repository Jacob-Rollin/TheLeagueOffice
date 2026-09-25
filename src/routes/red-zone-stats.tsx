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
  type ReactNode,
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
  redZoneFantasyPoints,
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
import { getRedZoneStats } from "@/lib/players.functions";
import type { RedZonePlayerRow, RedZonePos } from "@/lib/redzone";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/red-zone-stats")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Red Zone Stats — The League Office" },
      {
        name: "description",
        content:
          "NFL red zone stats inside the 20/15/10/5 by position — only snaps from the selected depth count.",
      },
    ],
  }),
  component: RedZoneStatsRoute,
});

const POS_TABS: RedZonePos[] = ["QB", "RB", "WR", "TE"];
const YARDLINE_OPTS = [5, 10, 15, 20] as const;
type YardlineOpt = (typeof YARDLINE_OPTS)[number];

const REDZONE_ROW_HEIGHT = 58;

type Ownership = "roster" | "taken" | "available";

type EnrichedRedZoneRow = RedZonePlayerRow & {
  ownership: Ownership;
  injuryLabel: string | null;
  injuryClass: string | null;
  metaLine: string;
  /** Competition rank for the active / page-default red-zone metric. */
  statRank: number;
};

type RedZoneSortKey =
  | "rank"
  | "player"
  | "passCmp"
  | "passAtt"
  | "passPct"
  | "passYds"
  | "passYa"
  | "passTd"
  | "passInt"
  | "passSack"
  | "rushAtt"
  | "rushYds"
  | "rushYa"
  | "rushTd"
  | "rushPct"
  | "rec"
  | "recTgt"
  | "recYds"
  | "recYr"
  | "recTd"
  | "tgtPct"
  | "fumLost"
  | "games"
  | "fpts"
  | "fptsPerGame"
  | "rostPct";

function sortValue(row: EnrichedRedZoneRow, key: RedZoneSortKey): number | string {
  switch (key) {
    case "rank":
      return row.rank;
    case "player":
      return row.name;
    case "passCmp":
      return row.passCmp;
    case "passAtt":
      return row.passAtt;
    case "passPct":
      return row.passAtt > 0 ? row.passCmp / row.passAtt : -1;
    case "passYds":
      return row.passYds;
    case "passYa":
      return row.passAtt > 0 ? row.passYds / row.passAtt : -1;
    case "passTd":
      return row.passTd;
    case "passInt":
      return row.passInt;
    case "passSack":
      return row.passSack;
    case "rushAtt":
      return row.rushAtt;
    case "rushYds":
      return row.rushYds;
    case "rushYa":
      return row.rushAtt > 0 ? row.rushYds / row.rushAtt : -1;
    case "rushTd":
      return row.rushTd;
    case "rushPct":
      return row.rushPct;
    case "rec":
      return row.rec;
    case "recTgt":
      return row.recTgt;
    case "recYds":
      return row.recYds;
    case "recYr":
      return row.rec > 0 ? row.recYds / row.rec : -1;
    case "recTd":
      return row.recTd;
    case "tgtPct":
      return row.tgtPct;
    case "fumLost":
      return row.fumLost;
    case "games":
      return row.games;
    case "fpts":
      return row.fpts;
    case "fptsPerGame":
      return row.fptsPerGame;
    case "rostPct":
      return row.rostPct ?? -1;
  }
}

function seasonOptions(): string[] {
  const current =
    new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  return Array.from({ length: 5 }, (_, i) => String(current - i));
}

const OWNERSHIP_META: Record<
  Ownership,
  { label: string; swatch: string; row: string; chip: string }
> = {
  roster: {
    label: "Rostered",
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

function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function ya(yds: number, att: number): string {
  if (att <= 0) return "—";
  return (yds / att).toFixed(1);
}

function RedZoneStatsRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <RedZoneStatsPage key={activeLeagueId ?? "none"} />;
}

function RedZoneStatsPage() {
  const seasons = useMemo(() => seasonOptions(), []);
  const [pos, setPos] = useState<RedZonePos>("QB");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [season, setSeason] = useState(seasons[0] ?? String(new Date().getFullYear()));
  const [yardline, setYardline] = useState<YardlineOpt>(20);
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [sortKey, setSortKey] = useState<RedZoneSortKey | null>("fpts");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { format: leagueFormat } = useLeagueScoringMeta();
  const { format: scoringFormat, setFormat: setScoringFormat } =
    useResearchScoringFormat(leagueFormat);

  const toggleSort = (key: RedZoneSortKey) => {
    const next = nextSortState(
      sortKey,
      sortDir,
      key,
      key === "player" || key === "rank" ? "asc" : "desc",
    );
    setSortKey(next.key);
    setSortDir(next.dir);
  };

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
    queryKey: ["red-zone-stats", season, yardline],
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: () => getRedZoneStats({ data: { season, yardline } }),
  });

  const payload = query.data;
  const rows = useMemo((): EnrichedRedZoneRow[] => {
    const list = payload?.rowsByPos?.[pos] ?? [];
    const needle = deferredQ.trim().toLowerCase();
    const effectiveKey = sortKey ?? "fpts";
    const effectiveDir = sortKey == null ? "desc" : sortDir;

    const enriched = list
      .filter((r) => {
        // Drop empty production rows that somehow slip past the server gate.
        if (!(r.games > 0 || r.passAtt > 0 || r.rushAtt > 0 || r.recTgt > 0 || r.passTd > 0 || r.rushTd > 0 || r.recTd > 0)) {
          return false;
        }
        const own: Ownership = myOwnedIds.has(r.id)
          ? "roster"
          : rosteredIds.has(r.id)
            ? "taken"
            : "available";
        if (own === "roster" && !showRoster) return false;
        if (own === "taken" && !showTaken) return false;
        if (own === "available" && !showAvailable) return false;
        if (!needle) return true;
        return r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle);
      })
      .map((r) => {
        const ownership: Ownership = myOwnedIds.has(r.id)
          ? "roster"
          : rosteredIds.has(r.id)
            ? "taken"
            : "available";
        const badge = injuryMicroBadge(resolveInjuryStatus(playerById.get(r.id) ?? { id: r.id }, brain));
        const sleeper = playerById.get(r.id);
        const team = (sleeper?.team ?? r.team)?.trim() || "FA";
        const bye = sleeper?.bye;
        const posLabel = r.pos === "DEF" ? "DST" : r.pos;
        const metaLine =
          bye != null && bye > 0 ? `${posLabel} · ${team} · Bye ${bye}` : `${posLabel} · ${team}`;
        const scored = redZoneFantasyPoints(r, scoringFormat);
        return {
          ...r,
          team,
          fpts: scored.fpts,
          fptsPerGame: scored.fptsPerGame,
          ownership,
          injuryLabel: badge?.label ?? null,
          injuryClass: badge?.className ?? null,
          metaLine,
          statRank: 0,
        };
      });

    const rankMetric = (row: EnrichedRedZoneRow): number | null => {
      if (effectiveKey === "player" || effectiveKey === "rank") return row.fpts;
      const value = sortValue(row, effectiveKey);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const ranks = competitionRanksByMetric(enriched, rankMetric, (row) => row.id);

    return enriched
      .map((row) => ({ ...row, statRank: ranks.get(row.id) ?? 0 }))
      .sort((a, b) => {
        const av = sortValue(a, effectiveKey);
        const bv = sortValue(b, effectiveKey);
        let cmp = 0;
        if (typeof av === "string" && typeof bv === "string") {
          cmp = av.localeCompare(bv);
        } else {
          cmp = Number(av) - Number(bv);
        }
        if (cmp !== 0) return effectiveDir === "asc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      });
  }, [
    payload?.rowsByPos,
    pos,
    deferredQ,
    showRoster,
    showTaken,
    showAvailable,
    myOwnedIds,
    rosteredIds,
    playerById,
    brain,
    sortKey,
    sortDir,
    scoringFormat,
  ]);

  const weekLabel =
    payload && payload.weeksTo > 0
      ? `Weeks ${payload.weeksFrom} to ${payload.weeksTo} (${payload.season}) · Inside ${payload.yardline}`
      : payload
        ? `Season ${payload.season} · Inside ${payload.yardline}`
        : "Loading red zone board…";

  const filterTriggerClass =
    "inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30";

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Red Zone <span className="text-primary">Stats</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">{weekLabel}</p>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">What is the Red Zone?</p>
        <p className="mt-1 leading-relaxed">
          Only plays that start inside the selected yard line ({`Inside ${yardline}`}) are counted —
          nothing farther upfield is included. Fantasy points use{" "}
          {scoringFormatLabel(scoringFormat)} scoring on that production only.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() =>
              startTransition(() => {
                setPos(tab);
                setSortKey("fpts");
                setSortDir("desc");
              })
            }
            className={cn(
              "rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
              pos === tab
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-between">
        <div className="flex flex-nowrap items-center gap-2">
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

          <ScoringFormatSelect
            value={scoringFormat}
            onChange={(next) => startTransition(() => setScoringFormat(next))}
          />

          <Select
            value={season}
            onValueChange={(v) => startTransition(() => setSeason(v))}
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

          <Select
            value={String(yardline)}
            onValueChange={(v) =>
              startTransition(() => setYardline(Number(v) as YardlineOpt))
            }
          >
            <SelectTrigger className="h-9 w-[8.5rem] shrink-0 border-slate-200 bg-white shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YARDLINE_OPTS.map((yl) => (
                <SelectItem key={yl} value={String(yl)}>
                  Inside {yl}
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
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-64"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {pos === "QB" ? (
          <QbTable
            rows={rows}
            loading={query.isLoading}
            error={query.isError}
            onOpen={openPlayer}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        ) : (
          <SkillTable
            rows={rows}
            loading={query.isLoading}
            error={query.isError}
            onOpen={openPlayer}
            receivingFirst={pos === "WR" || pos === "TE"}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}
      </div>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

function MiscHeaders({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: RedZoneSortKey | null;
  sortDir: SortDir;
  onSort: (key: RedZoneSortKey) => void;
}) {
  const cols: { key: RedZoneSortKey; label: string }[] = [
    { key: "fumLost", label: "Fl" },
    { key: "games", label: "G" },
    { key: "fpts", label: "Fpts" },
    { key: "fptsPerGame", label: "Fpts/G" },
    { key: "rostPct", label: "Rost %" },
  ];
  return (
    <>
      {cols.map((col, i) => (
        <th
          key={col.key}
          className={cn(
            "px-1.5 py-1.5 text-center",
            i === 0 ? "border-l border-slate-100" : "",
            col.key === "fpts" ? "text-slate-700" : "",
          )}
        >
          <SortHeaderButton
            label={col.label}
            active={sortKey === col.key}
            dir={sortDir}
            onClick={() => onSort(col.key)}
          />
        </th>
      ))}
    </>
  );
}

function MiscCells({
  row,
  rostPct,
}: {
  row: RedZonePlayerRow;
  rostPct: number | null;
}) {
  return (
    <>
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums">
        {row.fumLost}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.games}</td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums text-slate-900">
        {row.fpts.toFixed(2)}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-600">
        {row.fptsPerGame.toFixed(2)}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {rostPct != null ? `${Math.round(rostPct)}%` : "—"}
      </td>
    </>
  );
}

const RedZonePlayerCell = memo(function RedZonePlayerCell({
  row,
  onOpen,
}: {
  row: EnrichedRedZoneRow;
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

/** Window-scrolled virtual table — sticky header, no nested page scrollbar. */
function VirtualizedRedZoneTable({
  minWidth,
  colSpan,
  header,
  rows,
  loading,
  error,
  renderRow,
}: {
  minWidth: string;
  colSpan: number;
  header: ReactNode;
  rows: EnrichedRedZoneRow[];
  loading: boolean;
  error: boolean;
  renderRow: (row: EnrichedRedZoneRow, displayRank: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const ready = !loading && !error && rows.length > 0;

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
    estimateSize: () => REDZONE_ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? Math.max(0, items[0]!.start - scrollMargin) : 0;
  const paddingBottom =
    items.length > 0
      ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1]!.end - scrollMargin))
      : 0;

  return (
    <div ref={listRef} className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", minWidth)}>
        <thead className="sticky top-0 z-10">{header}</thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                Loading red zone stats…
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-rose-600">
                Could not load red zone stats. Try again shortly.
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                No red zone stats match the current filters.
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
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-slate-100",
                      OWNERSHIP_META[row.ownership].row,
                    )}
                  >
                    {renderRow(row, row.statRank)}
                  </tr>
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
  );
}

function SortTh({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  className,
  align = "center",
}: {
  label: string;
  sortKey: RedZoneSortKey;
  activeKey: RedZoneSortKey | null;
  sortDir: SortDir;
  onSort: (key: RedZoneSortKey) => void;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <th className={className}>
      <SortHeaderButton
        label={label}
        active={activeKey === sortKey}
        dir={sortDir}
        onClick={() => onSort(sortKey)}
        align={align}
      />
    </th>
  );
}

function QbTable({
  rows,
  loading,
  error,
  onOpen,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: EnrichedRedZoneRow[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
  sortKey: RedZoneSortKey | null;
  sortDir: SortDir;
  onSort: (key: RedZoneSortKey) => void;
}) {
  const colSpan = 19;
  const passCols: { key: RedZoneSortKey; label: string }[] = [
    { key: "passCmp", label: "Comp" },
    { key: "passAtt", label: "Att" },
    { key: "passPct", label: "Pct" },
    { key: "passYds", label: "Yds" },
    { key: "passYa", label: "Y/A" },
    { key: "passTd", label: "Td" },
    { key: "passInt", label: "Int" },
    { key: "passSack", label: "Sk" },
  ];
  const rushCols: { key: RedZoneSortKey; label: string }[] = [
    { key: "rushAtt", label: "Att" },
    { key: "rushYds", label: "Yds" },
    { key: "rushTd", label: "Td" },
    { key: "rushPct", label: "Pct" },
  ];
  const header = (
    <>
      <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
        <th colSpan={2} className="px-3 py-2" aria-hidden="true" />
        <th colSpan={8} className={PLAYER_LIST_GROUP_TH}>
          Passing
        </th>
        <th colSpan={4} className={PLAYER_LIST_GROUP_TH}>
          Rushing
        </th>
        <th colSpan={5} className={PLAYER_LIST_GROUP_TH}>
          Misc
        </th>
      </tr>
      <tr className={PLAYER_LIST_COL_HEADER_ROW}>
        <SortTh
          label="Rk"
          sortKey="rank"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="px-2 py-1.5 text-center"
        />
        <SortTh
          label="Player"
          sortKey="player"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="px-2 py-1.5 text-left"
          align="left"
        />
        {passCols.map((col, i) => (
          <SortTh
            key={col.key}
            label={col.label}
            sortKey={col.key}
            activeKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            className={cn(
              "px-1.5 py-1.5 text-center",
              i === 0 ? "border-l border-slate-100" : "",
            )}
          />
        ))}
        {rushCols.map((col, i) => (
          <SortTh
            key={col.key}
            label={col.label}
            sortKey={col.key}
            activeKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            className={cn(
              "px-1.5 py-1.5 text-center",
              i === 0 ? "border-l border-slate-100" : "",
            )}
          />
        ))}
        <MiscHeaders sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </tr>
    </>
  );

  return (
    <VirtualizedRedZoneTable
      minWidth="min-w-[1080px]"
      colSpan={colSpan}
      header={header}
      rows={rows}
      loading={loading}
      error={error}
      renderRow={(row, displayRank) => (
        <QbRowCells row={row} displayRank={displayRank} onOpen={onOpen} />
      )}
    />
  );
}

const QbRowCells = memo(function QbRowCells({
  row,
  displayRank,
  onOpen,
}: {
  row: EnrichedRedZoneRow;
  displayRank: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{displayRank}</td>
      <td className="px-2 py-2.5">
        <RedZonePlayerCell row={row} onOpen={onOpen} />
      </td>
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums">
        {row.passCmp}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.passAtt}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {pct(row.passCmp, row.passAtt)}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.passYds}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {ya(row.passYds, row.passAtt)}
      </td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums">{row.passTd}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.passInt}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.passSack}</td>
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums">
        {row.rushAtt}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.rushYds}</td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums">{row.rushTd}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {row.rushPct > 0 ? `${row.rushPct.toFixed(1)}%` : "—"}
      </td>
      <MiscCells row={row} rostPct={row.rostPct} />
    </>
  );
});

function SkillTable({
  rows,
  loading,
  error,
  onOpen,
  receivingFirst,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: EnrichedRedZoneRow[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
  receivingFirst: boolean;
  sortKey: RedZoneSortKey | null;
  sortDir: SortDir;
  onSort: (key: RedZoneSortKey) => void;
}) {
  const colSpan = 18;

  const rushGroupHeader = (
    <th colSpan={5} className={PLAYER_LIST_GROUP_TH}>
      Rushing
    </th>
  );
  const recGroupHeader = (
    <th colSpan={6} className={PLAYER_LIST_GROUP_TH}>
      Receiving
    </th>
  );
  const rushCols: { key: RedZoneSortKey; label: string }[] = [
    { key: "rushAtt", label: "Att" },
    { key: "rushYds", label: "Yds" },
    { key: "rushYa", label: "Y/A" },
    { key: "rushTd", label: "Td" },
    { key: "rushPct", label: "Pct" },
  ];
  const recCols: { key: RedZoneSortKey; label: string }[] = [
    { key: "rec", label: "Rec" },
    { key: "recTgt", label: "Tgt" },
    { key: "recYds", label: "Yds" },
    { key: "recYr", label: "Y/R" },
    { key: "recTd", label: "Td" },
    { key: "tgtPct", label: "Tgt%" },
  ];
  const rushSubHeaders = rushCols.map((col, i) => (
    <SortTh
      key={col.key}
      label={col.label}
      sortKey={col.key}
      activeKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      className={cn("px-1.5 py-1.5 text-center", i === 0 ? "border-l border-slate-100" : "")}
    />
  ));
  const recSubHeaders = recCols.map((col, i) => (
    <SortTh
      key={col.key}
      label={col.label}
      sortKey={col.key}
      activeKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      className={cn("px-1.5 py-1.5 text-center", i === 0 ? "border-l border-slate-100" : "")}
    />
  ));

  const header = (
    <>
      <tr className={PLAYER_LIST_GROUP_HEADER_ROW}>
        <th colSpan={2} className="px-3 py-2" aria-hidden="true" />
        {receivingFirst ? (
          <>
            {recGroupHeader}
            {rushGroupHeader}
          </>
        ) : (
          <>
            {rushGroupHeader}
            {recGroupHeader}
          </>
        )}
        <th colSpan={5} className={PLAYER_LIST_GROUP_TH}>
          Misc
        </th>
      </tr>
      <tr className={PLAYER_LIST_COL_HEADER_ROW}>
        <SortTh
          label="Rk"
          sortKey="rank"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="px-2 py-1.5 text-center"
        />
        <SortTh
          label="Player"
          sortKey="player"
          activeKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          className="px-2 py-1.5 text-left"
          align="left"
        />
        {receivingFirst ? (
          <>
            {recSubHeaders}
            {rushSubHeaders}
          </>
        ) : (
          <>
            {rushSubHeaders}
            {recSubHeaders}
          </>
        )}
        <MiscHeaders sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </tr>
    </>
  );

  return (
    <VirtualizedRedZoneTable
      minWidth="min-w-[1120px]"
      colSpan={colSpan}
      header={header}
      rows={rows}
      loading={loading}
      error={error}
      renderRow={(row, displayRank) => (
        <SkillRowCells
          row={row}
          displayRank={displayRank}
          onOpen={onOpen}
          receivingFirst={receivingFirst}
        />
      )}
    />
  );
}

const SkillRowCells = memo(function SkillRowCells({
  row,
  displayRank,
  onOpen,
  receivingFirst,
}: {
  row: EnrichedRedZoneRow;
  displayRank: number;
  onOpen: (id: string) => void;
  receivingFirst: boolean;
}) {
  const rushCells = (
    <>
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums">
        {row.rushAtt}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.rushYds}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {ya(row.rushYds, row.rushAtt)}
      </td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums">{row.rushTd}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {row.rushAtt > 0 ? `${row.rushPct.toFixed(1)}%` : "—"}
      </td>
    </>
  );
  const recCells = (
    <>
      <td className="border-l border-slate-100 px-1.5 py-2.5 text-center tabular-nums">
        {row.rec}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.recTgt}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums">{row.recYds}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {ya(row.recYds, row.rec)}
      </td>
      <td className="px-1.5 py-2.5 text-center font-semibold tabular-nums">{row.recTd}</td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {row.tgtPct > 0 ? `${row.tgtPct.toFixed(1)}%` : "—"}
      </td>
    </>
  );

  return (
    <>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{displayRank}</td>
      <td className="px-2 py-2.5">
        <RedZonePlayerCell row={row} onOpen={onOpen} />
      </td>
      {receivingFirst ? (
        <>
          {recCells}
          {rushCells}
        </>
      ) : (
        <>
          {rushCells}
          {recCells}
        </>
      )}
      <MiscCells row={row} rostPct={row.rostPct} />
    </>
  );
});

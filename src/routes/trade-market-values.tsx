import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import {
  ScoringFormatSelect,
  scoringFormatLabel,
  useResearchScoringFormat,
} from "@/components/research/ScoringFormatSelect";
import { ResearchTableSkeleton } from "@/components/research/ResearchTableSkeleton";
import {
  nextSortState,
  PLAYER_LIST_HEADER_ROW,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
import { ValueTrendCell } from "@/components/research/ValueTrendCell";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { fetchMarketHistoryClient } from "@/lib/market-history-client";
import { usePrefetchSiblingFormats } from "@/lib/prefetch-research-formats";
import { fetchSnapTradeMarket } from "@/lib/snap-cdn";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { scaleValue } from "@/lib/trade-engine";
import {
  classifyTradeTargets,
  pointsPerGame,
  ppgRanks,
  type MarketFormat,
  type MarketPos,
  type MarketRow,
  type OpportunityRow,
  type TargetKind,
  type TradeTarget,
} from "@/lib/trade-market";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/trade-market-values")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trade Market Values — The League Office" },
      {
        name: "description",
        content:
          "Redraft trade market values built from real trades, with Buy Low and Sell High targets graded on opportunity against production.",
      },
    ],
  }),
  component: TradeMarketRoute,
});

type PosFilter = "ALL" | MarketPos;
type TargetView = "all" | TargetKind;
type Ownership = "roster" | "taken" | "available";
type SortKey = "player" | "value" | "freq" | "opp" | "ppg" | "gap";

const POS_TABS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE"];
const TARGET_VIEWS: { id: TargetView; label: string }[] = [
  { id: "all", label: "All Players" },
  { id: "buy", label: "Buy Low" },
  { id: "sell", label: "Sell High" },
];

const OWNERSHIP_META: Record<Ownership, { label: string; row: string }> = {
  roster: { label: "Rostered", row: "bg-sky-50/90" },
  taken: { label: "Taken", row: "bg-white" },
  available: { label: "Available", row: "bg-emerald-50/80" },
};

const TARGET_COPY: Record<TargetKind, { title: string; tag: string; tone: string; body: string }> = {
  buy: {
    title: "Buy Low Trade Targets",
    tag: "Opportunity, No Points",
    tone: "text-amber-600",
    body: "The role is there and the points aren't yet. Among the fantasy-relevant players at their position, these rank in the top 40% in opportunity but the bottom 40% in points per game, sorted by how many spots separate the two ranks.",
  },
  sell: {
    title: "Sell High Trade Targets",
    tag: "Points on Little Opportunity",
    tone: "text-sky-600",
    body: "The fantasy points are there, but the underlying opportunity hasn't kept pace. Among the fantasy-relevant players at their position, these rank in the top 40% in points per game but the bottom 40% in opportunity, so their value may be elevated.",
  },
};

type EnrichedRow = MarketRow & {
  ownership: Ownership;
  injuryLabel: string | null;
  injuryClass: string | null;
  metaLine: string;
  displayValue: number;
  opp: OpportunityRow | null;
  ppg: number | null;
  ppgRank: number | null;
  target: TradeTarget | null;
  rank: number;
};

function TradeMarketRoute() {
  const { activeLeagueId } = useActiveLeague();
  return (
    <PlaybookShell section="trade">
      <TradeMarketPage key={activeLeagueId ?? "none"} />
    </PlaybookShell>
  );
}

function TradeMarketPage() {
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [view, setView] = useState<TargetView>("all");
  const [q, setQ] = useState("");
  const [deferredQ, setDeferredQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDeferredQ(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { format: leagueFormat } = useLeagueScoringMeta();
  const { format, setFormat } = useResearchScoringFormat(leagueFormat);

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const brain = usePlayerBrain();
  const playerById = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);
  const { myTeam, rosteredIds } = useLeagueRosters(players);
  const myOwnedIds = useMemo(
    () => new Set((myTeam?.players ?? []).map((p) => p.id)),
    [myTeam?.players],
  );

  const query = useQuery({
    queryKey: ["trade-market", format],
    staleTime: 60 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: () => fetchSnapTradeMarket(format),
  });
  usePrefetchSiblingFormats("trade-market", format, { enabled: Boolean(query.data) });
  const payload = query.data;

  const { oppById, ppgRankById, targets } = useMemo(() => {
    const pool = payload?.opportunity ?? [];
    const oppMap = new Map(pool.map((o) => [o.id, o]));
    const ppgMap = ppgRanks(pool, format as MarketFormat);
    return {
      oppById: oppMap,
      ppgRankById: ppgMap,
      targets: classifyTradeTargets(payload?.rows ?? [], oppMap, ppgMap, format as MarketFormat),
    };
  }, [payload, format]);

  const rows = useMemo((): EnrichedRow[] => {
    const needle = deferredQ.trim().toLowerCase();
    const base = (payload?.rows ?? [])
      .filter((r) => (pos === "ALL" ? true : r.pos === pos))
      .filter((r) => (view === "all" ? true : targets.get(r.id)?.kind === view))
      .map((r): Omit<EnrichedRow, "rank"> => {
        const ownership: Ownership = myOwnedIds.has(r.id)
          ? "roster"
          : rosteredIds.has(r.id)
            ? "taken"
            : "available";
        const sleeper = playerById.get(r.id);
        const badge = injuryMicroBadge(resolveInjuryStatus(sleeper ?? { id: r.id }, brain));
        const team = (sleeper?.team ?? r.team)?.trim() || "FA";
        const bye = sleeper?.bye;
        const opp = oppById.get(r.id) ?? null;
        return {
          ...r,
          team,
          ownership,
          injuryLabel: badge?.label ?? null,
          injuryClass: badge?.className ?? null,
          metaLine: bye != null && bye > 0 ? `${r.pos} · ${team} · Bye ${bye}` : `${r.pos} · ${team}`,
          displayValue: scaleValue(r.value),
          opp,
          ppg: opp ? Math.round(pointsPerGame(opp, format as MarketFormat) * 10) / 10 : null,
          ppgRank: ppgRankById.get(r.id) ?? null,
          target: targets.get(r.id) ?? null,
        };
      });

    const defaultOrder = [...base].sort((a, b) =>
      view === "all"
        ? b.value - a.value
        : (b.target?.spotsApart ?? 0) - (a.target?.spotsApart ?? 0) || b.value - a.value,
    );
    const rankById = new Map(defaultOrder.map((r, i) => [r.id, i + 1]));

    const metric = (r: Omit<EnrichedRow, "rank">, key: SortKey): number => {
      if (key === "value") return r.value;
      if (key === "freq") return r.tradeFrequency ?? -1;
      if (key === "opp") return r.opp?.score ?? -1;
      if (key === "ppg") return r.ppg ?? -1;
      if (key === "gap") return r.target?.spotsApart ?? -1;
      return 0;
    };

    const sorted =
      sortKey == null
        ? defaultOrder
        : [...base].sort((a, b) => {
            const cmp =
              sortKey === "player" ? a.name.localeCompare(b.name) : metric(a, sortKey) - metric(b, sortKey);
            if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
            return b.value - a.value;
          });

    return sorted
      .filter((r) => {
        if (r.ownership === "roster" && !showRoster) return false;
        if (r.ownership === "taken" && !showTaken) return false;
        if (r.ownership === "available" && !showAvailable) return false;
        if (!needle) return true;
        return (
          r.name.toLowerCase().includes(needle) ||
          r.team.toLowerCase().includes(needle) ||
          r.pos.toLowerCase().includes(needle)
        );
      })
      .map((r) => ({ ...r, rank: rankById.get(r.id) ?? 0 }));
  }, [
    payload?.rows,
    pos,
    view,
    targets,
    deferredQ,
    showRoster,
    showTaken,
    showAvailable,
    myOwnedIds,
    rosteredIds,
    playerById,
    brain,
    oppById,
    ppgRankById,
    format,
    sortKey,
    sortDir,
  ]);

  const maxFreq = useMemo(
    () => Math.max(0.0001, ...(payload?.rows ?? []).map((r) => r.tradeFrequency ?? 0)),
    [payload?.rows],
  );

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "player" ? "asc" : "desc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const changeView = (next: TargetView) =>
    startTransition(() => {
      setView(next);
      setSortKey(null);
      setSortDir("desc");
    });

  const filterTriggerClass =
    "inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30";

  const showGap = view !== "all";
  const colSpan = showGap ? 8 : 7;
  const copy = view === "all" ? null : TARGET_COPY[view];

  return (
    <div className="w-full pb-8">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Trade Market <span className="text-primary">Values</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {payload?.season ?? ""} redraft market value from real trades across fantasy platforms in{" "}
          {scoringFormatLabel(format)} leagues.
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

      <div className="mb-4">
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
                    onCheckedChange={(checked) => startTransition(() => setOn(Boolean(checked)))}
                    onSelect={(e) => e.preventDefault()}
                    className={cn("rounded-sm", on ? meta.row : undefined)}
                  >
                    {meta.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <ScoringFormatSelect value={format} onChange={(f) => startTransition(() => setFormat(f))} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex flex-wrap gap-1">
          {TARGET_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeView(item.id)}
              className={cn(
                "px-3 py-2 text-sm font-semibold transition-colors",
                view === item.id
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-blue-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="w-full pb-2 sm:w-auto">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search players"
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-72"
          />
        </div>
      </div>

      {copy ? (
        <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">
            {copy.title} <span className={cn("ml-1 text-xs font-bold", copy.tone)}>{copy.tag}</span>
          </p>
          <p className="mt-1 leading-relaxed">{copy.body}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Opportunity is graded 1 to 99 within each position from season usage: targets, air yards,
            snap share, target and air-yard share, and red-zone looks for pass catchers; carries plus
            targets, snap share and red-zone touches for running backs; pass attempts, rushing attempts
            and red-zone plays for quarterbacks. Cut lines sit at the 40th and 60th percentile of the
            top market-valued players at each position.
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="w-12 px-2 py-1.5 text-center">Rk</th>
                <th className="px-3 py-1.5 text-left">
                  <SortHeaderButton
                    label="Player"
                    active={sortKey === "player"}
                    dir={sortDir}
                    onClick={() => toggleSort("player")}
                    align="left"
                  />
                </th>
                <th className="w-40 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Value / Trend"
                    active={sortKey === "value"}
                    dir={sortDir}
                    onClick={() => toggleSort("value")}
                  />
                </th>
                <th className="w-36 px-2 py-1.5 text-center">Market History</th>
                <th className="w-32 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Trade Freq"
                    active={sortKey === "freq"}
                    dir={sortDir}
                    onClick={() => toggleSort("freq")}
                  />
                </th>
                <th className="w-28 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Opportunity"
                    active={sortKey === "opp"}
                    dir={sortDir}
                    onClick={() => toggleSort("opp")}
                  />
                </th>
                <th className="w-24 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="PPG"
                    active={sortKey === "ppg"}
                    dir={sortDir}
                    onClick={() => toggleSort("ppg")}
                  />
                </th>
                {showGap ? (
                  <th className="w-28 px-2 py-1.5 text-center">
                    <SortHeaderButton
                      label="Spots Apart"
                      active={sortKey === "gap"}
                      dir={sortDir}
                      onClick={() => toggleSort("gap")}
                    />
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <ResearchTableSkeleton rows={12} cols={colSpan} />
              ) : query.isError ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-rose-600">
                    Could not load market values. Try again shortly.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    {view === "all"
                      ? "No players match the current filters."
                      : `No ${view === "buy" ? "Buy Low" : "Sell High"} targets match the current filters.`}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <MarketRowView
                    key={row.id}
                    row={row}
                    zebra={i % 2 === 1}
                    format={format as MarketFormat}
                    maxFreq={maxFreq}
                    showGap={showGap}
                    onOpen={openPlayer}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Market values and trade frequency come from FantasyCalc, which tracks real redraft trades across
        Sleeper, MFL, Fleaflicker and ESPN leagues. Trade Freq is the share of recent trades that include
        the player.
      </p>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

const MarketRowView = memo(function MarketRowView({
  row,
  zebra,
  format,
  maxFreq,
  showGap,
  onOpen,
}: {
  row: EnrichedRow;
  zebra: boolean;
  format: MarketFormat;
  maxFreq: number;
  showGap: boolean;
  onOpen: (id: string) => void;
}) {
  const ownTone = OWNERSHIP_META[row.ownership].row;
  const tone = row.ownership === "taken" && zebra ? "bg-slate-50/50" : ownTone;
  const freq = row.tradeFrequency;

  return (
    <tr className={cn("border-b border-slate-100", tone)}>
      <td className="px-2 py-2.5 text-center text-sm tabular-nums text-slate-500">{row.rank}</td>
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
      <td className="px-2 py-2.5 text-center">
        <ValueTrendCell value={row.displayValue} trend={row.trend30} />
      </td>
      <td className="px-2 py-2.5">
        <MarketSparkline fcId={row.fcId} format={format} />
      </td>
      <td className="px-2 py-2.5">
        {freq != null ? (
          <div className="flex items-center justify-center gap-2">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-blue-500"
                style={{ width: `${Math.max(4, Math.min(100, (freq / maxFreq) * 100))}%` }}
              />
            </span>
            <span className="w-12 text-right text-xs tabular-nums text-slate-600">
              {(freq * 100).toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="block text-center text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-center">
        {row.opp ? (
          <>
            <span className="block font-semibold tabular-nums text-slate-900">{row.opp.score}</span>
            <span className="block text-[10px] font-medium uppercase text-slate-400">
              {row.pos}
              {row.opp.rank}
            </span>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-center">
        {row.ppg != null ? (
          <>
            <span className="block font-semibold tabular-nums text-slate-900">{row.ppg.toFixed(1)}</span>
            {row.ppgRank != null ? (
              <span className="block text-[10px] font-medium uppercase text-slate-400">
                {row.pos}
                {row.ppgRank}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      {showGap ? (
        <td className="px-2 py-2.5 text-center">
          {row.target ? (
            <span
              className={cn(
                "font-bold tabular-nums",
                row.target.kind === "buy" ? "text-amber-600" : "text-sky-600",
              )}
            >
              {row.target.spotsApart}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
      ) : null}
    </tr>
  );
});

/** 30-day value line; only fetches once the row scrolls into view. */
function MarketSparkline({ fcId, format }: { fcId: number; format: MarketFormat }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const history = useQuery({
    queryKey: ["market-history", fcId, format],
    enabled: seen,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => 1000 * (attempt + 1),
    queryFn: () => fetchMarketHistoryClient(fcId, format),
  });

  const points = history.data ?? [];
  const width = 104;
  const height = 26;
  let body: ReactNode = <span className="block h-[26px] w-[104px] rounded bg-slate-50" />;

  if (points.length >= 2) {
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const coords = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return [x, y] as const;
    });
    const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const first = values[0]!;
    const last = values[values.length - 1]!;
    const change = first > 0 ? (last - first) / first : 0;
    const color = change > 0.01 ? "#059669" : change < -0.01 ? "#e11d48" : "#64748b";
    const fill = change > 0.01 ? "#d1fae5" : change < -0.01 ? "#ffe4e6" : "#f1f5f9";
    body = (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`30-day market value ${change >= 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(1)}%`}
      >
        <polygon points={`0,${height} ${line} ${width},${height}`} fill={fill} opacity={0.7} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    );
  } else if (history.isFetched) {
    body = <span className="text-slate-300">—</span>;
  }

  return (
    <div ref={ref} className="flex justify-center">
      {body}
    </div>
  );
}

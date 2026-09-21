import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
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
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getRedZoneStats } from "@/lib/players.functions";
import type { RedZonePlayerRow, RedZonePos } from "@/lib/redzone";
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
const MISC_HEADERS = ["Fl", "G", "Fpts", "Fpts/G", "Rost %"] as const;
const YARDLINE_OPTS = [5, 10, 15, 20] as const;
type YardlineOpt = (typeof YARDLINE_OPTS)[number];

function seasonOptions(): string[] {
  const current = new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  return Array.from({ length: 5 }, (_, i) => String(current - i));
}

type Ownership = "roster" | "taken" | "available";

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
  const [season, setSeason] = useState(seasons[0] ?? String(new Date().getFullYear()));
  const [yardline, setYardline] = useState<YardlineOpt>(20);
  const [showRoster, setShowRoster] = useState(true);
  const [showTaken, setShowTaken] = useState(true);
  const [showAvailable, setShowAvailable] = useState(true);
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { myTeam, rosteredIds } = useLeagueRosters(players);

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

  const query = useQuery({
    queryKey: ["red-zone-stats", season, yardline],
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: () => getRedZoneStats({ data: { season, yardline } }),
  });

  const payload = query.data;
  const rows = useMemo(() => {
    const list = payload?.rowsByPos?.[pos] ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((r) => {
      const own = ownershipOf(r.id);
      if (own === "roster" && !showRoster) return false;
      if (own === "taken" && !showTaken) return false;
      if (own === "available" && !showAvailable) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.team.toLowerCase().includes(needle)
      );
    });
  }, [
    payload?.rowsByPos,
    pos,
    q,
    showRoster,
    showTaken,
    showAvailable,
    myOwnedIds,
    rosteredIds,
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
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl">
          Red Zone Stats
        </h1>
        <p className="mt-1 text-sm text-slate-500">{weekLabel}</p>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">What is the Red Zone?</p>
        <p className="mt-1 leading-relaxed">
          Only plays that start inside the selected yard line ({`Inside ${yardline}`}) are counted —
          nothing farther upfield is included. Fantasy points use half-PPR scoring on that
          production only.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {POS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setPos(tab)}
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
                    onCheckedChange={(checked) => setOn(Boolean(checked))}
                    onSelect={(e) => e.preventDefault()}
                    className={cn("rounded-sm", on ? meta.row : undefined)}
                  >
                    {meta.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={season} onValueChange={setSeason}>
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
            value={String(yardline)}
            onValueChange={(v) => setYardline(Number(v) as YardlineOpt)}
          >
            <SelectTrigger className="h-9 w-[8.5rem] border-slate-200 bg-white shadow-none">
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
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {pos === "QB" ? (
            <QbTable
              rows={rows}
              loading={query.isLoading}
              error={query.isError}
              onOpen={openPlayer}
              ownershipOf={ownershipOf}
            />
          ) : (
            <SkillTable
              rows={rows}
              loading={query.isLoading}
              error={query.isError}
              onOpen={openPlayer}
              receivingFirst={pos === "WR" || pos === "TE"}
              ownershipOf={ownershipOf}
            />
          )}
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

function MiscHeaders() {
  return (
    <>
      {MISC_HEADERS.map((h, i) => (
        <th
          key={h}
          className={cn(
            "px-1.5 py-1.5 text-center",
            i === 0 ? "border-l border-slate-100" : "",
            h === "Fpts" ? "text-slate-700" : "",
          )}
        >
          {h === "Fpts" ? (
            <span className="inline-flex items-center gap-0.5">
              Fpts
              <span aria-hidden="true" className="text-[9px]">
                ▼
              </span>
            </span>
          ) : (
            h
          )}
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
        {row.fpts.toFixed(1)}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-600">
        {row.fptsPerGame.toFixed(1)}
      </td>
      <td className="px-1.5 py-2.5 text-center tabular-nums text-slate-500">
        {rostPct != null ? `${Math.round(rostPct)}%` : "—"}
      </td>
    </>
  );
}

function PlayerCell({
  row,
  onOpen,
}: {
  row: RedZonePlayerRow;
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
        <span className="block truncate font-semibold text-blue-700">{row.name}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
          {row.team || "FA"}
        </span>
      </span>
    </button>
  );
}

function QbTable({
  rows,
  loading,
  error,
  onOpen,
  ownershipOf,
}: {
  rows: RedZonePlayerRow[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
  ownershipOf: (id: string) => Ownership;
}) {
  const colSpan = 19;
  return (
    <table className="w-full min-w-[1080px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <th colSpan={2} className="px-3 py-2 text-left">
            Players
          </th>
          <th colSpan={8} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
            Passing
          </th>
          <th colSpan={4} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
            Rushing
          </th>
          <th colSpan={5} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
            Misc
          </th>
        </tr>
        <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-black uppercase tracking-wider text-slate-500">
          <th className="px-2 py-1.5 text-center">Rk</th>
          <th className="px-2 py-1.5 text-left">Player</th>
          {["Comp", "Att", "Pct", "Yds", "Y/A", "Td", "Int", "Sk"].map((h) => (
            <th key={h} className="border-l border-slate-100 px-1.5 py-1.5 text-center">
              {h}
            </th>
          ))}
          {["Att", "Yds", "Td", "Pct"].map((h) => (
            <th key={`r-${h}`} className="border-l border-slate-100 px-1.5 py-1.5 text-center">
              {h}
            </th>
          ))}
          <MiscHeaders />
        </tr>
      </thead>
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
          rows.map((row) => {
            const own = ownershipOf(row.id);
            const rowTone = OWNERSHIP_META[own].row;
            return (
              <tr key={row.id} className={cn("border-b border-slate-100", rowTone)}>
                <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{row.rank}</td>
                <td className="px-2 py-2.5">
                  <PlayerCell row={row} onOpen={onOpen} />
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
                <MiscCells
                  row={row}
                  rostPct={row.rostPct}
                />
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function SkillTable({
  rows,
  loading,
  error,
  onOpen,
  receivingFirst,
  ownershipOf,
}: {
  rows: RedZonePlayerRow[];
  loading: boolean;
  error: boolean;
  onOpen: (id: string) => void;
  receivingFirst: boolean;
  ownershipOf: (id: string) => Ownership;
}) {
  const colSpan = 18;

  const rushGroupHeader = (
    <th colSpan={5} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
      Rushing
    </th>
  );
  const recGroupHeader = (
    <th colSpan={6} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
      Receiving
    </th>
  );
  const rushSubHeaders = ["Att", "Yds", "Y/A", "Td", "Pct"].map((h) => (
    <th key={`rush-${h}`} className="border-l border-slate-100 px-1.5 py-1.5 text-center">
      {h}
    </th>
  ));
  const recSubHeaders = ["Rec", "Tgt", "Yds", "Y/R", "Td", "Tgt%"].map((h) => (
    <th key={`rec-${h}`} className="border-l border-slate-100 px-1.5 py-1.5 text-center">
      {h}
    </th>
  ));

  const rushCells = (row: RedZonePlayerRow) => (
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
  const recCells = (row: RedZonePlayerRow) => (
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
    <table className="w-full min-w-[1120px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <th colSpan={2} className="px-3 py-2 text-left">
            Players
          </th>
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
          <th colSpan={5} className="border-l border-slate-200 px-2 py-2 text-center text-slate-700">
            Misc
          </th>
        </tr>
        <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-black uppercase tracking-wider text-slate-500">
          <th className="px-2 py-1.5 text-center">Rk</th>
          <th className="px-2 py-1.5 text-left">Player</th>
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
          <MiscHeaders />
        </tr>
      </thead>
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
          rows.map((row) => {
            const own = ownershipOf(row.id);
            const rowTone = OWNERSHIP_META[own].row;
            return (
              <tr key={row.id} className={cn("border-b border-slate-100", rowTone)}>
                <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{row.rank}</td>
                <td className="px-2 py-2.5">
                  <PlayerCell row={row} onOpen={onOpen} />
                </td>
                {receivingFirst ? (
                  <>
                    {recCells(row)}
                    {rushCells(row)}
                  </>
                ) : (
                  <>
                    {rushCells(row)}
                    {recCells(row)}
                  </>
                )}
                <MiscCells
                  row={row}
                  rostPct={row.rostPct}
                />
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

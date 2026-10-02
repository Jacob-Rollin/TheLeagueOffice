import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { memo, startTransition, useDeferredValue, useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  nextSortState,
  PLAYER_LIST_HEADER_ROW,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  chanceToPlay,
  designationFromStatus,
  normPlayerName as normName,
  practiceSummary,
  type InjuryReportLine,
} from "@/lib/are-they-playing";
import { currentSeason, fetchSchedule, type Player } from "@/lib/players-build";
import { getAreTheyPlaying, getLiveInjuryStatuses } from "@/lib/players.functions";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";
import { buildScheduleByTeam, formatOppLabel } from "@/lib/wire-matchups";

export const Route = createFileRoute("/are-they-playing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Are They Playing? — The League Office" },
      {
        name: "description",
        content:
          "The chance every injured fantasy player suits up this week, from official practice reports and game designations.",
      },
    ],
  }),
  component: AreTheyPlayingRoute,
});

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE";
type ChanceBand = "likely" | "uncertain" | "unlikely" | "pending";
type Ownership = "roster" | "taken" | "available";
type SortKey = "player" | "chance";

const POS_TABS: PosFilter[] = ["ALL", "QB", "RB", "WR", "TE"];

const BAND_META: Record<ChanceBand, { label: string; row: string }> = {
  likely: { label: "Likely (75% or higher)", row: "bg-emerald-50/80" },
  uncertain: { label: "Uncertain (35% to 74%)", row: "bg-amber-50/80" },
  unlikely: { label: "Unlikely (under 35%)", row: "bg-rose-50/80" },
  pending: { label: "Not yet graded", row: "bg-slate-50" },
};

const OWNERSHIP_META: Record<Ownership, { label: string; row: string }> = {
  roster: { label: "Rostered", row: "bg-sky-50/90" },
  taken: { label: "Taken", row: "bg-white" },
  available: { label: "Available", row: "bg-emerald-50/80" },
};

type Row = {
  key: string;
  line: InjuryReportLine;
  player: Player;
  /** Same status the player popup badge reads (Sleeper catalog). */
  injuryStatus: string | undefined;
  chance: number | null;
  band: ChanceBand;
  ownership: Ownership;
  opp: string;
  practice: string;
};

function bandOf(chance: number | null): ChanceBand {
  if (chance == null) return "pending";
  if (chance >= 75) return "likely";
  if (chance >= 35) return "uncertain";
  return "unlikely";
}

function shortInjury(injury: string | null): string | null {
  if (!injury) return null;
  return /not injury related|^nir\b/i.test(injury) ? "NIR" : injury;
}

function AreTheyPlayingRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <AreTheyPlayingPage key={activeLeagueId ?? "none"} />;
}

function AreTheyPlayingPage() {
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [band, setBand] = useState<ChanceBand | null>(null);
  const [owned, setOwned] = useState<Record<Ownership, boolean>>({
    roster: true,
    taken: true,
    available: true,
  });
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const nflState = useNflState();
  const nflWeek = nflState.data?.week ?? null;
  const week = nflWeek != null ? Math.min(18, Math.max(1, nflWeek)) : null;

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { myTeam, rosteredIds } = useLeagueRosters(players);
  const myOwnedIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam?.players]);

  const query = useQuery({
    queryKey: ["are-they-playing", week],
    enabled: week != null,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
    queryFn: () => getAreTheyPlaying({ data: { week: week ?? 1 } }),
  });

  const liveInjuries = useQuery({
    queryKey: ["live-injury-statuses"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
    queryFn: () => getLiveInjuryStatuses(),
  });

  const schedule = useQuery({
    queryKey: ["wire-schedule-sos", "v2-no-def-proj", currentSeason()],
    staleTime: 12 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => buildScheduleByTeam(await fetchSchedule(currentSeason())),
  });

  const playerIndex = useMemo(() => {
    const byNameTeam = new Map<string, Player>();
    const byLastTeamPos = new Map<string, Player[]>();
    for (const p of players) {
      const team = (p.team ?? "").toUpperCase();
      byNameTeam.set(`${normName(p.name)}|${team}`, p);
      const last = normName(p.name.split(" ").slice(-1)[0] ?? "");
      const key = `${last}|${team}|${p.pos}`;
      byLastTeamPos.set(key, [...(byLastTeamPos.get(key) ?? []), p]);
    }
    return { byNameTeam, byLastTeamPos };
  }, [players]);

  const allRows = useMemo((): Row[] => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const live = liveInjuries.data;
    for (const reportLine of query.data?.lines ?? []) {
      const exact = playerIndex.byNameTeam.get(`${normName(reportLine.name)}|${reportLine.team}`);
      const last = normName(reportLine.name.split(" ").slice(-1)[0] ?? "");
      const fuzzy = playerIndex.byLastTeamPos.get(`${last}|${reportLine.team}|${reportLine.pos}`);
      const player = exact ?? (fuzzy?.length === 1 ? fuzzy[0] : undefined);
      if (!player || seen.has(player.id)) continue;
      seen.add(player.id);
      const liveEntry = live?.[player.id];
      const injuryStatus = liveEntry
        ? resolveInjuryStatus({ id: player.id, injury_status: liveEntry.status })
        : resolveInjuryStatus(player);
      const line: InjuryReportLine = {
        ...reportLine,
        injury: shortInjury(
          reportLine.injury ?? liveEntry?.bodyPart ?? player.injury_body_part ?? null,
        ),
        gameStatus: reportLine.gameStatus ?? designationFromStatus(injuryStatus),
      };
      const chance = chanceToPlay(line);
      const games = schedule.data?.get(line.team) ?? [];
      const game = games.find((g) => g.week === week);
      out.push({
        key: `${player.id}-${line.team}`,
        line,
        player,
        injuryStatus,
        chance,
        band: bandOf(chance),
        ownership: myOwnedIds.has(player.id) ? "roster" : rosteredIds.has(player.id) ? "taken" : "available",
        opp: game ? formatOppLabel(game.opp, game.isAway) : schedule.data ? "BYE" : "—",
        practice: practiceSummary(line.days),
      });
    }
    return out;
  }, [query.data?.lines, liveInjuries.data, playerIndex, schedule.data, week, myOwnedIds, rosteredIds]);

  const rows = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (pos !== "ALL" && r.player.pos !== pos) return false;
      if ((band && r.band !== band) || !owned[r.ownership]) return false;
      if (!needle) return true;
      return (
        r.player.name.toLowerCase().includes(needle) ||
        r.line.team.toLowerCase().includes(needle) ||
        (r.line.injury ?? "").toLowerCase().includes(needle)
      );
    });
    const relevance = (r: Row) => r.player.rank?.half ?? 999;
    return filtered.sort((a, b) => {
      if (sortKey === "player") {
        const cmp = a.player.name.localeCompare(b.player.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "chance") {
        const cmp = (a.chance ?? -1) - (b.chance ?? -1);
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      }
      return relevance(a) - relevance(b);
    });
  }, [allRows, pos, band, owned, deferredQ, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "player" ? "asc" : "desc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const filterTriggerClass =
    "inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30";
  const updatedLabel = query.data?.updatedAt
    ? new Date(query.data.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;
  const colSpan = 5;

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Are They <span className="text-primary">Playing?</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The chance each injured player suits up {week != null ? `in Week ${week}` : "this week"}, from official
          practice reports and game designations.
        </p>
        {updatedLabel ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Updated {updatedLabel}
          </p>
        ) : null}
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">How Chance to Play works</p>
        <p className="mt-1 leading-relaxed">
          Once a team files its final report, the chance is how often players with the same game designation and
          final practice level actually played in the 2023 to 2025 regular seasons. Questionable players who were
          limited on the final day played about 65% of the time, and Doubtful players almost never did. Earlier in
          the week it is graded from the latest practice and whether participation is trending up or down.
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
              Chance to Play
              <ChevronDown className="size-4 opacity-50" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-1">
              {(Object.keys(BAND_META) as ChanceBand[]).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={band === key}
                  onCheckedChange={(checked) => startTransition(() => setBand(checked ? key : null))}
                  onSelect={(e) => e.preventDefault()}
                  className={cn("rounded-sm", band === key ? BAND_META[key].row : undefined)}
                >
                  {BAND_META[key].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={filterTriggerClass}>
              Availability
              <ChevronDown className="size-4 opacity-50" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 p-1">
              {(Object.keys(OWNERSHIP_META) as Ownership[]).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={owned[key]}
                  onCheckedChange={(checked) =>
                    startTransition(() => setOwned((prev) => ({ ...prev, [key]: Boolean(checked) })))
                  }
                  onSelect={(e) => e.preventDefault()}
                  className={cn("rounded-sm", owned[key] ? OWNERSHIP_META[key].row : undefined)}
                >
                  {OWNERSHIP_META[key].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="px-3 py-1.5 text-left">
                  <SortHeaderButton
                    label="Player"
                    active={sortKey === "player"}
                    dir={sortDir}
                    onClick={() => toggleSort("player")}
                    align="left"
                  />
                </th>
                <th className="w-32 px-2 py-1.5 text-center">
                  <SortHeaderButton
                    label="Chance to Play"
                    active={sortKey === "chance"}
                    dir={sortDir}
                    onClick={() => toggleSort("chance")}
                  />
                </th>
                <th className="w-40 px-2 py-1.5 text-center">Injury</th>
                <th className="w-28 px-2 py-1.5 text-center">Matchup</th>
                <th className="px-3 py-1.5 text-center">Practice Reports</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading || week == null ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    Loading official injury reports…
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-rose-600">
                    Could not load injury reports. Try again shortly.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
                    {allRows.length === 0
                      ? `No official injury reports have been filed for Week ${week} yet. Teams usually post their first report Wednesday afternoon.`
                      : "No players match the current filters."}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <PlayingRow key={row.key} row={row} zebra={i % 2 === 1} onOpen={openPlayer} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Practice participation and designations come from each team&apos;s official injury report, filled in from
        ESPN injury news until the official report posts. DNP = did not participate, LP = limited, FP = full
        participation, Healthy = not on that day&apos;s report.
      </p>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

const PlayingRow = memo(function PlayingRow({
  row,
  zebra,
  onOpen,
}: {
  row: Row;
  zebra: boolean;
  onOpen: (id: string) => void;
}) {
  const { player, line } = row;
  const tone =
    row.ownership === "roster" ? OWNERSHIP_META.roster.row : zebra ? "bg-slate-50/50" : "bg-white";
  const badge = injuryMicroBadge(row.injuryStatus);
  const posLabel = player.pos;

  return (
    <tr className={cn("border-b border-slate-100", tone)}>
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
              {badge ? (
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[2px] text-[9px] font-bold text-white",
                    badge.className,
                  )}
                  title={row.injuryStatus}
                >
                  {badge.label}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
              {posLabel} · {line.team}
            </span>
          </span>
        </button>
      </td>
      <td className="px-2 py-2.5">
        <div className="flex justify-center">
          <ChanceRing chance={row.chance} />
        </div>
      </td>
      <td className="px-2 py-2.5 text-center text-sm text-slate-700">{line.injury ?? "—"}</td>
      <td className="px-2 py-2.5 text-center text-sm font-semibold uppercase text-slate-800">{row.opp}</td>
      <td className="px-3 py-2.5 text-center text-sm text-slate-700">{row.practice || "—"}</td>
    </tr>
  );
});

function ChanceRing({ chance }: { chance: number | null }) {
  const size = 40;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = chance ?? 0;
  const color = chance == null ? "#cbd5e1" : chance >= 75 ? "#059669" : chance >= 35 ? "#d97706" : "#e11d48";
  const text = chance == null ? "text-slate-400" : chance >= 75 ? "text-emerald-700" : chance >= 35 ? "text-amber-700" : "text-rose-600";

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="white" stroke="#e2e8f0" strokeWidth={stroke} />
        {chance != null && chance > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          />
        ) : null}
      </svg>
      <span className={cn("absolute text-[10px] font-bold tabular-nums", text)}>
        {chance == null ? "—" : `${chance}%`}
      </span>
    </span>
  );
}

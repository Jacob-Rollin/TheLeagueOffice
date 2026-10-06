import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { startTransition, useMemo, useRef, useState } from "react";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  ScoringFormatSelect,
  scoringFormatLabel,
  useResearchScoringFormat,
} from "@/components/research/ScoringFormatSelect";
import {
  nextSortState,
  PLAYER_LIST_HEADER_ROW,
  SortHeaderButton,
  type SortDir,
} from "@/components/research/SortHeader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { fetchResearchSosAnalysis, RESEARCH_CLIENT_STALE_MS } from "@/lib/research-cdn";
import type { DepthChartEntry, SosAnalysisCell, SosAnalysisRow } from "@/lib/players.server";
import { injuryMicroBadge } from "@/lib/sandbox-rosters";
import {
  sosDifficultyFromStars,
  sosStarsFromRank,
  type SosDifficultyTone,
} from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sos-analysis")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SoS Analysis — The League Office" },
      {
        name: "description",
        content:
          "Fantasy strength of schedule for every NFL team by position: who has the easiest remaining schedule.",
      },
    ],
  }),
  component: SosAnalysisPage,
});

type SosPos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
type Tab = "summary" | SosPos;
type SortKey = "team" | "rating" | SosPos;

const POS_LIST: SosPos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const TABS: { value: Tab; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "K", label: "K" },
  { value: "DEF", label: "DST" },
];

const POS_META: Record<SosPos, { label: string; plural: string; slots: number }> = {
  QB: { label: "QB", plural: "QBs", slots: 2 },
  RB: { label: "RB", plural: "RBs", slots: 3 },
  WR: { label: "WR", plural: "WRs", slots: 3 },
  TE: { label: "TE", plural: "TEs", slots: 2 },
  K: { label: "K", plural: "kickers", slots: 1 },
  DEF: { label: "DST", plural: "DSTs", slots: 0 },
};

/** Column widths per tab: Team, then Rating(s), then depth chart slots. */
function columnLayout(pos: SosPos | null): { widths: string[]; minWidth: string } {
  if (!pos) return { widths: ["22%", ...POS_LIST.map(() => "13%")], minWidth: "min-w-[900px]" };
  const slots = POS_META[pos].slots;
  if (slots === 3)
    return { widths: ["22%", "17%", "20.33%", "20.33%", "20.34%"], minWidth: "min-w-[1000px]" };
  if (slots === 2) return { widths: ["26%", "20%", "27%", "27%"], minWidth: "min-w-[820px]" };
  if (slots === 1) return { widths: ["32%", "30%", "38%"], minWidth: "min-w-[680px]" };
  return { widths: ["60%", "40%"], minWidth: "min-w-[560px]" };
}

const BAR_FILL: Record<SosDifficultyTone, string> = {
  elite: "bg-emerald-600",
  good: "bg-emerald-400",
  neutral: "bg-amber-500",
  bad: "bg-rose-400",
  tough: "bg-rose-600",
  bye: "bg-slate-200",
};

const LEGEND: { tone: SosDifficultyTone; label: string }[] = [
  { tone: "elite", label: "Great" },
  { tone: "good", label: "Good" },
  { tone: "neutral", label: "Neutral" },
  { tone: "bad", label: "Bad" },
  { tone: "tough", label: "Tough" },
];

const SCHEDULE_PHRASE: Record<number, [string, string]> = {
  5: ["a very easy schedule", "perform well above their average"],
  4: ["an easy schedule", "perform better than their average"],
  3: ["a neutral schedule", "perform close to their average"],
  2: ["a tough schedule", "perform worse than their average"],
  1: ["a very tough schedule", "perform well below their average"],
};

function defaultDir(key: SortKey): SortDir {
  return key === "team" ? "asc" : "desc";
}

function SosAnalysisPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [sortKey, setSortKey] = useState<SortKey | null>("team");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { format: leagueFormat } = useLeagueScoringMeta();
  const { format: scoringFormat, setFormat: setScoringFormat } =
    useResearchScoringFormat(leagueFormat);
  const scoringLabel = scoringFormatLabel(scoringFormat);

  const query = useQuery({
    queryKey: ["sos-analysis", scoringFormat],
    staleTime: RESEARCH_CLIENT_STALE_MS,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: () => fetchResearchSosAnalysis(scoringFormat),
  });
  const payload = query.data;

  const selectTab = (next: Tab) =>
    startTransition(() => {
      setTab(next);
      setSortKey(next === "summary" ? "team" : "rating");
      setSortDir(next === "summary" ? "asc" : "desc");
    });

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, defaultDir(key));
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const rows = useMemo(() => {
    const list = [...(payload?.rows ?? [])];
    const fallback: SortKey = tab === "summary" ? "team" : "rating";
    const key = sortKey ?? fallback;
    const dir = sortKey == null ? defaultDir(fallback) : sortDir;
    const rankFor = (row: SosAnalysisRow): number => {
      const pos = key === "rating" ? (tab === "summary" ? null : tab) : key === "team" ? null : key;
      return pos ? (row.cells[pos]?.rank ?? -1) : -1;
    };
    list.sort((a, b) => {
      if (key === "team") {
        const cmp = a.teamName.localeCompare(b.teamName);
        return dir === "asc" ? cmp : -cmp;
      }
      const cmp = rankFor(a) - rankFor(b);
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      return a.teamName.localeCompare(b.teamName);
    });
    return list;
  }, [payload?.rows, sortKey, sortDir, tab]);

  const activePos = tab === "summary" ? null : tab;
  const slotCount = activePos ? POS_META[activePos].slots : 0;
  const layout = columnLayout(activePos);
  const colCount = layout.widths.length;
  const weekRange =
    payload && payload.fromWeek > 0 ? `Weeks ${payload.fromWeek} – ${payload.toWeek}` : null;

  const sortHeader = (key: SortKey, label: string, align?: "left") => (
    <SortHeaderButton
      label={label}
      active={sortKey === key}
      dir={sortDir}
      onClick={() => toggleSort(key)}
      {...(align ? { align } : {})}
    />
  );

  return (
    <TooltipProvider delayDuration={100}>
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <div className="mb-5">
          <h1 className="display-title text-3xl text-slate-900">
            SoS <span className="text-primary">Analysis</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {payload
              ? `Who has the easiest remaining schedule?${weekRange ? ` (${weekRange})` : ""}`
              : "Loading strength of schedule…"}
          </p>
        </div>

        <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">What is fantasy Strength of Schedule?</p>
          <p className="mt-1 leading-relaxed">
            Each rating shows how easy or hard a team's remaining matchups are for a position. We
            average the {scoringLabel} points per game every remaining opponent allows to that
            position, then rank all 32 teams on the same scale as our matchup grades. Easier
            schedules fill more bars; hover over a rating for the details.
            {payload?.priorSeason
              ? ` Until a defense has played 4 games, its numbers also lean on its ${payload.priorSeason} average.`
              : ""}
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => selectTab(t.value)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors",
                tab === t.value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 sm:justify-between">
          <ScoringFormatSelect
            value={scoringFormat}
            onChange={(next) => startTransition(() => setScoringFormat(next))}
          />
          <div className="flex flex-wrap items-center gap-4 text-[11px] font-black uppercase tracking-wider text-slate-600">
            {LEGEND.map((item) => (
              <span key={item.tone} className="inline-flex items-center gap-2">
                <span className={cn("size-2 rounded-full", BAR_FILL[item.tone])} aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className={cn("w-full table-fixed border-collapse text-sm", layout.minWidth)}>
              <colgroup>
                {layout.widths.map((w, i) => (
                  <col key={`${tab}-${i}`} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className={PLAYER_LIST_HEADER_ROW}>
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left">
                    {sortHeader("team", "Team", "left")}
                  </th>
                  {activePos ? (
                    <>
                      <th className="px-3 py-2 text-center">{sortHeader("rating", "Rating")}</th>
                      {Array.from({ length: slotCount }, (_, i) => (
                        <th key={i} className="px-3 py-2 text-center">
                          {POS_META[activePos].label}
                          {i + 1}
                        </th>
                      ))}
                    </>
                  ) : (
                    POS_LIST.map((pos) => (
                      <th key={pos} className="px-3 py-2 text-center">
                        {sortHeader(pos, POS_META[pos].label)}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-slate-400">
                      Loading strength of schedule…
                    </td>
                  </tr>
                ) : query.isError ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-rose-600">
                      Could not load strength of schedule. Try again shortly.
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-slate-400">
                      No schedule data available yet for this season.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const zebra = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                    return (
                      <tr key={row.team} className={cn("border-b border-slate-100", zebra)}>
                        <td className={cn("sticky left-0 z-10 px-4 py-2.5", zebra)}>
                          <TeamLink team={row.team} name={row.teamName} />
                        </td>
                        {activePos ? (
                          <>
                            <td className="px-3 py-2.5 text-center">
                              <RatingBar
                                cell={row.cells[activePos]}
                                teamName={row.teamName}
                                pos={activePos}
                                scoringLabel={scoringLabel}
                                weekRange={weekRange}
                              />
                            </td>
                            {Array.from({ length: slotCount }, (_, i) => (
                              <td key={i} className="px-3 py-2">
                                <DepthPlayer
                                  entry={row.depth[activePos]?.[i]}
                                  team={row.team}
                                  pos={activePos}
                                  onOpen={openPlayer}
                                />
                              </td>
                            ))}
                          </>
                        ) : (
                          POS_LIST.map((pos) => (
                            <td key={pos} className="px-3 py-2.5 text-center">
                              <RatingBar
                                cell={row.cells[pos]}
                                teamName={row.teamName}
                                pos={pos}
                                scoringLabel={scoringLabel}
                                weekRange={weekRange}
                              />
                            </td>
                          ))
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <PlayerModalHost ref={modalRef} />
      </main>
    </TooltipProvider>
  );
}

function TeamLink({ team, name }: { team: string; name: string }) {
  const logo = teamLogo(team);
  return (
    <Link
      to="/nfl-team/$nflId"
      params={{ nflId: team }}
      className="flex min-w-0 items-center gap-2.5 font-semibold text-blue-700 transition-opacity hover:opacity-85"
    >
      {logo ? <img src={logo} alt="" className="size-6 shrink-0 object-contain" loading="lazy" /> : null}
      <span className="truncate">{name}</span>
    </Link>
  );
}

function RatingBar({
  cell,
  teamName,
  pos,
  scoringLabel,
  weekRange,
}: {
  cell: SosAnalysisCell | undefined;
  teamName: string;
  pos: SosPos;
  scoringLabel: string;
  weekRange: string | null;
}) {
  if (!cell) return <span className="text-slate-300">—</span>;
  const stars = sosStarsFromRank(cell.rank) ?? 3;
  const { tone } = sosDifficultyFromStars(stars);
  const [schedule, outcome] = SCHEDULE_PHRASE[stars] ?? SCHEDULE_PHRASE[3]!;
  const plural = POS_META[pos].plural;
  const pct = Math.round(Math.abs(cell.vsAvg) * 100);
  const relative =
    pct === 0 ? "right at the league average" : `${pct}% ${cell.vsAvg > 0 ? "above" : "below"} average`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${teamName} ${POS_META[pos].label} schedule: ${stars} of 5`}
          className="inline-flex items-center gap-1 rounded px-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={cn("h-1 w-4 rounded-full", i < stars ? BAR_FILL[tone] : "bg-slate-200")}
            />
          ))}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="max-w-72 rounded-lg bg-slate-900 px-3.5 py-2.5 text-[13px] leading-snug text-white shadow-lg"
      >
        <p>
          {teamName} has {schedule} in which {plural} {outcome}.
        </p>
        <p className="mt-1 text-xs text-slate-300">
          Remaining opponents allow {cell.avg.toFixed(1)} {scoringLabel} points per game to{" "}
          {plural}, {relative}, across {cell.games} {cell.games === 1 ? "game" : "games"}
          {weekRange ? ` (${weekRange})` : ""}.
        </p>
        <TooltipPrimitive.Arrow className="fill-slate-900" width={12} height={6} />
      </TooltipContent>
    </Tooltip>
  );
}

function DepthPlayer({
  entry,
  team,
  pos,
  onOpen,
}: {
  entry: DepthChartEntry | undefined;
  team: string;
  pos: SosPos;
  onOpen: (id: string) => void;
}) {
  if (!entry) return <div className="text-center text-slate-300">—</div>;
  const badge = injuryMicroBadge(entry.injury);
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      className="mx-auto flex max-w-full min-w-0 items-center justify-center gap-2 text-left transition-opacity hover:opacity-85"
    >
      <PlayerAvatar
        id={entry.id}
        pos={pos}
        team={team}
        name={entry.name}
        className="size-7 flex-shrink-0 rounded-full border-2 border-slate-200 bg-white"
        logoClassName="size-2.5"
      />
      <span className="truncate font-semibold text-blue-700">{entry.name}</span>
      {badge ? (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-0.5 text-[9px] font-bold text-white",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      ) : null}
    </button>
  );
}

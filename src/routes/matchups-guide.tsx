import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Fragment, startTransition, useDeferredValue, useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueProjections, useLeagueScoringMeta } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import { fetchResearchMatchupsGuide, RESEARCH_CLIENT_STALE_MS } from "@/lib/research-cdn";
import type { MatchupDefenseCell } from "@/lib/players.server";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import {
  sosDifficultyChipClass,
  sosDifficultyDisplayLabel,
  sosDifficultyFromStars,
  sosStarsFromRank,
  type SosDifficultyTone,
} from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/matchups-guide")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Matchups Guide — The League Office" },
      {
        name: "description",
        content:
          "Every fantasy starter's matchup this week, graded from great to tough by positional fantasy points allowed.",
      },
    ],
  }),
  component: MatchupsGuideRoute,
});

const POS_TABS: { value: Pos; label: string; plural: string }[] = [
  { value: "QB", label: "QB", plural: "QBs" },
  { value: "RB", label: "RB", plural: "RBs" },
  { value: "WR", label: "WR", plural: "WRs" },
  { value: "TE", label: "TE", plural: "TEs" },
  { value: "K", label: "K", plural: "Kickers" },
  { value: "DEF", label: "DST", plural: "Defenses" },
];

/** Weekly projection a player needs to count as a fantasy starter when not rostered in the league. */
const STARTER_PROJ: Record<Pos, number> = { QB: 10, RB: 5, WR: 5, TE: 4, K: 4, DEF: 3 };

type GradeFilter = "all" | Exclude<SosDifficultyTone, "bye">;

const GRADE_FILTERS: { value: GradeFilter; label: string; dot?: string }[] = [
  { value: "all", label: "All Grades" },
  { value: "elite", label: "Great", dot: "bg-emerald-600" },
  { value: "good", label: "Good", dot: "bg-emerald-400" },
  { value: "neutral", label: "Neutral", dot: "bg-amber-500" },
  { value: "bad", label: "Bad", dot: "bg-rose-400" },
  { value: "tough", label: "Tough", dot: "bg-rose-600" },
];

const SCORE_BAR: Record<SosDifficultyTone, string> = {
  elite: "bg-emerald-600",
  good: "bg-emerald-400",
  neutral: "bg-amber-500",
  bad: "bg-rose-400",
  tough: "bg-rose-600",
  bye: "bg-slate-300",
};

type Ownership = "roster" | "taken" | "available";

const OWNERSHIP_ROW: Record<Ownership, string> = {
  roster: "bg-sky-50/90",
  taken: "bg-white",
  available: "bg-emerald-50/80",
};

type SortKey = "rank" | "player" | "opp" | "score";

type GuideRow = {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  metaLine: string;
  injuryLabel: string | null;
  injuryClass: string | null;
  ownership: Ownership;
  ownerTeam: string | null;
  opp: string;
  home: boolean;
  cell: MatchupDefenseCell;
  tone: Exclude<SosDifficultyTone, "bye">;
  gradeLabel: string;
  score: number;
  proj: number | null;
  rank: number;
};

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function MatchupsGuideRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <MatchupsGuidePage key={activeLeagueId ?? "none"} />;
}

function MatchupsGuidePage() {
  const [pos, setPos] = useState<Pos>("WR");
  const [grade, setGrade] = useState<GradeFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [week, setWeek] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const modalRef = useRef<PlayerModalHandle>(null);

  const { format: leagueFormat } = useLeagueScoringMeta();
  const { format: scoringFormat, setFormat: setScoringFormat } =
    useResearchScoringFormat(leagueFormat);

  const query = useQuery({
    queryKey: ["matchups-guide", week, scoringFormat],
    staleTime: RESEARCH_CLIENT_STALE_MS,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: () => fetchResearchMatchupsGuide(week, scoringFormat),
  });
  const guide = query.data;
  const activeWeek = week ?? guide?.week ?? null;

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const brain = usePlayerBrain();
  const { projectFor } = useLeagueProjections(activeWeek);
  const { teams, myTeam, rosteredIds } = useLeagueRosters(players);

  const ownerById = useMemo(() => {
    const map = new Map<string, { slot: number; team: string; isMine: boolean }>();
    for (const t of teams) {
      for (const p of t.players) map.set(p.id, { slot: t.slot, team: t.team, isMine: t.isMine });
    }
    return map;
  }, [teams]);
  const myIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam?.players]);

  const teamOptions = useMemo(
    () => [...teams].sort((a, b) => Number(b.isMine) - Number(a.isMine) || a.team.localeCompare(b.team)),
    [teams],
  );

  /** League-wide average points allowed per game to the active position, for detail context. */
  const leagueAvg = useMemo(() => {
    const cells = Object.values(guide?.defense?.[pos] ?? {}).filter((c) => c.seasonPa != null);
    if (!cells.length) return null;
    return cells.reduce((sum, c) => sum + (c.seasonPa ?? 0), 0) / cells.length;
  }, [guide?.defense, pos]);

  const scoreScale = useMemo(() => {
    const values = Object.values(guide?.defense?.[pos] ?? {}).map((c) => c.pa);
    if (values.length < 2) return null;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;
    return { mean, sd };
  }, [guide?.defense, pos]);

  const baseRows = useMemo((): GuideRow[] => {
    if (!guide) return [];
    const defense = guide.defense[pos] ?? {};
    const out: GuideRow[] = [];
    for (const p of players) {
      if (p.pos !== pos) continue;
      const team = (p.team ?? "").trim().toUpperCase();
      const game = team ? guide.games[team] : undefined;
      if (!game) continue;
      const cell = defense[game.opp];
      if (!cell) continue;

      const owner = ownerById.get(p.id) ?? null;
      const proj = projectFor(p.id);
      const weekly = proj ?? (p.proj?.half ?? 0) / 17;
      if (!owner && weekly < STARTER_PROJ[pos]) continue;

      const ownership: Ownership = myIds.has(p.id) ? "roster" : rosteredIds.has(p.id) ? "taken" : "available";
      const difficulty = sosDifficultyFromStars(sosStarsFromRank(cell.rank));
      const tone = difficulty.tone === "bye" ? "neutral" : difficulty.tone;
      const z = scoreScale ? (cell.pa - scoreScale.mean) / scoreScale.sd : 0;
      const posLabel = pos === "DEF" ? "DST" : pos;
      const bye = p.bye != null && Number(p.bye) > 0 ? Number(p.bye) : null;
      const badge = injuryMicroBadge(resolveInjuryStatus(p, brain));
      out.push({
        id: p.id,
        name: p.name,
        pos,
        team,
        metaLine: bye != null ? `${posLabel} · ${team} · Bye ${bye}` : `${posLabel} · ${team}`,
        injuryLabel: badge?.label ?? null,
        injuryClass: badge?.className ?? null,
        ownership,
        ownerTeam: owner?.team ?? null,
        opp: game.opp,
        home: game.home,
        cell,
        tone,
        gradeLabel: sosDifficultyDisplayLabel(difficulty.label),
        score: Math.max(1, Math.min(99, Math.round(50 + z * 18))),
        proj,
        rank: 0,
      });
    }
    return out;
  }, [guide, pos, players, ownerById, myIds, rosteredIds, projectFor, scoreScale, brain]);

  const rows = useMemo((): GuideRow[] => {
    const needle = deferredQ.trim().toLowerCase();
    const filtered = baseRows.filter((row) => {
      if (grade !== "all" && row.tone !== grade) return false;
      if (teamFilter === "available" && row.ownership !== "available") return false;
      if (teamFilter.startsWith("team:")) {
        const slot = Number(teamFilter.slice(5));
        if (ownerById.get(row.id)?.slot !== slot) return false;
      }
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.team.toLowerCase().includes(needle) ||
        row.opp.toLowerCase().includes(needle)
      );
    });

    const byMatchup = (a: GuideRow, b: GuideRow) =>
      b.cell.pa - a.cell.pa || (b.proj ?? 0) - (a.proj ?? 0) || a.name.localeCompare(b.name);
    const ranked = [...filtered].sort(byMatchup).map((row, i) => ({ ...row, rank: i + 1 }));
    if (sortKey == null || sortKey === "rank" || sortKey === "score") {
      const reversed =
        sortKey != null && (sortKey === "rank" ? sortDir === "desc" : sortDir === "asc");
      return reversed ? ranked.reverse() : ranked;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return ranked.sort((a, b) => {
      const cmp = sortKey === "player" ? a.name.localeCompare(b.name) : a.opp.localeCompare(b.opp);
      return cmp * dir || a.rank - b.rank;
    });
  }, [baseRows, grade, teamFilter, deferredQ, ownerById, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    const next = nextSortState(sortKey, sortDir, key, key === "score" ? "desc" : "asc");
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const posMeta = POS_TABS.find((t) => t.value === pos)!;
  const updatedLabel = guide
    ? new Date(guide.updatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const scoringLabel = scoringFormatLabel(scoringFormat);

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-3xl text-slate-900">
          Matchups <span className="text-primary">Guide</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {guide
            ? `Every starter's Week ${activeWeek} matchup, graded from great to tough. Tap a row to see what's driving the grade.`
            : "Loading matchups…"}
        </p>
        {updatedLabel ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Matchups last updated {updatedLabel}
            {guide && guide.dataThroughWeek > 0 ? ` · Through Week ${guide.dataThroughWeek}` : ""}
          </p>
        ) : null}
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">How matchups are graded</p>
        <p className="mt-1 leading-relaxed">
          Each opponent is ranked by the {scoringLabel} points per game it has allowed to the
          position this season, the same scale as our strength of schedule. Great and Good matchups face the
          softest defenses; Bad and Tough face the stingiest.
          {guide?.priorSeason
            ? ` Until a defense has played 4 games, its rank also leans on its ${guide.priorSeason} average.`
            : ""}
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
                setExpanded(null);
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
          <Select value={teamFilter} onValueChange={(v) => startTransition(() => setTeamFilter(v))}>
            <SelectTrigger
              aria-label="Filter by team"
              className="h-9 w-[13rem] shrink-0 border-slate-200 bg-white shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Players</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              {teamOptions.map((t) => (
                <SelectItem key={t.slot} value={`team:${t.slot}`}>
                  {t.team}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={activeWeek != null ? String(activeWeek) : ""}
            onValueChange={(v) =>
              startTransition(() => {
                setWeek(Number(v));
                setExpanded(null);
              })
            }
          >
            <SelectTrigger
              aria-label="Week"
              className="h-9 w-[7rem] shrink-0 border-slate-200 bg-white shadow-none"
            >
              <SelectValue placeholder="Week" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Week {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={grade}
            onValueChange={(v) => startTransition(() => setGrade(v as GradeFilter))}
          >
            <SelectTrigger
              aria-label="Matchup grade"
              className="h-9 w-[9rem] shrink-0 border-slate-200 bg-white shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRADE_FILTERS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  <span className="inline-flex items-center gap-2">
                    {g.dot ? (
                      <span className={cn("size-2 rounded-full", g.dot)} aria-hidden="true" />
                    ) : null}
                    {g.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ScoringFormatSelect
            value={scoringFormat}
            onChange={(next) =>
              startTransition(() => {
                setScoringFormat(next);
                setExpanded(null);
              })
            }
          />
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a player or team"
          className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-64"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="w-14 px-2 py-2 text-center">
                  <SortHeaderButton
                    label="Rk"
                    active={sortKey === "rank"}
                    dir={sortDir}
                    onClick={() => toggleSort("rank")}
                  />
                </th>
                <th className="px-2 py-2 text-left">
                  <SortHeaderButton
                    label="Player"
                    active={sortKey === "player"}
                    dir={sortDir}
                    onClick={() => toggleSort("player")}
                    align="left"
                  />
                </th>
                <th className="w-24 px-2 py-2 text-center">
                  <SortHeaderButton
                    label="Opp"
                    active={sortKey === "opp"}
                    dir={sortDir}
                    onClick={() => toggleSort("opp")}
                  />
                </th>
                <th className="w-28 px-2 py-2 text-center">Grade</th>
                <th className="w-56 px-2 py-2 text-left">
                  <SortHeaderButton
                    label="Matchup Score"
                    active={sortKey === "score"}
                    dir={sortDir}
                    onClick={() => toggleSort("score")}
                    align="left"
                  />
                </th>
                <th className="w-10 px-2 py-2" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    Loading matchups…
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-rose-600">
                    Could not load matchups. Try again shortly.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    No {posMeta.plural} match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const open = expanded === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn(
                          "cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80",
                          OWNERSHIP_ROW[row.ownership],
                        )}
                        onClick={() => setExpanded(open ? null : row.id)}
                      >
                        <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{row.rank}</td>
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              modalRef.current?.open(row.id);
                            }}
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
                        <td className="px-2 py-2.5 text-center text-sm">
                          <span className="text-slate-400">{row.home ? "vs" : "@"}</span>{" "}
                          <span className="font-semibold text-slate-800">{row.opp}</span>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-flex min-w-[4.5rem] justify-center rounded px-2 py-0.5 text-[11px] font-bold",
                              sosDifficultyChipClass(row.tone),
                            )}
                          >
                            {row.gradeLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn("h-full rounded-full", SCORE_BAR[row.tone])}
                                style={{ width: `${row.score}%` }}
                              />
                            </div>
                            <span className="w-7 text-right font-semibold tabular-nums text-slate-900">
                              {row.score}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <ChevronDown
                            className={cn(
                              "mx-auto size-4 text-slate-400 transition-transform",
                              open && "rotate-180",
                            )}
                            aria-hidden="true"
                          />
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={6} className="px-4 py-3">
                            <MatchupDetail
                              row={row}
                              plural={posMeta.plural}
                              leagueAvg={leagueAvg}
                              scoringLabel={scoringLabel}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

function MatchupDetail({
  row,
  plural,
  leagueAvg,
  scoringLabel,
}: {
  row: GuideRow;
  plural: string;
  leagueAvg: number | null;
  scoringLabel: string;
}) {
  const { cell, opp } = row;
  const softness = 33 - cell.rank;
  const facing = row.pos === "DEF" ? `${opp}'s offense` : opp;
  return (
    <div className="space-y-2.5 text-sm text-slate-600">
      <p>
        {cell.seasonPa != null ? (
          <>
            {facing} has allowed{" "}
            <span className="font-semibold text-slate-900">{cell.seasonPa.toFixed(1)}</span>{" "}
            {scoringLabel} points per game to {plural} this season, the {ordinal(softness)} most in the NFL
            {leagueAvg != null ? ` (league average ${leagueAvg.toFixed(1)})` : ""}.
          </>
        ) : (
          <>
            {facing} ranks {ordinal(softness)} in points allowed to {plural}, based on last season
            until games are played this year.
          </>
        )}
        {row.proj != null ? (
          <>
            {" "}
            {row.name} is projected for{" "}
            <span className="font-semibold text-slate-900">{row.proj.toFixed(1)}</span> points.
          </>
        ) : null}
        {row.ownerTeam ? <> Rostered by {row.ownerTeam}.</> : null}
      </p>
      {cell.weeks.length ? (
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Points allowed to {plural} by week
          </p>
          <div className="flex flex-wrap gap-1.5">
            {cell.weeks.map((w) => (
              <span
                key={w.week}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                <span className="font-bold text-slate-400">W{w.week}</span>
                <span className="text-slate-500">vs {w.vs || "—"}</span>
                <span className="font-semibold tabular-nums text-slate-900">{w.pts.toFixed(1)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

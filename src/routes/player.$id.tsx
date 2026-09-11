import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { PlayerDetail } from "@/components/draft/PlayerDetail";
import { usePlayerSos } from "@/hooks/usePlayerSos";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import type { Pos, Scoring } from "@/lib/draft";
import { getTeamPrimaryColor, NFL_TEAMS, teamById } from "@/lib/nfl-teams";
import { getNextGame, getPlayerBio, getPlayerDetail } from "@/lib/players.functions";
import {
  matchupGrade,
  playoffWindow,
  strategicOutlook,
  weekSlots,
} from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";

const SCORING_OPTIONS: { value: Scoring; label: string }[] = [
  { value: "std", label: "STD" },
  { value: "half", label: "HALF" },
  { value: "ppr", label: "PPR" },
];
const DETAIL_TABS = [
  { key: "logs", label: "Game Logs" },
  { key: "projections", label: "Projections" },
  { key: "sos", label: "SOS" },
  { key: "outlook", label: "Outlook" },
  { key: "depth", label: "Depth Chart" },
  { key: "news", label: "News" },
] as const;

type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

/** Drive the hidden PlayerDetail tab buttons without editing that component. */
function clickPlayerDetailTab(root: HTMLElement | null, label: string) {
  if (!root) return;
  const buttons = root.querySelectorAll("header button");
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) {
      (btn as HTMLButtonElement).click();
      return;
    }
  }
}

/* ---------- queries (page-local, not shared with the draft popup) ---------- */

const profileQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

const bioQuery = (id: string) =>
  queryOptions({
    queryKey: ["player-bio", id],
    queryFn: () => getPlayerBio({ data: { id } }),
    staleTime: 1000 * 60 * 60 * 12,
  });

const nextGameQuery = (team: string) =>
  queryOptions({
    queryKey: ["player-next-game", team],
    queryFn: () => getNextGame({ data: { team } }),
    staleTime: 1000 * 60 * 60 * 6,
  });

const TEAM_NAME: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.id, t.name]),
);

const POS_STRIP_BG: Record<string, string> = {
  QB: "bg-qb",
  RB: "bg-rb",
  WR: "bg-wr",
  TE: "bg-te",
  K: "bg-k",
  DEF: "bg-def",
};

function getWatermarkLogoUrl(teamCode: string | null | undefined): string | null {
  const formattedTeam = teamCode?.toUpperCase()?.trim() ?? "";
  if (formattedTeam === "LV" || formattedTeam === "OAK") {
    return "https://a.espncdn.com/i/teamlogos/nfl/500-dark/lv.png";
  }
  return teamLogo(teamCode);
}

function getFullInjuryBadgeDetails(status?: string | null) {
  const cleanStatus = status?.toUpperCase()?.trim();
  if (
    !cleanStatus ||
    cleanStatus === "NONE" ||
    cleanStatus === "HEALTHY" ||
    cleanStatus === "ACTIVE"
  ) {
    return null;
  }
  if (cleanStatus === "Q" || cleanStatus === "QUESTIONABLE") {
    return {
      text: "Questionable",
      classes:
        "bg-amber-500 text-slate-950 border-none font-black text-[10px] shadow-sm shadow-amber-500/10",
    };
  }
  if (cleanStatus === "O" || cleanStatus === "OUT") {
    return {
      text: "Out",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
    };
  }
  if (cleanStatus === "D" || cleanStatus === "DOUBTFUL") {
    return {
      text: "Doubtful",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
    };
  }
  if (
    cleanStatus === "IR" ||
    cleanStatus === "INJURED_RESERVE" ||
    cleanStatus === "INJURED RESERVE"
  ) {
    return {
      text: "Injured Reserve",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
    };
  }
  if (
    cleanStatus === "NA" ||
    cleanStatus === "NOT_ACTIVE" ||
    cleanStatus === "NOT ACTIVE" ||
    cleanStatus === "EXEMPT" ||
    cleanStatus === "INACTIVE"
  ) {
    return {
      text: "Not Active",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
    };
  }
  return null;
}

function HeaderVitalsDivider() {
  return <span className="mx-3 text-white/20">|</span>;
}

function injuryLetter(injury: string | null | undefined): "Q" | "O" | "IR" | "NA" | null {
  const raw = injury?.toUpperCase()?.trim() ?? "";
  if (!raw || raw === "HEALTHY" || raw === "ACTIVE" || raw === "NONE") return null;
  if (raw === "QUESTIONABLE" || raw === "Q") return "Q";
  if (raw === "OUT" || raw === "DOUBTFUL" || raw === "O" || raw === "D") return "O";
  if (raw === "IR" || raw === "INJURED RESERVE" || raw === "INJURED_RESERVE") return "IR";
  if (raw === "NA" || raw === "INACTIVE" || raw === "NOT ACTIVE" || raw === "NOT_ACTIVE") return "NA";
  return null;
}

export const Route = createFileRoute("/player/$id")({
  head: () => ({
    meta: [
      { title: "Player profile — The League Office" },
      {
        name: "description",
        content:
          "ESPN-style player hub with season projections, game logs, injury risk, strength of schedule and team depth chart.",
      },
      { property: "og:title", content: "Player profile — The League Office" },
      {
        property: "og:description",
        content:
          "Projections, game logs, schedule difficulty and injury risk for every draftable fantasy player.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.id));
    if (!data) throw notFound();
  },
  component: PlayerHubPage,
});

/** Dynamic risk bucket routing for the injury telemetry meter. */
function riskTier(score: number): { label: string; text: string; fill: string } {
  if (score >= 70)
    return { label: "HIGH RISK", text: "text-rose-500", fill: "bg-rose-500" };
  if (score >= 35)
    return { label: "MODERATE RISK", text: "text-amber-500", fill: "bg-amber-500" };
  return { label: "LOW RISK", text: "text-emerald-500", fill: "bg-emerald-500" };
}

function PlayerHubPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery(profileQuery(id));
  const { data: bio } = useQuery(bioQuery(id));
  const brain = usePlayerBrain();
  const playerSos = usePlayerSos(
    (data ? brain?.[data.player.id] : null) ?? null,
    data?.player.team ?? null,
  );
  const [activeTab, setActiveTab] = useState<DetailTabKey>("logs");
  const [scoringFormat, setScoringFormat] = useState<Scoring>("half");
  const detailHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab("logs");
  }, [id]);

  useEffect(() => {
    const label = DETAIL_TABS.find((t) => t.key === activeTab)?.label;
    if (!label) return;
    // Allow PlayerDetail to mount before bridging the visible page tabs.
    const timer = window.setTimeout(() => {
      clickPlayerDetailTab(detailHostRef.current, label);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, id, data?.player.id]);

  if (isLoading)
    return <p className="py-24 text-center text-sm text-zinc-500">Loading player hub…</p>;
  if (!data) return <p className="py-24 text-center text-sm text-zinc-500">Player not found.</p>;

  const { player, depthChart, injuryRisk } = data;
  const posDepthChart = depthChart.filter((d) => d.pos === player.pos);
  const brainEntry = brain?.[player.id] ?? null;
  const brainSos = playerSos;
  const tier = riskTier(injuryRisk.score);
  const playoff = brainSos ? playoffWindow(brainSos) : null;
  const playoffChallenging = playoff === "Challenging";
  const outlookLower = brainSos ? strategicOutlook(brainSos).toLowerCase() : "";
  const trendLabel = /favor|friendly|steady/.test(outlookLower)
    ? "FAVORABLE"
    : /brutal|caution|limited|demand/.test(outlookLower)
      ? "CAUTION"
      : "BALANCED";
  const historicalBody =
    injuryRisk.factors
      .filter(
        (f) =>
          !f.toLowerCase().includes("currently listed") &&
          (!player.injury || f.toLowerCase().trim() !== player.injury.toLowerCase().trim()),
      )
      .find((f) => {
        const lower = f.toLowerCase();
        return !(
          lower.includes("carries") ||
          lower.includes("touches") ||
          lower.includes("targets") ||
          lower.includes("snaps")
        );
      }) ??
    (player.injury && brainEntry?.injuryType
      ? brainEntry.injuryType
      : "No significant historical flags");
  const injuryDesignation = player.injury ?? "Healthy — no designation";

  return (
    <main className="w-full min-h-screen bg-slate-50 text-slate-900 overflow-y-auto">
      <div className="mx-auto mt-0 w-full max-w-7xl overflow-visible px-4 pt-0 lg:px-6">
        <div className="grid w-full grid-cols-1 items-start gap-8 overflow-visible pt-0 lg:grid-cols-[1fr_360px] lg:pt-6">
          {/* Left column — isolated page header + docked subtabs + shared body */}
          <div className="relative z-10 flex w-full flex-col items-stretch overflow-visible border-0 bg-transparent p-0 shadow-none">
            <StandalonePlayerHeader
              player={player}
              bio={bio ?? null}
              scoringFormat={scoringFormat}
              onScoringFormatChange={setScoringFormat}
            />
            <div className="flex w-full select-none items-center space-x-5 overflow-x-auto whitespace-nowrap border-x border-b border-slate-100 bg-white px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {DETAIL_TABS.map(({ key, label }) => {
                const active = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      "shrink-0 text-xs font-black uppercase tracking-wider transition-colors",
                      active
                        ? "-mb-[1px] border-b-2 border-blue-600 pb-2.5 pt-3 text-slate-900"
                        : "pb-2.5 pt-3 text-slate-400 hover:text-slate-600",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              ref={detailHostRef}
              className="w-full overflow-visible bg-white [&>div>header]:hidden"
            >
              <PlayerDetail
                id={id}
                showFullProfileLink={false}
                scoringFormat={scoringFormat}
                onScoringFormatChange={setScoringFormat}
              />
            </div>
          </div>

          {/* ---- sidebar widgets (unchanged) ---- */}
          <aside className="w-full space-y-4 self-start rounded-xl border border-zinc-200 bg-zinc-50 p-4 lg:w-[360px]">
            <NextGame team={player.team} />

            {player.pos !== "DEF" && (
              <Widget title="Injury risk">
                <div className="flex w-full select-none flex-col border-b border-slate-100/80 pb-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className={cn("text-sm font-black uppercase tracking-tight", tier.text)}>
                      {tier.label}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-500">
                      {injuryRisk.score}/100
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", tier.fill)}
                      style={{
                        width: `${Math.min(100, Math.max(0, injuryRisk.score))}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="mt-4 flex w-full select-none flex-col space-y-2">
                  <div className="flex min-h-[58px] w-full flex-col items-start justify-center rounded-xl border border-slate-100/80 bg-slate-50/50 p-3 shadow-sm">
                    <span className="mb-1 text-[9px] font-black uppercase leading-none tracking-widest text-slate-400">
                      Historical Track
                    </span>
                    <span className="text-left text-xs font-bold leading-normal text-slate-600">
                      {historicalBody}
                    </span>
                  </div>
                  <div className="flex min-h-[58px] w-full flex-col items-start justify-center rounded-xl border border-slate-100/80 bg-slate-50/50 p-3 shadow-sm">
                    <span className="mb-1 text-[9px] font-black uppercase leading-none tracking-widest text-slate-400">
                      Current Designation
                    </span>
                    <span className="text-left text-xs font-bold leading-normal text-slate-600">
                      {injuryDesignation}
                    </span>
                  </div>
                </div>
              </Widget>
            )}

            {player.pos !== "DEF" && (
              <Widget title={`Strength of schedule vs ${player.pos}`}>
                {!brainSos ? (
                  <p className="text-xs text-zinc-500">Schedule data unavailable.</p>
                ) : (
                  <>
                    <div className="grid w-full select-none grid-cols-3 gap-2 border-b border-slate-100 pb-4">
                      <div className="flex h-[64px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-100/80 bg-slate-50/50 p-2.5 text-center shadow-sm">
                        <span className="text-sm font-black uppercase tracking-tight text-slate-900">
                          {matchupGrade(brainSos.rank) || "NEUTRAL"}
                        </span>
                        <span className="mt-1 text-[9px] font-black uppercase leading-none tracking-widest text-slate-400">
                          Overall Matchup
                        </span>
                      </div>
                      <div className="flex h-[64px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-100/80 bg-slate-50/50 p-2.5 text-center shadow-sm">
                        <span
                          className={cn(
                            "text-xs font-black uppercase leading-none tracking-tight",
                            playoffChallenging ? "text-rose-600" : "text-emerald-600",
                          )}
                        >
                          {playoffChallenging ? "CHALLENGING" : "FAVORABLE"}
                        </span>
                        <span className="mt-1.5 text-[9px] font-black uppercase leading-none tracking-widest text-slate-400">
                          Playoff Window
                        </span>
                      </div>
                      <div className="flex h-[64px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-100/80 bg-slate-50/50 p-2.5 text-center shadow-sm">
                        <span className="line-clamp-1 text-center text-[10px] font-extrabold uppercase leading-tight text-slate-600">
                          {trendLabel}
                        </span>
                        <span className="mt-1.5 text-[9px] font-black uppercase leading-none tracking-widest text-slate-400">
                          Trend Outlook
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 grid w-full select-none grid-cols-3 gap-2">
                      {weekSlots(brainSos.matchups).map((slot) => {
                        const isBye = !slot.matchup;
                        const rank = slot.matchup?.rank ?? null;
                        const difficulty = isBye
                          ? "bye"
                          : rank == null
                            ? "neutral"
                            : rank >= 25
                              ? "great"
                              : rank >= 18
                                ? "good"
                                : rank >= 11
                                  ? "neutral"
                                  : rank >= 6
                                    ? "tough"
                                    : "bad";
                        const opp = isBye
                          ? "BYE"
                          : (slot.matchup?.opp ?? "—").replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase() ||
                            "—";
                        const isCurrentWeek = slot.week === 1;
                        const difficultyLabel = isBye
                          ? "BYE"
                          : difficulty === "neutral"
                            ? "MID"
                            : difficulty.toUpperCase();
                        return (
                          <div
                            key={slot.week}
                            className={cn(
                              "flex h-[72px] flex-col items-center justify-between rounded-xl border border-slate-100 bg-white p-2 shadow-sm transition-all",
                              isCurrentWeek &&
                                "border-blue-100 shadow-md ring-2 ring-blue-600 ring-offset-1",
                            )}
                          >
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                              WK {slot.week}
                            </span>
                            <span className="mt-0.5 text-xs font-black uppercase leading-none tracking-wide text-slate-800">
                              {opp}
                            </span>
                            <span
                              className={cn(
                                "w-full max-w-[46px] select-none rounded-md py-0.5 text-center text-[8px] font-black uppercase tracking-wider text-white transition-colors",
                                difficulty === "great" && "bg-emerald-600",
                                difficulty === "good" && "bg-emerald-500",
                                difficulty === "neutral" && "bg-slate-400",
                                difficulty === "tough" && "bg-rose-400",
                                difficulty === "bad" && "bg-rose-600",
                                isBye && "bg-slate-200 font-extrabold text-slate-500",
                              )}
                            >
                              {difficultyLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Widget>
            )}

            {player.pos !== "DEF" && (
              <Widget title={`${player.team} ${player.pos} depth`}>
                {posDepthChart.length === 0 ? (
                  <p className="text-xs text-zinc-500">No teammates found.</p>
                ) : (
                  <div className="space-y-0">
                    {posDepthChart.slice(0, 6).map((d, index) => {
                      const headshot = playerImage(d.id, player.pos as Pos, player.team);
                      const fallbackLogo =
                        teamLogo(player.team) ??
                        `https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png`;
                      return (
                        <Link
                          key={d.id}
                          to="/player/$id"
                          params={{ id: d.id }}
                          className={cn(
                            "relative mb-2 flex w-full items-center justify-between overflow-hidden rounded-xl border border-slate-100 bg-white p-2.5 text-left shadow-sm transition-all",
                            d.id === player.id && "border-blue-100 bg-blue-50/30",
                          )}
                        >
                          <div
                            className="absolute bottom-0 left-0 top-0 w-1"
                            style={{ backgroundColor: getTeamPrimaryColor(player.team) }}
                            aria-hidden="true"
                          />
                          <div className="flex min-w-0 flex-1 items-center space-x-3 pl-2.5">
                            <div className="relative h-8 w-8 flex-shrink-0 select-none">
                              <span className="absolute -left-1 -top-1 z-30 flex h-4 w-4 select-none items-center justify-center rounded-full border border-slate-200 bg-white font-mono text-[9px] font-black text-slate-500 shadow-sm">
                                {index + 1}
                              </span>
                              <div className="relative z-20 h-8 w-8 overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm">
                                <img
                                  src={headshot}
                                  alt={d.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.src = fallbackLogo;
                                  }}
                                />
                              </div>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-row items-center space-x-1.5 pl-2.5 text-left">
                              <span
                                className={cn(
                                  "truncate text-xs font-black",
                                  d.id === player.id ? "text-blue-600" : "text-slate-900",
                                )}
                              >
                                {d.name}
                              </span>
                              {d.injury &&
                              (injuryLetter(d.injury) === "Q" || d.injury === "Questionable") ? (
                                <span className="flex shrink-0 select-none items-center justify-center rounded bg-amber-500 px-1 py-0.5 text-[9px] font-black uppercase leading-none tracking-wider text-white">
                                  Q
                                </span>
                              ) : null}
                              {d.injury &&
                              (injuryLetter(d.injury) === "O" ||
                                d.injury === "Out" ||
                                d.injury === "Doubtful") ? (
                                <span className="flex shrink-0 select-none items-center justify-center rounded bg-rose-600 px-1 py-0.5 text-[9px] font-black uppercase leading-none tracking-wider text-white">
                                  O
                                </span>
                              ) : null}
                              {d.injury &&
                              (injuryLetter(d.injury) === "IR" ||
                                d.injury === "Injured Reserve") ? (
                                <span className="flex shrink-0 select-none items-center justify-center rounded bg-red-700 px-1 py-0.5 text-[9px] font-black uppercase leading-none tracking-wider text-white">
                                  IR
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-row items-baseline space-x-0.5 pr-1 text-right text-xs font-black tracking-wide text-slate-900">
                            <span>{Number.isFinite(d.proj) ? d.proj.toFixed(1) : "0.0"}</span>
                            <span className="select-none text-[9px] font-bold lowercase text-slate-400">
                              proj
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Widget>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

/** Page-only identity banner — isolated from the popup PlayerDetail header. */
function StandalonePlayerHeader({
  player,
  bio,
  scoringFormat,
  onScoringFormatChange,
}: {
  player: {
    id: string;
    name: string;
    team: string;
    pos: string;
    age?: number | null;
    exp?: number | null;
    injury?: string | null;
    injury_status?: string | null;
    injuryStatus?: string | null;
    posRank?: number;
    rank?: number | { half?: number; std?: number; ppr?: number } | null;
    [key: string]: unknown;
  };
  bio: { number?: number | null; height?: string | null; weight?: string | null; college?: string | null; birthDate?: string | null } | null;
  scoringFormat: Scoring;
  onScoringFormatChange: (format: Scoring) => void;
}) {
  const teamMeta = teamById(player.team);
  const teamNickname = (teamMeta?.name ?? player.team ?? "FA").toUpperCase();
  const jerseyNumber = bio?.number != null ? String(bio.number) : null;
  const isDefense = player.pos === "DEF";
  const conference = teamMeta?.conference ?? "NFC";
  const division = teamMeta?.division ?? "NORTH";
  const watermarkLogo = getWatermarkLogoUrl(player.team);
  const raidersWatermark =
    player.team?.toUpperCase() === "LV" || player.team?.toUpperCase() === "OAK";

  const birthDate =
    (player as { birth_date?: string | null }).birth_date ?? bio?.birthDate ?? null;
  const displayAge =
    player.age ||
    (birthDate
      ? Math.floor((Date.now() - new Date(birthDate).getTime()) / 31557600000)
      : "—");
  const height = bio?.height?.trim() || "—";
  const weight = bio?.weight?.trim() || "—";
  const college = bio?.college?.trim() || "—";
  const expYears =
    player.exp != null
      ? player.exp
      : (player as { years_exp?: number | null }).years_exp != null
        ? (player as { years_exp?: number | null }).years_exp
        : "—";

  const injuryStatusRaw =
    player.injury_status ||
    player.injuryStatus ||
    player.injury ||
    (player as { status?: string | null }).status ||
    null;
  const injuryDetails = getFullInjuryBadgeDetails(
    typeof injuryStatusRaw === "string" ? injuryStatusRaw : null,
  );

  const rosteredPct =
    (player as { rostered_pct?: number | null }).rostered_pct ??
    (player as { rostered?: number | null }).rostered ??
    (player as { percent_owned?: number | null }).percent_owned ??
    83;
  const startedPct =
    (player as { started_pct?: number | null }).started_pct ??
    (player as { started?: number | null }).started ??
    39;
  const positionRank =
    (player as { position_rank?: number | null }).position_rank ??
    (player as { pos_rank?: number | null }).pos_rank ??
    player.posRank ??
    999;
  const overallRaw =
    (player as { overall_rank?: number | null }).overall_rank ??
    (typeof player.rank === "number" ? player.rank : null) ??
    (typeof player.rank === "object" && player.rank
      ? player.rank[scoringFormat] ?? player.rank.half ?? 999
      : 999);
  const posRankLabel = Number(positionRank) < 900 ? positionRank : "—";
  const overallRankLabel = Number(overallRaw) < 900 ? overallRaw : "—";

  const [isScoringOpen, setIsScoringOpen] = useState(false);
  const scoringMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isScoringOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!scoringMenuRef.current?.contains(event.target as Node)) {
        setIsScoringOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isScoringOpen]);

  return (
    <div
      className={cn(
        "relative z-40 flex h-[160px] min-h-[160px] w-full flex-row items-center overflow-visible rounded-t-xl rounded-b-none border-x border-t border-slate-100 pt-0 pr-6 pb-0 text-white shadow-sm",
      )}
      style={{ backgroundColor: getTeamPrimaryColor(player.team) }}
    >
      {watermarkLogo ? (
        <img
          src={watermarkLogo}
          alt=""
          aria-hidden="true"
          className={
            raidersWatermark
              ? "pointer-events-none absolute right-2 top-1/2 z-0 h-40 w-40 -translate-y-1/2 select-none object-contain opacity-[0.08] mix-blend-screen"
              : "pointer-events-none absolute right-2 top-1/2 z-0 h-40 w-40 -translate-y-1/2 select-none object-contain opacity-[0.14] mix-blend-overlay"
          }
        />
      ) : null}

      <div className="absolute bottom-0 left-0 z-20 mb-0 ml-0 mt-0 flex h-[160px] w-[140px] items-end overflow-visible bg-transparent pl-0 select-none">
        <div className="absolute inset-0 overflow-hidden bg-transparent">
          <img
            src={playerImage(player.id, player.pos as Pos, player.team)}
            alt=""
            loading="lazy"
            className="pointer-events-none relative z-20 h-full w-full select-none object-cover object-[55%_center]"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        </div>
      </div>

      <div className="z-20 mt-1 flex min-w-0 flex-1 flex-col items-start justify-center overflow-visible py-5 pl-[164px] pr-10 text-left">
        <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-visible">
          <h1 className="truncate text-3xl font-black tracking-tight text-white">{player.name}</h1>
          {injuryDetails ? (
            <span
              className={cn(
                "ml-2 inline-flex select-none items-center justify-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-sm",
                injuryDetails.classes,
              )}
            >
              {injuryDetails.text}
            </span>
          ) : null}
        </div>

        {isDefense ? (
          <div className="mt-2 text-sm font-black uppercase tracking-wider text-white/70">
            CONFERENCE <span className="font-black text-white">{conference}</span>
            <span className="mx-3 text-white/20">|</span>
            DIVISION <span className="font-black text-white">{division}</span>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center text-sm font-black uppercase tracking-wider text-white/70">
            <span>AGE {displayAge}</span>
            <HeaderVitalsDivider />
            <span>HEIGHT {height}</span>
            <HeaderVitalsDivider />
            <span>WEIGHT {weight}</span>
            <HeaderVitalsDivider />
            <span>EXP {expYears}</span>
            <HeaderVitalsDivider />
            <span>
              COLLEGE <span className="font-black text-white">{college}</span>
            </span>
          </div>
        )}

        <div className="mt-2 w-full min-w-0 overflow-visible">
          <span className="mb-1 block text-left text-[10px] font-black uppercase tracking-widest text-white/50">
            Player Rankings
          </span>
          <div className="flex flex-wrap items-center overflow-visible text-xs font-black uppercase tracking-wide text-white">
            <span>
              #{posRankLabel} {player.pos}
            </span>
            <span className="mx-3 text-white/20">|</span>
            <span>#{overallRankLabel} OVERALL</span>
            <span className="mx-3 text-white/20">|</span>
            <span>{Math.round(Number(rosteredPct) || 83)}% ROSTERED</span>
            <span className="mx-3 text-white/20">|</span>
            <span>{Math.round(Number(startedPct) || 39)}% STARTED</span>
            <span className="mx-3 text-white/20">|</span>

            <div
              ref={scoringMenuRef}
              className="relative inline-block overflow-visible text-left"
            >
              <button
                type="button"
                aria-label="Scoring format"
                aria-expanded={isScoringOpen}
                aria-haspopup="listbox"
                onClick={() => setIsScoringOpen(!isScoringOpen)}
                className="relative z-50 flex min-w-[64px] cursor-pointer items-center justify-between rounded-lg border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white transition-all select-none hover:bg-white/15 focus:outline-none"
              >
                <span>
                  {SCORING_OPTIONS.find((o) => o.value === scoringFormat)?.label ?? "HALF"}
                </span>
                {isScoringOpen ? (
                  <ChevronUp className="ml-1 size-3 shrink-0 opacity-90" strokeWidth={2.5} />
                ) : (
                  <ChevronDown className="ml-1 size-3 shrink-0 opacity-90" strokeWidth={2.5} />
                )}
              </button>
              {isScoringOpen ? (
                <div
                  role="listbox"
                  aria-label="Scoring formats"
                  className="absolute top-full left-0 z-50 mt-1 flex w-20 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white py-0.5 text-left shadow-xl transition-all"
                >
                  {SCORING_OPTIONS.map((option) => {
                    const active = scoringFormat === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onScoringFormatChange(option.value);
                          setIsScoringOpen(false);
                        }}
                        className={cn(
                          "w-full cursor-pointer select-none px-3 py-1.5 text-left text-[11px] transition-colors",
                          active
                            ? "bg-slate-100 font-black text-slate-900"
                            : "font-bold text-slate-600 hover:bg-slate-50/80 hover:text-slate-900",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 z-50 flex select-none flex-row items-center whitespace-nowrap bg-transparent pl-0 text-center uppercase">
        <span
          className={cn(
            "flex shrink-0 items-center justify-center px-2 py-1 text-[11px] font-black uppercase tracking-wider text-white",
            POS_STRIP_BG[player.pos] ?? "bg-slate-700",
          )}
        >
          {player.pos}
        </span>
        <span className="flex flex-row items-center justify-center space-x-1.5 rounded-tr-md rounded-br-none bg-slate-950/90 px-3 py-1 text-center text-[11px] font-black uppercase tracking-wider text-white">
          <span>{teamNickname}</span>
          {!isDefense && jerseyNumber ? <span>#{jerseyNumber}</span> : null}
        </span>
      </div>
    </div>
  );
}

/** Broadcast-style upcoming matchup strip, bound to the player's real NFL team. */
function NextGame({ team }: { team: string }) {
  const { data, isLoading } = useQuery(nextGameQuery(team));
  const logo = (t: string) =>
    `https://sleepercdn.com/images/team_logos/nfl/${(t || "").toLowerCase()}.png`;
  const label = (t: string) => TEAM_NAME[t.toUpperCase()] ?? t;

  if (isLoading)
    return (
      <Widget title="Next game">
        <p className="text-xs text-zinc-500">Loading schedule…</p>
      </Widget>
    );
  if (!data)
    return (
      <Widget title="Next game">
        <p className="text-xs text-zinc-500">No upcoming game scheduled.</p>
      </Widget>
    );

  const home = data.isHome;
  const left = home ? team : data.opponent;
  const right = home ? data.opponent : team;
  const kickoff = data.date
    ? new Date(`${data.date}T17:00:00Z`).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : `Week ${data.week}`;

  return (
    <Widget title="Next game">
      <div className="flex items-center justify-between gap-3">
        <TeamMark team={left} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <img src={logo(left)} alt="" className="size-10" loading="lazy" />
          <span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700">
            {label(left)}
          </span>
        </TeamMark>
        <div className="shrink-0 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            Week {data.week}
          </div>
          <div className="mt-1 text-[11px] font-medium text-zinc-500">{kickoff}</div>
        </div>
        <TeamMark team={right} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <img src={logo(right)} alt="" className="size-10" loading="lazy" />
          <span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700">
            {label(right)}
          </span>
        </TeamMark>
      </div>
    </Widget>
  );
}

function TeamMark({
  team,
  className,
  children,
}: {
  team: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!team) return <div className={className}>{children}</div>;
  return (
    <Link
      to="/nfl-team/$nflId"
      params={{ nflId: team }}
      className={cn(
        "cursor-pointer border-none bg-transparent p-0 font-inherit text-current no-underline decoration-transparent hover:text-current",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3">
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

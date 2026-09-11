import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { PlayerDetail } from "@/components/draft/PlayerDetail";
import type { Pos, Scoring } from "@/lib/draft";
import { NFL_TEAMS, getTeamPrimaryColor, teamById } from "@/lib/nfl-teams";
import { getPlayerDetail, getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

type TeamTabKey = "logs" | "projections" | "sos" | "outlook" | "depth" | "news";

function injuryLetter(injury: string | null | undefined): "Q" | "O" | "IR" | "NA" | null {
  const raw = injury?.toUpperCase()?.trim() ?? "";
  if (!raw || raw === "HEALTHY" || raw === "ACTIVE" || raw === "NONE") return null;
  if (raw === "QUESTIONABLE" || raw === "Q") return "Q";
  if (raw === "OUT" || raw === "DOUBTFUL" || raw === "O" || raw === "D") return "O";
  if (raw === "IR" || raw === "INJURED RESERVE" || raw === "INJURED_RESERVE") return "IR";
  if (raw === "NA" || raw === "INACTIVE" || raw === "NOT ACTIVE" || raw === "NOT_ACTIVE") return "NA";
  return null;
}
const TEAM_TABS: { key: TeamTabKey; label: string }[] = [
  { key: "logs", label: "Game Logs" },
  { key: "projections", label: "Projections" },
  { key: "sos", label: "SOS" },
  { key: "outlook", label: "Outlook" },
  { key: "depth", label: "Depth Chart" },
  { key: "news", label: "News" },
];

const SCORING_OPTIONS: { value: Scoring; label: string }[] = [
  { value: "std", label: "STD" },
  { value: "half", label: "HALF" },
  { value: "ppr", label: "PPR" },
];

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

const playersQuery = () =>
  queryOptions({
    queryKey: ["players"],
    queryFn: () => getPlayers(),
    staleTime: 1000 * 60 * 30,
  });

const defDetailQuery = (id: string | null) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id: id! } }),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 30,
  });

export const Route = createFileRoute("/nfl-team/$nflId")({
  head: ({ params }) => {
    const t = teamById(params.nflId);
    const name = t ? `${t.city} ${t.name}` : "NFL team";
    return {
      meta: [
        { title: `${name} roster & injuries — The League Office` },
        {
          name: "description",
          content: `${name} fantasy roster, projections and training-camp injury tracker.`,
        },
        { property: "og:title", content: `${name} — The League Office` },
        {
          property: "og:description",
          content: `${name} fantasy-relevant roster with projections and injury report.`,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: ({ params }) => {
    if (!teamById(params.nflId)) throw notFound();
  },
  component: NflTeamHub,
});

function NflTeamHub() {
  const { nflId } = Route.useParams();
  const team = teamById(nflId)!;
  const logo = teamLogo(team.id);
  const { data: playersPayload, isLoading: playersLoading } = useQuery(playersQuery());

  const defPlayer = useMemo(() => {
    const list = playersPayload?.players ?? [];
    return (
      list.find((p) => p.pos === "DEF" && p.team === team.id) ??
      list.find((p) => p.pos === "DEF" && (p.id === team.id || p.id.toUpperCase() === team.id)) ??
      null
    );
  }, [playersPayload?.players, team.id]);

  const defId = defPlayer?.id ?? null;
  const { data: defDetail } = useQuery(defDetailQuery(defId));

  const roster = useMemo(
    () =>
      (playersPayload?.players ?? [])
        .filter((p) => p.team === team.id)
        .sort((a, b) => b.proj.half - a.proj.half),
    [playersPayload?.players, team.id],
  );
  const injured = roster.filter((p) => p.injury);

  const [tab, setTab] = useState<TeamTabKey>("logs");
  const [scoringFormat, setScoringFormat] = useState<Scoring>("half");
  const [isScoringOpen, setIsScoringOpen] = useState(false);
  const scoringMenuRef = useRef<HTMLDivElement>(null);
  const detailHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("logs");
  }, [nflId]);

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

  useEffect(() => {
    const label = TEAM_TABS.find((t) => t.key === tab)?.label;
    if (!label || !defId) return;
    const timer = window.setTimeout(() => {
      clickPlayerDetailTab(detailHostRef.current, label);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, defId, nflId]);

  const detailPlayer = defDetail?.player;
  const positionRank =
    (detailPlayer as { position_rank?: number | null } | undefined)?.position_rank ??
    (detailPlayer as { pos_rank?: number | null } | undefined)?.pos_rank ??
    detailPlayer?.posRank;
  const overallRank =
    (detailPlayer as { overall_rank?: number | null } | undefined)?.overall_rank ??
    (typeof detailPlayer?.rank === "number" ? detailPlayer.rank : null) ??
    (detailPlayer && typeof detailPlayer.rank === "object"
      ? detailPlayer.rank[scoringFormat]
      : null);
  const rosteredPct =
    (detailPlayer as { rostered_pct?: number | null; rostered?: number | null } | undefined)
      ?.rostered_pct ??
    (detailPlayer as { rostered?: number | null; percent_owned?: number | null } | undefined)
      ?.rostered ??
    (detailPlayer as { percent_owned?: number | null } | undefined)?.percent_owned ??
    83;
  const startedPct =
    (detailPlayer as { started_pct?: number | null; started?: number | null } | undefined)
      ?.started_pct ??
    (detailPlayer as { started?: number | null } | undefined)?.started ??
    39;
  const defRankLabel =
    typeof positionRank === "number" && positionRank < 900 ? positionRank : 8;
  const overallRankLabel =
    typeof overallRank === "number" && overallRank < 900 ? overallRank : 152;

  return (
    <main className="w-full min-h-screen overflow-y-auto bg-slate-50 text-slate-900">
      <div className="mx-auto mt-0 w-full max-w-7xl overflow-visible px-4 pt-0 lg:px-6">
        <div className="grid w-full grid-cols-1 items-start gap-8 overflow-visible pt-0 lg:grid-cols-[1fr_360px] lg:pt-6">
          {/* Left column — isolated team header + docked subtabs + modal body panels */}
          <div className="relative z-10 flex w-full flex-col items-stretch overflow-visible border-0 bg-transparent p-0 shadow-none">
            <div
              className="relative z-40 flex h-[160px] min-h-[160px] w-full select-none items-center overflow-visible rounded-t-xl rounded-b-none border-x border-t border-slate-100/80 text-white shadow-sm"
              style={{ backgroundColor: getTeamPrimaryColor(team.id) }}
            >
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-1/2 z-10 h-44 w-44 -translate-y-1/2 select-none object-contain opacity-[0.08] mix-blend-overlay"
                />
              ) : null}
              <div className="relative z-20 flex h-[160px] w-[140px] flex-shrink-0 items-center justify-center overflow-visible bg-transparent select-none">
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    className="pointer-events-none relative z-20 h-28 w-28 select-none object-contain drop-shadow-md"
                  />
                ) : null}
              </div>

              <div className="z-20 flex min-w-0 flex-1 flex-col items-start justify-center overflow-visible py-5 pl-6 pr-10 text-left">
                <h1 className="truncate text-3xl font-black tracking-tight text-white">
                  {team.city} {team.name}
                </h1>

                <div className="mt-2 text-sm font-black uppercase tracking-wider text-white/70">
                  CONFERENCE <span className="font-black text-white">{team.conference}</span>
                  <span className="mx-3 text-white/20">|</span>
                  DIVISION <span className="font-black text-white">{team.division}</span>
                </div>

                <div className="mt-2 w-full min-w-0 overflow-visible">
                  <span className="mb-1 block text-left text-[10px] font-black uppercase tracking-widest text-white/50">
                    Player Rankings
                  </span>
                  <div className="flex flex-wrap items-center overflow-visible text-xs font-black uppercase tracking-wide text-white">
                    <span>#{defRankLabel} DEF</span>
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
                        className="relative z-50 flex min-w-[64px] cursor-pointer items-center justify-between rounded-lg border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-white/15 focus:outline-none"
                      >
                        <span>
                          {SCORING_OPTIONS.find((o) => o.value === scoringFormat)?.label ??
                            "HALF"}
                        </span>
                        {isScoringOpen ? (
                          <ChevronUp
                            className="ml-1 size-3 shrink-0 opacity-90"
                            strokeWidth={2.5}
                          />
                        ) : (
                          <ChevronDown
                            className="ml-1 size-3 shrink-0 opacity-90"
                            strokeWidth={2.5}
                          />
                        )}
                      </button>
                      {isScoringOpen ? (
                        <div
                          role="listbox"
                          aria-label="Scoring formats"
                          className="absolute top-full left-0 z-50 mt-1 flex w-20 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 text-left shadow-xl"
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
                                  setScoringFormat(option.value);
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
                <span className="flex shrink-0 items-center justify-center bg-slate-700 px-2 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                  DEF
                </span>
                <span className="flex flex-row items-center justify-center space-x-1.5 rounded-tr-md rounded-br-none bg-slate-950/90 px-3 py-1 text-center text-[11px] font-black uppercase tracking-wider text-white">
                  {team.name.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex w-full select-none items-center space-x-5 overflow-x-auto whitespace-nowrap border-x border-b border-slate-100 bg-white px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TEAM_TABS.map(({ key, label }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "shrink-0 pb-2.5 pt-3 text-xs font-black uppercase tracking-wider transition-colors",
                      active
                        ? "-mb-[1px] border-b-2 border-blue-600 text-slate-900"
                        : "text-slate-400 hover:text-slate-600",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div
              ref={detailHostRef}
              className="w-full overflow-visible border-x border-b border-slate-100 bg-white [&>div>header]:hidden"
            >
              {defId ? (
                <PlayerDetail
                  id={defId}
                  showFullProfileLink={false}
                  scoringFormat={scoringFormat}
                  onScoringFormatChange={setScoringFormat}
                />
              ) : (
                <p className="px-6 py-10 text-center text-sm text-slate-500">
                  {playersLoading
                    ? "Loading team profile…"
                    : "Team defense profile unavailable."}
                </p>
              )}
            </div>
          </div>

          {/* Right column — injury tracker + team jump */}
          <aside>
            <h2 className="font-display text-sm uppercase tracking-widest">Injury tracker</h2>
            <div className="mt-2">
              {injured.map((p) => {
                const letter = injuryLetter(p.injury);
                const badge = letter === "Q" || letter === "O" || letter === "IR" ? letter : "IR";
                const headshot = playerImage(p.id, p.pos as Pos, p.team || team.id);
                const fallbackLogo =
                  teamLogo(team.id) ??
                  `https://sleepercdn.com/images/team_logos/nfl/${team.id.toLowerCase()}.png`;
                return (
                  <Link
                    key={p.id}
                    to="/player/$id"
                    params={{ id: p.id }}
                    className="relative mb-2.5 flex w-full items-center justify-between overflow-hidden rounded-xl border border-slate-100 bg-white p-2.5 text-left shadow-sm transition-all hover:bg-slate-50/40"
                  >
                    <div
                      className="absolute bottom-0 left-0 top-0 w-1"
                      style={{ backgroundColor: getTeamPrimaryColor(team.id) }}
                      aria-hidden="true"
                    />
                    <div className="flex w-full min-w-0 items-center space-x-3 pl-2.5">
                      <div className="relative h-8 w-8 flex-shrink-0 select-none">
                        <span
                          className={cn(
                            "absolute -left-1 -top-1 z-30 flex h-4 w-4 select-none items-center justify-center rounded-full border text-[8px] font-black uppercase leading-none tracking-wide text-white shadow-sm",
                            badge === "IR" && "border-red-800 bg-red-700",
                            badge === "O" && "border-rose-700 bg-rose-600",
                            badge === "Q" && "border-amber-600 bg-amber-500",
                          )}
                        >
                          {badge}
                        </span>
                        <div className="relative z-20 h-8 w-8 overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm">
                          <img
                            src={headshot}
                            alt={p.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = fallbackLogo;
                            }}
                          />
                        </div>
                      </div>
                      <span className="flex shrink-0 select-none items-center justify-center rounded border border-blue-100 bg-blue-50/70 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue-600">
                        {p.pos}
                      </span>
                      <div className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-black text-slate-900">
                          {p.name}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {!injured.length && (
                <div className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-slate-500 shadow-sm">
                  {playersLoading
                    ? "Checking camp reports…"
                    : "No reported injuries. Fully healthy."}
                </div>
              )}
            </div>

            <h2 className="mt-6 font-display text-sm uppercase tracking-widest">Jump to team</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              {NFL_TEAMS.map((t) => (
                <Link
                  key={t.id}
                  to="/nfl-team/$nflId"
                  params={{ nflId: t.id }}
                  className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-accent"
                >
                  {t.id}
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

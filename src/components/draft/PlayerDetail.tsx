import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Cloud, CloudRain, CloudSnow, Star, Sun } from "lucide-react";

import { useEffect, useMemo, useRef, useState } from "react";
import { playerImage, teamLogo } from "./PlayerAvatar";
import { PositionBadge } from "./PositionBadge";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useDraft } from "@/hooks/use-draft";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerSos, useSosPeerMatrix } from "@/hooks/usePlayerSos";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Scoring } from "@/lib/draft";
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor, teamById } from "@/lib/nfl-teams";
import {
  getGameLogs,
  getNextGame,
  getPlayerBio,
  getPlayerDetail,
  getPlayerNews,
} from "@/lib/players.functions";
import type { CareerSeasonRow, GameLog } from "@/lib/players.server";
import { currentSeason, fetchSchedule, type ScheduleGame } from "@/lib/players-build";
import { formatNflGameStatusLabel, formatNflKickoffLabel } from "@/lib/rolling-live-projection";
import { getLeagueScoring } from "@/lib/scoring.functions";
import {
  matchupGrade,
  playoffWindow,
  positionPercentile,
  sosStarsFromRank,
  type PlayerSos,
  type SosGrade,
} from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";

/**
 * Header watermark logo — Raiders use ESPN's dark-canvas (light line-art)
 * asset so shield detail stays visible on black primary fills. No CSS invert.
 */
function getWatermarkLogoUrl(teamCode: string | null | undefined): string | null {
  const formattedTeam = teamCode?.toUpperCase()?.trim() ?? "";
  if (formattedTeam === "LV" || formattedTeam === "OAK") {
    return "https://a.espncdn.com/i/teamlogos/nfl/500-dark/lv.png";
  }
  return teamLogo(teamCode);
}

function isRaidersTeam(teamCode: string | null | undefined): boolean {
  const t = teamCode?.toUpperCase()?.trim() ?? "";
  return t === "LV" || t === "OAK";
}

/** Compact Sleeper-style injury letter for depth-chart sidebar chips. */
function injuryLetter(injury: string | null | undefined): "Q" | "O" | "IR" | "NA" | null {
  const raw = (injury ?? "").trim().toUpperCase();
  if (!raw || raw === "HEALTHY" || raw === "ACTIVE" || raw === "NONE") return null;
  if (raw === "QUESTIONABLE" || raw === "Q") return "Q";
  if (raw === "OUT" || raw === "DOUBTFUL" || raw === "O" || raw === "D") return "O";
  if (raw === "IR" || raw === "INJURED RESERVE") return "IR";
  if (raw === "NA" || raw === "INACTIVE") return "NA";
  return null;
}

/** Full-text header injury capsule with high-contrast broadcast colors. */
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
      tone: "amber" as const,
    };
  }
  if (cleanStatus === "O" || cleanStatus === "OUT") {
    return {
      text: "Out",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
      tone: "rose" as const,
    };
  }
  if (cleanStatus === "D" || cleanStatus === "DOUBTFUL") {
    return {
      text: "Doubtful",
      classes:
        "bg-rose-600 text-white border-none font-black text-[10px] shadow-sm shadow-rose-600/10",
      tone: "rose" as const,
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
      tone: "rose" as const,
    };
  }
  // ESPN compliance: NA is an active non-football roster restriction.
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
      tone: "rose" as const,
    };
  }
  // Healthy / unrecognized statuses stay badge-free.
  return null;
}

const MEDICAL_NOTES_FALLBACK =
  "Evaluating daily recovery milestones. Monitor official team practice logs for updated depth-chart clearance status leading up to kickoff.";

/** Solid position theme fill for the cutout jersey strip. */
const POS_STRIP_BG: Record<string, string> = {
  QB: "bg-qb",
  RB: "bg-rb",
  WR: "bg-wr",
  TE: "bg-te",
  K: "bg-k",
  DEF: "bg-def",
};

function VitalsDivider() {
  return <span className="mx-3 text-white/20">|</span>;
}

type DetailTab = "logs" | "projections" | "sos" | "outlook" | "depth" | "news";

const DETAIL_TABS: { key: DetailTab; label: string }[] = [
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

export const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

export function PlayerDetail({
  id,
  onSelectPlayer,
  onClose,
  showDraftActions = false,
  showFullProfileLink = true,
}: {
  id: string;
  onSelectPlayer?: (id: string) => void;
  /** Close the hosting modal when navigating to the full profile page. */
  onClose?: () => void;
  /** When true, render Draft action controls (War Room / Mock Draft only). */
  showDraftActions?: boolean;
  /** When false, hide the Full Profile utility (standalone profile page). */
  showFullProfileLink?: boolean;
}) {
  const { data, isLoading } = useQuery(detailQuery(id));
  const { data: bio } = useQuery({
    queryKey: ["player-bio", id],
    queryFn: () => getPlayerBio({ data: { id } }),
    staleTime: 1000 * 60 * 60 * 12,
  });
  const draft = useDraft();
  const { activeLeague } = useActiveLeague();
  const brain = usePlayerBrain();
  const playerSos = usePlayerSos(
    (data ? brain?.[data.player.id] : null) ?? null,
    data?.player.team ?? null,
  );
  const [tab, setTab] = useState<DetailTab>("logs");
  const [scoringFormat, setScoringFormat] = useState<Scoring>(draft.settings.scoring);
  const [isScoringOpen, setIsScoringOpen] = useState(false);
  const scoringMenuRef = useRef<HTMLDivElement>(null);

  const leagueScoringQuery = useQuery({
    queryKey: [
      "player-detail-league-scoring",
      activeLeague?.platform,
      activeLeague?.leagueId,
    ],
    enabled: Boolean(activeLeague?.leagueId),
    staleTime: 1000 * 60 * 60,
    queryFn: () =>
      getLeagueScoring({
        data: {
          identifier: activeLeague!.leagueId,
          platform: activeLeague!.platform,
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  useEffect(() => {
    const format = leagueScoringQuery.data?.format;
    if (format === "std" || format === "half" || format === "ppr") {
      setScoringFormat(format);
    }
  }, [leagueScoringQuery.data?.format]);

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

  if (isLoading) return <p className="p-6 text-center text-sm text-muted-foreground">Loading player…</p>;
  if (!data) return <p className="p-6 text-center text-sm text-muted-foreground">Player not found.</p>;

  const { player, depthChart } = data;
  const scoring = scoringFormat;
  const drafted = draft.draftedIds.has(player.id);
  const watched = draft.watchIds.has(player.id);
  const watermarkLogo = getWatermarkLogoUrl(player.team);
  const raidersWatermark = isRaidersTeam(player.team);
  const teamMeta = teamById(player.team);
  const teamNickname = (teamMeta?.name ?? player.team ?? "FA").toUpperCase();
  const jerseyNumber = bio?.number != null ? String(bio.number) : null;
  const isDefense = player.pos === "DEF";
  const conference =
    (player as { conference?: string | null }).conference ??
    teamMeta?.conference ??
    "NFC";
  const division =
    (player as { division?: string | null }).division ??
    teamMeta?.division ??
    "NORTH";

  // Prefer catalog age; otherwise derive from Sleeper birth_date (bio.birthDate).
  const birthDate =
    (player as { birth_date?: string | null }).birth_date ?? bio?.birthDate ?? null;
  const displayAge =
    player.age ||
    (birthDate
      ? Math.floor((Date.now() - new Date(birthDate).getTime()) / 31557600000)
      : "—");

  const injuryStatusRaw =
    player.injury_status ||
    player.injuryStatus ||
    player.injury ||
    (player as { status?: string | null }).status ||
    null;
  const injuryDetails = getFullInjuryBadgeDetails(injuryStatusRaw);
  const injuryBodyPart =
    player.injury_body_part?.trim() ||
    brain?.[player.id]?.injuryType?.trim() ||
    "";
  const injuryNotesText =
    player.injury_notes?.trim() ||
    (
      player as { metadata?: { injury_notes?: string | null } | null }
    ).metadata?.injury_notes?.trim() ||
    brain?.[player.id]?.injuryNotes?.trim() ||
    MEDICAL_NOTES_FALLBACK;
  const height = bio?.height?.trim() || (player as { height?: string | null }).height || "—";
  const weight = bio?.weight?.trim() || (player as { weight?: string | null }).weight || "—";
  const college = bio?.college?.trim() || (player as { college?: string | null }).college || "—";
  const expYears =
    player.exp != null
      ? player.exp
      : (player as { years_exp?: number | null }).years_exp != null
        ? (player as { years_exp?: number | null }).years_exp
        : "—";
  const rosteredPct =
    (player as { rostered_pct?: number | null; rostered?: number | null }).rostered_pct ??
    (player as { rostered?: number | null; percent_owned?: number | null }).rostered ??
    (player as { percent_owned?: number | null }).percent_owned ??
    83;
  const startedPct =
    (player as { started_pct?: number | null; started?: number | null }).started_pct ??
    (player as { started?: number | null }).started ??
    39;
  const positionRank =
    (player as { position_rank?: number | null }).position_rank ??
    (player as { pos_rank?: number | null }).pos_rank ??
    player.posRank;
  const overallRank =
    (player as { overall_rank?: number | null }).overall_rank ??
    (typeof player.rank === "number" ? player.rank : null) ??
    player.rank[scoring];
  const posRankLabel = positionRank < 900 ? positionRank : "—";
  const overallRankLabel = overallRank < 900 ? overallRank : "—";

  return (
    <div className="overflow-visible pb-8">
      <header className="overflow-visible">
        <div
          className={cn(
            "relative flex min-h-[160px] w-full items-stretch overflow-visible text-white shadow-sm",
            !showFullProfileLink && "rounded-t-xl",
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

          <div
            className="relative z-20 mb-0 ml-0 mt-0 flex h-[160px] w-[140px] flex-shrink-0 items-end overflow-visible rounded-bl-none bg-transparent pl-0 select-none"
            style={{ backgroundColor: getTeamPrimaryColor(player.team) }}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-bl-none bg-transparent"
              style={{ backgroundColor: getTeamPrimaryColor(player.team) }}
            >
              <img
                src={playerImage(player.id, player.pos, player.team)}
                alt=""
                loading="lazy"
                className="pointer-events-none relative z-20 h-full w-full select-none object-cover object-[55%_center] transition-all"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            </div>
            <div className="absolute bottom-0 left-0 z-30 flex min-w-full w-max max-w-[200px] flex-row items-center whitespace-nowrap rounded-tr-md rounded-br-none bg-transparent pl-0">
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-none px-2 py-1 text-[11px] font-black uppercase tracking-wider text-white",
                  POS_STRIP_BG[player.pos] ?? "bg-slate-700",
                )}
              >
                {player.pos}
              </span>
              <span className="flex flex-row items-center justify-center space-x-1.5 whitespace-nowrap rounded-tr-md rounded-br-none bg-slate-950/90 px-3 py-1 text-center text-[11px] font-black uppercase tracking-wider text-white">
                <span>{teamNickname}</span>
                {!isDefense && jerseyNumber ? <span>#{jerseyNumber}</span> : null}
              </span>
            </div>
          </div>

          <div className="z-20 flex min-w-0 flex-1 flex-col items-start justify-center overflow-visible py-5 pl-6 pr-10 text-left">
            <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-visible">
              <h1 className="truncate text-3xl font-black tracking-tight text-white">
                {player.name}
              </h1>
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
              <div className="relative z-30 ml-3 flex items-center space-x-3">
                <button
                  type="button"
                  aria-label={watched ? "Unwatch" : "Watch"}
                  aria-pressed={watched}
                  onClick={() => draft.toggleWatch(player.id)}
                  className="group inline-flex max-w-[38px] cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-full border border-white/20 bg-white/5 px-2.5 py-1.5 transition-all duration-300 hover:max-w-[130px] hover:border-white/40 hover:bg-white/10"
                >
                  <Star
                    className={cn(
                      "size-3.5 shrink-0",
                      watched ? "fill-amber-400 text-amber-400" : "text-white/90",
                    )}
                    strokeWidth={watched ? 0 : 2}
                  />
                  <span className="ml-1.5 text-[10px] font-black uppercase tracking-wider text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {watched ? "Unwatch" : "Watch"}
                  </span>
                </button>
                {showDraftActions ? (
                  <button
                    type="button"
                    disabled={drafted}
                    onClick={() => {
                      if (!drafted) draft.draftPlayer(player.id);
                    }}
                    className={cn(
                      "relative z-30 inline-flex min-w-[76px] items-center justify-center rounded-full px-4 py-1.5 text-xs font-black tracking-wide uppercase whitespace-nowrap shadow-sm transition-all duration-200",
                      drafted
                        ? "pointer-events-none cursor-default border border-white/10 bg-white/10 text-white/40"
                        : "cursor-pointer border border-white bg-white text-slate-900 hover:bg-slate-100",
                    )}
                  >
                    {drafted ? "Drafted" : "Draft"}
                  </button>
                ) : null}
              </div>
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
                <VitalsDivider />
                <span>HEIGHT {height}</span>
                <VitalsDivider />
                <span>WEIGHT {weight}</span>
                <VitalsDivider />
                <span>EXP {expYears}</span>
                <VitalsDivider />
                <span>
                  COLLEGE <span className="font-black text-white">{college}</span>
                </span>
              </div>
            )}

            <div className="mt-2 w-full min-w-0">
              <span className="mb-1 block text-left text-[10px] font-black uppercase tracking-widest text-white/50">
                Player Rankings
              </span>
              <div className="flex flex-wrap items-center text-xs font-black uppercase tracking-wide text-white">
                <span>
                  #{posRankLabel} {player.pos}
                </span>
                <VitalsDivider />
                <span>#{overallRankLabel} OVERALL</span>
                <VitalsDivider />
                <span>{Math.round(Number(rosteredPct) || 83)}% ROSTERED</span>
                <VitalsDivider />
                <span>{Math.round(Number(startedPct) || 39)}% STARTED</span>
                <div ref={scoringMenuRef} className="relative z-50 ml-6 inline-block text-left">
                  <button
                    type="button"
                    aria-label="Scoring format"
                    aria-expanded={isScoringOpen}
                    aria-haspopup="listbox"
                    onClick={() => setIsScoringOpen(!isScoringOpen)}
                    className="relative z-30 flex min-w-[64px] cursor-pointer items-center justify-between rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white transition-all select-none hover:bg-white/15"
                  >
                    <span>
                      {SCORING_OPTIONS.find((o) => o.value === scoringFormat)?.label ?? "HALF"}
                    </span>
                    {isScoringOpen ? (
                      <ChevronUp className="ml-1.5 size-3 shrink-0 opacity-90" strokeWidth={2.5} />
                    ) : (
                      <ChevronDown className="ml-1.5 size-3 shrink-0 opacity-90" strokeWidth={2.5} />
                    )}
                  </button>
                  {isScoringOpen ? (
                    <div
                      role="listbox"
                      aria-label="Scoring formats"
                      className="absolute top-full right-0 z-50 mt-1.5 flex w-20 origin-top-right transform flex-col overflow-visible rounded-lg border border-slate-200/80 bg-white py-0.5 text-left shadow-xl transition-all"
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
        </div>

        <div className="flex w-full select-none items-center justify-between overflow-visible border-b border-slate-100 bg-white px-6">
          <div className="flex items-center space-x-5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {DETAIL_TABS.map(({ key, label }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
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
          {showFullProfileLink ? (
            <Link
              to="/player/$id"
              params={{ id: player.id }}
              onClick={() => onClose?.()}
              className="relative z-30 ml-auto flex cursor-pointer select-none items-center pb-0.5 text-xs font-black uppercase tracking-wider text-slate-400 transition-colors hover:text-blue-600"
            >
              <span>Full Profile</span>
              <span className="ml-1 text-sm font-light leading-none">→</span>
            </Link>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          tab === "logs" || tab === "projections" || tab === "sos" ? "px-0 py-0" : "px-7 py-5",
        )}
      >
        {tab === "logs" && (
          <GameLogsPanel
            id={player.id}
            pos={player.pos}
            team={player.team}
            scoringFormat={scoringFormat}
            exp={player.exp}
          />
        )}
        {tab === "projections" && (
          <ProjectionsPanel id={player.id} pos={player.pos} scoringFormat={scoringFormat} />
        )}
        {tab === "sos" && (
          <SosHeatmapPanel
            playerId={player.id}
            pos={player.pos}
            team={player.team}
            brainSos={playerSos}
          />
        )}
        {tab === "outlook" && (
          <OutlookPanel
            playerId={player.id}
            team={player.team}
            posRankLabel={
              typeof positionRank === "number" && positionRank < 900
                ? `${player.pos}${positionRank}`
                : `${player.pos}—`
            }
            brainSos={playerSos}
            scoringFormat={scoringFormat}
          />
        )}
        {tab === "depth" && (
          <DepthChartPanel
            playerId={player.id}
            team={player.team}
            depthChart={depthChart}
            {...(onSelectPlayer ? { onSelectPlayer } : {})}
          />
        )}
        {tab === "news" && (
          <EditorialNewsPanel
            id={player.id}
            injuryDetails={injuryDetails}
            injuryStatus={injuryStatusRaw}
            injuryBodyPart={injuryBodyPart}
            injuryNotes={injuryNotesText}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab panels                                                          */
/* ------------------------------------------------------------------ */

const LOG_SEASONS = ["2026", "2025", "2024", "2023", "2022"] as const;
type LogSeason = (typeof LOG_SEASONS)[number];

type StatCol =
  | { kind: "stat"; key: string; label: string }
  | { kind: "avg"; numKey: string; denKey: string; label: string };

type StatGroup = { label: string; cols: StatCol[] };

const CATEGORY_TH =
  "text-[10px] font-black tracking-widest text-slate-400 uppercase text-center border-b border-slate-100 py-1";
const MICRO_TH =
  "px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-900";

/** Position-specific macro groups for Sleeper-style double-tier headers. */
function positionStatGroups(pos: string): StatGroup[] {
  switch (pos) {
    case "QB":
      return [
        {
          label: "PASSING",
          cols: [
            { kind: "stat", key: "pass_cmp", label: "CMP" },
            { kind: "stat", key: "pass_att", label: "ATT" },
            { kind: "stat", key: "pass_yd", label: "PYD" },
            { kind: "stat", key: "pass_td", label: "PTD" },
            { kind: "stat", key: "pass_int", label: "INT" },
          ],
        },
        {
          label: "RUSHING",
          cols: [
            { kind: "stat", key: "rush_att", label: "CAR" },
            { kind: "stat", key: "rush_yd", label: "RYD" },
            { kind: "stat", key: "rush_td", label: "RTD" },
          ],
        },
      ];
    case "RB":
      return [
        {
          label: "RUSHING",
          cols: [
            { kind: "stat", key: "rush_att", label: "CAR" },
            { kind: "stat", key: "rush_yd", label: "RYD" },
            { kind: "avg", numKey: "rush_yd", denKey: "rush_att", label: "RAVG" },
            { kind: "stat", key: "rush_td", label: "RTD" },
          ],
        },
        {
          label: "RECEIVING",
          cols: [
            { kind: "stat", key: "rec_tgt", label: "TAR" },
            { kind: "stat", key: "rec", label: "REC" },
            { kind: "stat", key: "rec_yd", label: "YDS" },
            { kind: "avg", numKey: "rec_yd", denKey: "rec", label: "AVG" },
            { kind: "stat", key: "rec_td", label: "TD" },
          ],
        },
        {
          label: "FUMBLE",
          cols: [
            { kind: "stat", key: "fum", label: "FUM" },
            { kind: "stat", key: "fum_lost", label: "LOST" },
          ],
        },
      ];
    case "K":
      return [
        {
          label: "FIELD GOALS",
          cols: [
            { kind: "stat", key: "fgm", label: "FGM" },
            { kind: "stat", key: "fga", label: "FGA" },
            { kind: "stat", key: "fgmiss", label: "MISS" },
          ],
        },
        {
          label: "EXTRA POINTS",
          cols: [{ kind: "stat", key: "xpm", label: "XPM" }],
        },
      ];
    case "DEF":
      return [
        {
          label: "SACKS",
          cols: [{ kind: "stat", key: "sack", label: "SACK" }],
        },
        {
          label: "TURNOVERS",
          cols: [
            { kind: "stat", key: "int", label: "INT" },
            { kind: "stat", key: "ff", label: "FF" },
            { kind: "stat", key: "fum_rec", label: "FR" },
          ],
        },
        {
          label: "POINTS ALLOWED",
          cols: [
            { kind: "stat", key: "def_st_td", label: "TD" },
            { kind: "stat", key: "pts_allow", label: "PA" },
          ],
        },
      ];
    case "WR":
    case "TE":
    default:
      return [
        {
          label: "RECEIVING",
          cols: [
            { kind: "stat", key: "rec_tgt", label: "TAR" },
            { kind: "stat", key: "rec", label: "REC" },
            { kind: "stat", key: "rec_yd", label: "YDS" },
            { kind: "avg", numKey: "rec_yd", denKey: "rec", label: "AVG" },
            { kind: "stat", key: "rec_td", label: "TD" },
          ],
        },
        {
          label: "FUMBLE",
          cols: [
            { kind: "stat", key: "fum", label: "FUM" },
            { kind: "stat", key: "fum_lost", label: "LOST" },
          ],
        },
      ];
  }
}

function positionStatCols(pos: string): StatCol[] {
  return positionStatGroups(pos).flatMap((g) => g.cols);
}

function DoubleTierThead({
  leftLabels,
  fantasyLabels,
  groups,
}: {
  leftLabels: string[];
  fantasyLabels: string[];
  groups: StatGroup[];
}) {
  return (
    <thead>
      <tr>
        <th colSpan={leftLabels.length} className={CATEGORY_TH} aria-hidden />
        <th colSpan={fantasyLabels.length} className={CATEGORY_TH}>
          FANTASY
        </th>
        {groups.map((g) => (
          <th key={g.label} colSpan={g.cols.length} className={CATEGORY_TH}>
            {g.label}
          </th>
        ))}
      </tr>
      <tr className="border-b border-slate-100 bg-white text-left">
        {leftLabels.map((h, i) => (
          <th key={`left-${h}`} className={cn(MICRO_TH, i === 0 ? "text-left" : "text-center")}>
            {h}
          </th>
        ))}
        {fantasyLabels.map((h) => (
          <th key={`fan-${h}`} className={cn(MICRO_TH, "text-center")}>
            {h}
          </th>
        ))}
        {groups.flatMap((g) =>
          g.cols.map((col) => (
            <th key={`${g.label}-${col.label}`} className={cn(MICRO_TH, "text-center")}>
              {col.label}
            </th>
          )),
        )}
      </tr>
    </thead>
  );
}

function formatLabel(scoring: Scoring): string {
  return scoring === "std" ? "STD" : scoring === "ppr" ? "PPR" : "HALF";
}

function ptsForFormat(
  points: { std: number | null; half: number | null; ppr: number | null } | null | undefined,
  scoring: Scoring,
): number | null {
  if (!points) return null;
  const v = points[scoring];
  return v != null && Number.isFinite(v) ? v : null;
}

function projForFormat(
  proj: GameLog["proj"],
  scoring: Scoring,
): number | null {
  if (!proj) return null;
  const v = proj[scoring];
  return v != null && Number.isFinite(v) ? v : null;
}

function numOrDash(
  raw: Record<string, number> | undefined,
  key: string,
  played: boolean,
): string {
  if (!played || !raw || raw[key] == null || !Number.isFinite(raw[key]!)) return "-";
  const v = raw[key]!;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function avgOrDash(
  raw: Record<string, number> | undefined,
  numKey: string,
  denKey: string,
  played: boolean,
): string {
  if (!played || !raw) return "-";
  const num = raw[numKey];
  const den = raw[denKey];
  if (num == null || den == null || den === 0) return "-";
  return (num / den).toFixed(1);
}

function fmtMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderStatCells(
  raw: Record<string, number> | undefined,
  cols: StatCol[],
  played: boolean,
) {
  return cols.map((col) => (
    <td key={col.label} className="px-3 py-2.5 text-center font-mono text-slate-700">
      {col.kind === "avg"
        ? avgOrDash(raw, col.numKey, col.denKey, played)
        : numOrDash(raw, col.key, played)}
    </td>
  ));
}

function GameLogsPanel({
  id,
  pos,
  team,
  scoringFormat,
  exp,
}: {
  id: string;
  pos: string;
  team: string;
  scoringFormat: Scoring;
  exp?: number | null;
}) {
  // Parse experience to an integer; default to 1 for rookies or empty values.
  // Team defenses bypass career limits and unlock the full historical log range.
  const isDefense = pos === "DEF";
  const yearsExp = Math.max(1, Math.floor(Number(exp)) || 1);
  const currentSeasonYear = 2026;
  const rookieEntryYear = isDefense ? 2022 : currentSeasonYear - (yearsExp - 1);
  const availableSeasons = useMemo(
    () =>
      LOG_SEASONS.filter((yearStr) => Number.parseInt(yearStr, 10) >= rookieEntryYear),
    [rookieEntryYear],
  );

  const [season, setSeason] = useState<LogSeason>(
    () => availableSeasons[0] ?? "2026",
  );

  useEffect(() => {
    if (!availableSeasons.includes(season)) {
      setSeason(availableSeasons[0] ?? "2026");
    }
  }, [availableSeasons, season]);

  const statGroups = useMemo(() => positionStatGroups(pos), [pos]);
  const statCols = useMemo(() => positionStatCols(pos), [pos]);
  const formatTag = formatLabel(scoringFormat);
  const teamPrimary = getTeamPrimaryColor(team);

  const { data, isLoading } = useQuery({
    queryKey: ["player-logs", id, season],
    queryFn: () => getGameLogs({ data: { id, season } }),
    staleTime: 1000 * 60 * 30,
  });

  const career = data?.career ?? [];

  return (
    <div className="w-full">
      <div className="relative z-20 flex w-full select-none items-center space-x-2.5 overflow-x-auto whitespace-nowrap border-b border-slate-100 bg-white px-6 py-2.5 shadow-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {availableSeasons.map((option) => {
          const isActive = season === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setSeason(option)}
              style={isActive ? { backgroundColor: teamPrimary } : undefined}
              className={
                isActive
                  ? "select-none rounded-full px-3 py-1.5 text-xs font-black tracking-wide text-white shadow-sm"
                  : "cursor-pointer select-none rounded-full px-3 py-1.5 text-xs font-black text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-700"
              }
            >
              {option}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="px-6 py-8 text-center text-sm text-slate-400">Loading game logs…</p>
      ) : !data || data.logs.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-slate-400">No game logs recorded yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <DoubleTierThead
                leftLabels={["WK", "OPP", "PROJ"]}
                fantasyLabels={["PTS"]}
                groups={statGroups}
              />
              <tbody>
                {data.logs.map((g, index) => {
                  const played = g.played !== false && !g.isBye;
                  const ptsVal = ptsForFormat(g.points, scoringFormat);
                  const pts =
                    played && ptsVal != null ? ptsVal.toFixed(1) : "-";
                  const projVal = projForFormat(g.proj, scoringFormat);
                  const hasProj = projVal != null;
                  const isBye = Boolean(g.isBye) || g.opp === "BYE";

                  return (
                    <tr
                      key={`${g.seasonYear ?? season}-${g.week}-${index}`}
                      className={cn(
                        "border-b border-slate-100 last:border-0",
                        index % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                      )}
                    >
                      <td className="px-3 py-2.5 text-left font-semibold text-slate-900">
                        {String(g.week)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-slate-700">
                        {isBye ? (
                          <span className="text-xs font-extrabold tracking-wide text-slate-400">
                            BYE
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            {(g as { isAway?: boolean }).isAway ||
                            (g as { location?: string }).location === "away" ||
                            g.opp?.trim().startsWith("@")
                              ? `@ ${g.opp?.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase() ?? ""}`
                              : g.opp?.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase() || "-"}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-center font-mono",
                          hasProj ? "font-bold text-slate-900" : "text-slate-700",
                        )}
                      >
                        {hasProj ? projVal.toFixed(1) : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-slate-800">{pts}</td>
                      {renderStatCells(g.raw, statCols, played)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-6 pb-6">
            <span className="mb-2.5 mt-6 block w-full text-left text-xs font-black uppercase tracking-widest text-slate-900">
              CAREER TOTALS
            </span>
            {career.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No career season totals yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <DoubleTierThead
                    leftLabels={["YR", "TM", "GM"]}
                    fantasyLabels={[`Pts (${formatTag})`, `Pos Rank (${formatTag})`]}
                    groups={statGroups}
                  />
                  <tbody>
                    {career.map((row: CareerSeasonRow, index) => {
                      const pts = ptsForFormat(row.pts, scoringFormat);
                      const rank = row.posRank?.[scoringFormat] ?? null;
                      return (
                        <tr
                          key={row.year}
                          className={cn(
                            "border-b border-slate-100 last:border-0",
                            index % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                          )}
                        >
                          <td className="px-3 py-2.5 text-left font-semibold text-slate-900">
                            {row.year}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-slate-700">
                            {row.team || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-slate-700">
                            {row.games > 0 ? String(row.games) : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-900">
                            {fmtMetric(pts)}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-slate-700">
                            {rank != null && rank > 0 ? String(rank) : "-"}
                          </td>
                          {renderStatCells(row.raw, statCols, true)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectionsPanel({
  id,
  pos,
  scoringFormat,
}: {
  id: string;
  pos: string;
  scoringFormat: Scoring;
}) {
  const statGroups = useMemo(() => positionStatGroups(pos), [pos]);
  const statCols = useMemo(() => positionStatCols(pos), [pos]);

  const { data, isLoading } = useQuery({
    queryKey: ["player-projections-weekly", id],
    queryFn: () => getGameLogs({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) {
    return <p className="px-6 py-8 text-center text-sm text-slate-400">Loading projections…</p>;
  }
  if (!data || data.logs.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-slate-400">No weekly projections available.</p>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <DoubleTierThead
          leftLabels={["WK", "OPP", "PROJ"]}
          fantasyLabels={["PTS"]}
          groups={statGroups}
        />
        <tbody>
          {data.logs.map((g, index) => {
            const isBye = Boolean(g.isBye) || g.opp === "BYE";
            const projVal = projForFormat(g.proj, scoringFormat);
            const hasProj = !isBye && projVal != null;
            const ptsDisplay = hasProj ? projVal.toFixed(1) : "-";
            const showStats = !isBye && Boolean(g.projRaw && Object.keys(g.projRaw).length);

            return (
              <tr
                key={`proj-${g.week}-${index}`}
                className={cn(
                  "border-b border-slate-100 last:border-0",
                  index % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                )}
              >
                <td className="px-3 py-2.5 text-left font-semibold text-slate-900">
                  {String(g.week)}
                </td>
                <td className="px-3 py-2.5 text-center font-bold text-slate-700">
                  {isBye ? (
                    <span className="text-xs font-extrabold tracking-wide text-slate-400">
                      BYE
                    </span>
                  ) : (
                    <span className="text-slate-600">
                      {(g as { isAway?: boolean }).isAway ||
                      (g as { location?: string }).location === "away" ||
                      g.opp?.trim().startsWith("@")
                        ? `@ ${g.opp?.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase() ?? ""}`
                        : g.opp?.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase() || "-"}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 text-center font-mono",
                    hasProj ? "font-bold text-slate-900" : "text-slate-700",
                  )}
                >
                  {ptsDisplay}
                </td>
                <td className="px-3 py-2.5 text-center font-mono text-slate-800">{ptsDisplay}</td>
                {renderStatCells(g.projRaw, statCols, showStats)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact ET kickoff label, e.g. "Sun 4:25PM ET". */
function formatOutlookKickoff(iso?: string | null, dateOnly?: string | null): string {
  const fromIso = formatNflKickoffLabel(iso);
  if (fromIso) {
    const cleaned = fromIso.replace(/\s+(AM|PM)/i, (_, m: string) => m.toUpperCase());
    return cleaned.includes("ET") ? cleaned : `${cleaned} ET`;
  }
  if (!dateOnly) return "TBD";
  const d = new Date(`${dateOnly}T17:00:00Z`);
  if (Number.isNaN(d.getTime())) return "TBD";
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  });
  const time = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(/\s+/g, "")
    .replace(/([ap]m)/i, (m) => m.toUpperCase());
  return `${day} ${time} ET`;
}

/** NFL franchises with indoor / domed / retractable-roof home venues. */
const INDOOR_HOME_TEAMS = new Set([
  "ARI",
  "ATL",
  "DAL",
  "DET",
  "HOU",
  "IND",
  "LAC",
  "LAR",
  "LV",
  "MIN",
  "NO",
]);

type SosDifficultyTone = "elite" | "neutral" | "tough" | "bye";

function sosDifficultyFromStars(stars: number | null): {
  tone: SosDifficultyTone;
  label: string | null;
} {
  if (stars == null) return { tone: "bye", label: null };
  if (stars >= 5) return { tone: "elite", label: "Great" };
  if (stars >= 3) return { tone: "neutral", label: "Neutral" };
  return { tone: "tough", label: "Tough" };
}

function SosStarRow({ count }: { count: number }) {
  const activeCount = Math.max(0, Math.min(5, count));
  return (
    <div className="flex select-none items-center space-x-0.5 text-left text-sm tracking-tight">
      {Array.from({ length: 5 }).map((_, i) => {
        const starIndex = i + 1;
        const isActive = starIndex <= activeCount;
        return (
          <span
            key={i}
            className={isActive ? "fill-amber-500 text-amber-500" : "text-slate-200"}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}

function sosOverviewBadge(grade: SosGrade): string {
  if (grade === "CAKEWALK") return "ELITE";
  if (grade === "ADVANTAGEOUS") return "SOFT";
  if (grade === "CATASTROPHIC") return "HARD";
  return "MID";
}

function compactPercentileLabel(raw: string | null): string {
  if (!raw) return "Baseline";
  const top = raw.match(/Top\s+(\d+)%/i);
  if (top?.[1]) return `Top ${top[1]}%`;
  if (raw.toLowerCase().includes("baseline")) return "Baseline";
  return "Balanced";
}

function SosHeatmapPanel({
  playerId,
  pos,
  team,
  brainSos,
}: {
  playerId: string;
  pos: string;
  team: string;
  brainSos: PlayerSos | null;
}) {
  const upperTeam = (team || "").toUpperCase();
  const brain = usePlayerBrain();
  const sosPeers = useSosPeerMatrix(pos, brain);

  const scheduleQuery = useQuery({
    queryKey: ["player-sos-schedule", currentSeason()],
    queryFn: () => fetchSchedule(currentSeason()),
    staleTime: 1000 * 60 * 60 * 12,
    enabled: Boolean(upperTeam && upperTeam !== "FA"),
  });

  const overallGrade = matchupGrade(brainSos?.rank ?? null);
  const overallBadge = sosOverviewBadge(overallGrade);
  const percentileRaw = positionPercentile(
    playerId,
    pos,
    sosPeers ?? brain,
    brainSos,
  );
  const percentileLabel = compactPercentileLabel(percentileRaw);
  const playoffLabel = playoffWindow(brainSos);

  const rows = useMemo(() => {
    const matchups = brainSos?.matchups ?? [];
    const byWeek = new Map(matchups.map((m) => [Number(m.week), m]));
    const games = (scheduleQuery.data ?? []) as ScheduleGame[];
    const out: {
      week: number;
      isBye: boolean;
      isAway: boolean;
      opp: string;
      stars: number | null;
      tone: SosDifficultyTone;
      label: string | null;
      stadium: string;
    }[] = [];

    for (let week = 1; week <= 18; week++) {
      const hit = byWeek.get(week);
      if (!hit || !hit.opp || hit.opp.toUpperCase() === "BYE") {
        out.push({
          week,
          isBye: true,
          isAway: false,
          opp: "BYE",
          stars: null,
          tone: "bye",
          label: null,
          stadium: "—",
        });
        continue;
      }

      const stars = sosStarsFromRank(hit.rank);
      const { tone, label } = sosDifficultyFromStars(stars);
      const game = games.find((g) => {
        if (Number(g.week) !== week) return false;
        const home = (g.home || "").toUpperCase();
        const away = (g.away || "").toUpperCase();
        return home === upperTeam || away === upperTeam;
      });
      const isHome = game ? (game.home || "").toUpperCase() === upperTeam : true;
      const isAway = Boolean(game) && !isHome;
      const venueTeam = isHome ? upperTeam : (hit.opp || "").toUpperCase();
      const stadium = INDOOR_HOME_TEAMS.has(venueTeam) ? "Indoor" : "Outdoor";

      out.push({
        week,
        isBye: false,
        isAway,
        opp: hit.opp.toUpperCase(),
        stars,
        tone,
        label,
        stadium,
      });
    }
    return out;
  }, [brainSos, scheduleQuery.data, upperTeam]);

  if (!upperTeam || upperTeam === "FA") {
    return (
      <div className="flex w-full flex-col overflow-visible bg-white px-6 py-4 text-left">
        <p className="py-8 text-center text-sm text-slate-400">
          Strength of schedule is unavailable for free agents.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col overflow-visible bg-white px-6 py-4 text-left">
      <div className="relative mb-6 flex w-full select-none flex-col items-start overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50 p-5 text-left">
        <span className="mb-3 block text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
          Strength of Schedule Overview
        </span>
        <div className="grid w-full grid-cols-1 divide-y divide-slate-100 rounded-xl border border-slate-200/60 bg-white p-4 text-center shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col items-center justify-center p-3 text-center sm:p-2">
            <div className="flex items-center space-x-2.5">
              <span className="text-xl font-black uppercase tracking-wide text-slate-900">
                {overallGrade}
              </span>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-inner">
                {overallBadge}
              </span>
            </div>
            <span className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Overall Matchup Rating
            </span>
          </div>
          <div className="flex flex-col items-center justify-center p-3 text-center sm:p-2">
            <span className="text-xl font-black uppercase tracking-tight text-slate-900">
              {percentileLabel}
            </span>
            <span className="mt-1.5 max-w-[160px] text-[9px] font-bold uppercase leading-tight tracking-widest text-slate-400">
              Position Percentile Rank
            </span>
          </div>
          <div className="flex flex-col items-center justify-center p-3 text-center sm:p-2">
            <span className="text-xl font-black uppercase tracking-tight text-slate-900">
              {playoffLabel}
            </span>
            <span className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Playoff Window Outlook
            </span>
          </div>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["WK", "OPPONENT", "MATCHUP STRENGTH", "DIFFICULTY", "STADIUM STATUS"].map(
                (label) => (
                  <th
                    key={label}
                    className="border-b border-slate-100 pb-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.week}
                className={cn(
                  "border-b border-slate-100 last:border-0",
                  index % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                )}
              >
                <td className="px-0 py-2.5 pr-3 text-left font-semibold text-slate-900">
                  {row.week}
                </td>
                <td className="px-3 py-2.5 text-left font-bold text-slate-800">
                  {row.isBye ? "BYE" : row.isAway ? `@ ${row.opp}` : row.opp}
                </td>
                <td className="px-3 py-2.5 text-left">
                  {row.isBye ? (
                    <span className="pl-4 text-xs font-extrabold tracking-wide text-slate-400">
                      -
                    </span>
                  ) : (
                    <SosStarRow count={row.stars ?? 0} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-left">
                  {row.isBye || !row.label ? (
                    <span className="text-xs font-extrabold tracking-wide text-slate-400">-</span>
                  ) : row.tone === "elite" ? (
                    <span className="ml-0 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm">
                      Great
                    </span>
                  ) : row.tone === "neutral" ? (
                    <span className="ml-0 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-sm">
                      Neutral
                    </span>
                  ) : (
                    <span className="ml-0 rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm">
                      Tough
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-left text-xs font-medium text-slate-600">
                  {row.stadium}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Map outdoor scoreboard weather into a stroke icon, or null when hidden. */
function outlookWeatherIcon(
  weather: string | null | undefined,
  indoor: boolean | undefined,
): "sunny" | "cloudy" | "rainy" | "snowy" | null {
  if (indoor) return null;
  const raw = (weather ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/snow|flurries|blizzard|sleet|ice/.test(raw)) return "snowy";
  if (/rain|shower|storm|thunder|drizzle/.test(raw)) return "rainy";
  if (/cloud|overcast|fog|haze|mist/.test(raw)) return "cloudy";
  if (/sun|clear|fair|hot|warm/.test(raw)) return "sunny";
  return null;
}

function OutlookPanel({
  playerId,
  team,
  posRankLabel,
  brainSos,
  scoringFormat,
}: {
  playerId: string;
  team: string;
  posRankLabel: string;
  brainSos: PlayerSos | null;
  scoringFormat: Scoring;
}) {
  const { data: nextGame, isLoading } = useQuery({
    queryKey: ["player-next-game", team],
    queryFn: () => getNextGame({ data: { team } }),
    staleTime: 1000 * 60 * 60 * 6,
    enabled: Boolean(team?.trim()),
  });

  const week = nextGame?.week ?? null;
  const { progressByNflTeam } = useNflGameProgress(week);
  const { projectFor } = useLeagueProjections(week);
  const sleeperPlayers = useSleeperPlayers();
  const catalog = sleeperPlayers.data?.players ?? [];
  const { myTeam } = useLeagueRosters(catalog);

  const { data: logsBundle } = useQuery({
    queryKey: ["player-outlook-logs", playerId],
    queryFn: () => getGameLogs({ data: { id: playerId } }),
    staleTime: 1000 * 60 * 30,
  });

  const currentMatchup = useMemo(() => {
    if (!brainSos?.matchups?.length) return null;
    if (week != null) {
      return brainSos.matchups.find((m) => Number(m.week) === Number(week)) ?? null;
    }
    return brainSos.matchups[0] ?? null;
  }, [brainSos, week]);

  const stars = sosStarsFromRank(currentMatchup?.rank) ?? 3;
  const opponentAbbr = (
    currentMatchup?.opp ||
    nextGame?.opponent ||
    ""
  )
    .replace(/^vs\s+|^@\s+/i, "")
    .trim()
    .toUpperCase();

  const progress = progressByNflTeam.get(team.toUpperCase());
  const liveLabel = formatNflGameStatusLabel(progress, team);
  const kickoffLabel =
    progress?.phase === "in" || progress?.phase === "post"
      ? liveLabel || formatOutlookKickoff(progress?.kickoffIso, nextGame?.date)
      : formatOutlookKickoff(progress?.kickoffIso, nextGame?.date);

  const weekLog =
    week != null ? logsBundle?.logs.find((g) => Number(g.week) === Number(week)) : null;
  const leagueProj = projectFor(playerId);
  const logProj =
    weekLog?.proj?.[scoringFormat] != null && Number.isFinite(weekLog.proj[scoringFormat]!)
      ? weekLog.proj[scoringFormat]!
      : null;
  const projection =
    leagueProj != null && Number.isFinite(leagueProj)
      ? leagueProj
      : logProj != null
        ? logProj
        : null;

  const lineupWeight = useMemo(() => {
    const starters = (myTeam?.starters ?? []).filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (!starters.length) return null;
    let total = 0;
    for (const s of starters) {
      const pts = projectFor(s.id);
      if (pts != null && Number.isFinite(pts) && pts > 0) total += pts;
    }
    if (total <= 0) return null;
    const mine =
      leagueProj != null && Number.isFinite(leagueProj)
        ? leagueProj
        : projectFor(playerId) ?? logProj;
    if (mine == null || !Number.isFinite(mine) || mine <= 0) return null;
    return (mine / total) * 100;
  }, [myTeam, projectFor, playerId, leagueProj, logProj]);

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-slate-400">Loading matchup outlook…</p>;
  }

  const oppColor = getTeamPrimaryColor(opponentAbbr || null);
  const teamColor = getTeamPrimaryColor(team);
  const oppMeta = teamById(opponentAbbr || null);
  const teamMeta = teamById(team);
  const oppCity = (oppMeta?.city ?? opponentAbbr ?? "—").toUpperCase();
  const teamCity = (teamMeta?.city ?? team ?? "—").toUpperCase();
  const oppNick = (oppMeta?.name ?? opponentAbbr ?? "FA").toUpperCase();
  const teamNick = (teamMeta?.name ?? team ?? "FA").toUpperCase();
  const weatherKind = outlookWeatherIcon(progress?.weather, progress?.indoor);
  const WeatherIcon =
    weatherKind === "sunny"
      ? Sun
      : weatherKind === "cloudy"
        ? Cloud
        : weatherKind === "rainy"
          ? CloudRain
          : weatherKind === "snowy"
            ? CloudSnow
            : null;

  return (
    <div className="w-full">
      <div className="relative mb-4 h-16 w-full select-none overflow-hidden rounded-xl bg-slate-900 shadow-sm">
        <div
          className="absolute inset-y-0 left-0 z-10 flex h-full w-full flex-col justify-center overflow-hidden pl-8"
          style={{
            backgroundColor: oppColor,
            clipPath: "polygon(0 0, 53% 0, 47% 100%, 0 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute top-1/2 left-2 z-0 -translate-y-1/2 select-none text-7xl font-black tracking-tighter text-white uppercase opacity-[0.03] mix-blend-overlay"
            aria-hidden
          >
            {oppNick}
          </div>
          {opponentAbbr && teamLogo(opponentAbbr) ? (
            <img
              src={teamLogo(opponentAbbr)!}
              alt=""
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-[52%] z-0 h-16 w-16 -translate-y-1/2 select-none object-contain opacity-[0.14] mix-blend-normal"
            />
          ) : null}
          <div className="relative z-20 flex flex-col items-start">
            <span className="mb-0.5 select-none text-[10px] font-black tracking-wider text-amber-400 uppercase drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.75)]">
              {oppCity}
            </span>
            <span className="select-none text-xl font-black tracking-wide text-white uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
              {oppNick}
            </span>
          </div>
        </div>

        <div
          className="absolute inset-y-0 right-0 z-10 flex h-full w-full flex-col items-end justify-center overflow-hidden pr-8 text-right"
          style={{
            backgroundColor: teamColor,
            clipPath: "polygon(53% 0, 100% 0, 100% 100%, 47% 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute top-1/2 right-2 z-0 -translate-y-1/2 select-none text-7xl font-black tracking-tighter text-white uppercase opacity-[0.03] mix-blend-overlay"
            aria-hidden
          >
            {teamNick}
          </div>
          {teamLogo(team) ? (
            <img
              src={teamLogo(team)!}
              alt=""
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-[52%] z-0 h-16 w-16 -translate-y-1/2 select-none object-contain opacity-[0.14] mix-blend-normal"
            />
          ) : null}
          <div className="relative z-20 flex flex-col items-end">
            <span className="mb-0.5 select-none text-[10px] font-black tracking-wider text-white/70 uppercase drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.6)]">
              {teamCity}
            </span>
            <span className="select-none text-xl font-black tracking-wide text-white uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
              {teamNick}
            </span>
          </div>
        </div>
      </div>

      <div className="mb-5 flex w-full items-center justify-center border-b border-slate-100 py-2.5 text-center">
        <span className="text-xs font-black uppercase tracking-wide text-slate-800">
          {kickoffLabel}
        </span>
        {WeatherIcon ? (
          <WeatherIcon
            className="ml-2 size-3.5 text-slate-500"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : null}
      </div>

      <div className="grid w-full grid-cols-4 divide-x divide-slate-100 rounded-xl border border-slate-200/60 bg-white p-5 text-center shadow-sm">
        <div className="px-2">
          <p className="text-xl font-black text-slate-900">{posRankLabel}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Pos Rank
          </p>
        </div>
        <div className="px-2">
          <p className="text-xl font-black text-slate-900">
            {projection != null ? projection.toFixed(1) : "—"}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Projection
          </p>
        </div>
        <div className="px-2">
          <div
            className="flex items-center justify-center gap-0.5"
            aria-label={`${stars} of 5 stars`}
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={cn(
                  "size-3.5",
                  i < stars ? "fill-amber-500 text-amber-500 text-sm" : "text-slate-200",
                )}
                strokeWidth={i < stars ? 0 : 1.5}
              />
            ))}
          </div>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Matchup
          </p>
        </div>
        <div className="px-2">
          <p className="text-xl font-black text-slate-900">
            {lineupWeight != null ? `${lineupWeight.toFixed(1)}%` : "—"}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Lineup Weight
          </p>
        </div>
      </div>
    </div>
  );
}

function DepthChartAvatar({
  id,
  pos,
  team,
  name,
}: {
  id: string;
  pos: string;
  team: string;
  name: string;
}) {
  const logo = teamLogo(team);
  const isDefense = pos.toUpperCase() === "DEF";
  const [useLogo, setUseLogo] = useState(isDefense || !id);

  if (useLogo || !id) {
    return (
      <img
        src={logo ?? ""}
        alt=""
        aria-hidden
        className="relative z-20 h-8 w-8 flex-shrink-0 rounded-full border border-slate-100 bg-slate-50 object-contain shadow-sm"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }

  return (
    <img
      src={playerImage(id, pos as Pos, team)}
      alt={name}
      loading="lazy"
      className="relative z-20 h-8 w-8 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover shadow-sm"
      onError={() => setUseLogo(true)}
    />
  );
}

function DepthChartPanel({
  playerId,
  team,
  depthChart,
  onSelectPlayer,
}: {
  playerId: string;
  team: string;
  depthChart: {
    id: string;
    name: string;
    pos: string;
    injury: string | null;
    proj: number;
  }[];
  onSelectPlayer?: (id: string) => void;
}) {
  const activeName = depthChart.find((d) => d.id === playerId)?.name ?? null;

  const byPos = useMemo(() => {
    const group = (slot: string) =>
      depthChart
        .filter((d) => d.pos === slot)
        .slice()
        .sort((a, b) => b.proj - a.proj);
    return {
      QB: group("QB"),
      RB: group("RB"),
      K: group("K"),
      WR: group("WR"),
      TE: group("TE"),
      DEF: group("DEF"),
    };
  }, [depthChart]);

  const leftBlocks: { title: string; rows: typeof depthChart }[] = [
    { title: "QUARTERBACKS", rows: byPos.QB },
    { title: "RUNNING BACKS", rows: byPos.RB },
    { title: "KICKERS", rows: byPos.K },
  ];
  const rightBlocks: { title: string; rows: typeof depthChart }[] = [
    { title: "WIDE RECEIVERS", rows: byPos.WR },
    { title: "TIGHT ENDS", rows: byPos.TE },
    { title: "TEAM DEFENSES", rows: byPos.DEF },
  ];

  if (depthChart.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No {team} depth chart available.
      </p>
    );
  }

  const renderCard = (
    d: (typeof depthChart)[number],
    index: number,
  ) => {
    const badge = injuryLetter(d.injury);
    const isActive =
      d.id === playerId ||
      (activeName != null &&
        d.name.trim().toLowerCase() === activeName.trim().toLowerCase());

    const inner = (
      <>
        <div
          className="absolute top-0 bottom-0 left-0 w-1 rounded-l-xl"
          style={{ backgroundColor: getTeamPrimaryColor(team) }}
          aria-hidden
        />
        <div className="flex min-w-0 items-center space-x-2.5">
          <span className="flex h-[18px] w-[18px] flex-shrink-0 select-none items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">
            {index + 1}
          </span>
          <DepthChartAvatar id={d.id} pos={d.pos} team={team} name={d.name} />
          <PositionBadge pos={d.pos} className="h-5 text-[10px]" />
          <span
            className={cn(
              "max-w-[120px] truncate text-xs font-black",
              isActive ? "text-blue-600" : "text-slate-900",
            )}
          >
            {d.name}
          </span>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center space-x-2">
          {badge ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white",
                badge === "Q" ? "bg-amber-500" : "bg-red-500",
              )}
            >
              {badge}
            </span>
          ) : null}
          <div className="text-xs font-black tracking-wide text-slate-900 uppercase">
            {Number.isFinite(d.proj) ? d.proj.toFixed(1) : "0.0"}
            <span className="ml-0.5 text-[10px] font-bold normal-case text-slate-400">
              proj
            </span>
          </div>
        </div>
      </>
    );

    const klass = cn(
      "relative mb-2 flex w-full items-center justify-between overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 pl-5 text-left shadow-sm transition-colors hover:bg-slate-100/60",
      isActive && "border-blue-100 bg-blue-50/50 hover:bg-blue-50/70",
    );

    return onSelectPlayer ? (
      <button
        key={d.id}
        type="button"
        className={klass}
        onClick={() => onSelectPlayer(d.id)}
      >
        {inner}
      </button>
    ) : (
      <Link key={d.id} to="/player/$id" params={{ id: d.id }} className={klass}>
        {inner}
      </Link>
    );
  };

  const renderColumn = (blocks: { title: string; rows: typeof depthChart }[]) => (
    <div className="flex w-full flex-col gap-5">
      {blocks.map((block) =>
        block.rows.length === 0 ? null : (
          <section key={block.title} className="w-full">
            <span className="mb-2 block text-left text-[10px] font-black tracking-widest text-slate-400 uppercase">
              {block.title}
            </span>
            <div className="flex flex-col">
              {block.rows.map((d, index) => renderCard(d, index))}
            </div>
          </section>
        ),
      )}
    </div>
  );

  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 overflow-visible bg-white px-6 py-4 md:grid-cols-2">
      {renderColumn(leftBlocks)}
      {renderColumn(rightBlocks)}
    </div>
  );
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Collapse article body text to a single clean summary sentence. */
function oneSentenceSummary(raw: string | null | undefined, fallback: string): string {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = (match?.[1] ?? text).trim();
  if (sentence.length <= 220) return sentence;
  const clipped = sentence.slice(0, 217).replace(/\s+\S*$/, "").trim();
  return `${clipped}…`;
}

function EditorialNewsPanel({
  id,
  injuryDetails,
  injuryStatus,
  injuryBodyPart,
  injuryNotes,
}: {
  id: string;
  injuryDetails: ReturnType<typeof getFullInjuryBadgeDetails>;
  injuryStatus?: string | null;
  injuryBodyPart?: string;
  injuryNotes?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["player-news", id],
    queryFn: () => getPlayerNews({ data: { id } }),
    staleTime: 1000 * 60 * 10,
  });

  const statusUpper = (injuryStatus ?? "").toUpperCase().trim();
  const isCritical =
    statusUpper === "O" ||
    statusUpper === "OUT" ||
    statusUpper === "IR" ||
    statusUpper === "INJURED RESERVE" ||
    statusUpper === "INJURED_RESERVE" ||
    statusUpper === "D" ||
    statusUpper === "DOUBTFUL" ||
    injuryDetails?.tone === "rose";
  const accentText = isCritical ? "text-rose-600" : "text-amber-600";
  const accentBorder = isCritical ? "border-l-rose-600" : "border-l-amber-500";

  const medicalIntel = injuryDetails ? (
    <div
      className={cn(
        "relative mb-5 flex w-full select-none flex-col items-start overflow-hidden rounded-xl border border-slate-200/80 border-l-4 bg-slate-50/40 p-5 text-left shadow-sm",
        accentBorder,
      )}
    >
      <div className="mb-2 flex items-center space-x-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
        <span className={accentText}>Medical Report</span>
      </div>
      <div className="text-left text-sm font-black tracking-wide text-slate-900">
        Designation: <span className={accentText}>{injuryDetails.text}</span>
        <span className="mx-3 text-slate-200">|</span>
        Diagnosis:{" "}
        <span className="capitalize font-black text-slate-800">
          {injuryBodyPart?.trim() || "Evaluation Pending"}
        </span>
      </div>
      <p className="mt-2.5 block w-full text-left text-xs font-medium leading-relaxed text-slate-500">
        {injuryNotes?.trim() || MEDICAL_NOTES_FALLBACK}
      </p>
    </div>
  ) : null;

  if (isLoading) {
    return (
      <div className="w-full">
        {medicalIntel}
        <p className="py-8 text-center text-sm text-slate-400">Loading latest news…</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="w-full">
        {medicalIntel}
        <p className="py-8 text-center text-sm text-slate-400">News feed unavailable right now.</p>
      </div>
    );
  }
  const items = data?.items ?? [];
  if (!items.length) {
    return (
      <div className="w-full">
        {medicalIntel}
        <p className="py-8 text-center text-sm text-slate-400">No recent articles for this player.</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {medicalIntel}
      {items.map((n) => {
        const ago = timeAgo(n.published);
        const summary = oneSentenceSummary(
          n.description,
          "Latest reporting on this player with implications for fantasy lineups.",
        );
        const impact = n.aboutPlayer
          ? "Monitor role, usage, and practice reports before setting your lineup."
          : "Track how this report could ripple into nearby depth-chart opportunities.";

        const headlineClass =
          "mt-1 mb-0.5 block cursor-pointer text-xl font-black tracking-tight text-slate-900 transition-colors hover:text-blue-600";

        return (
          <article
            key={n.id}
            className="mb-4 flex w-full flex-col items-start overflow-hidden rounded-xl border border-slate-100 bg-white p-5 text-left shadow-sm"
          >
            {n.link ? (
              <a
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className={headlineClass}
              >
                {n.headline}
              </a>
            ) : (
              <h3 className={headlineClass}>{n.headline}</h3>
            )}
            <span className="mb-4 block text-[11px] font-medium text-slate-400">
              By ESPN{ago ? ` · ${ago}` : ""}
            </span>
            <p className="mb-4 block w-full border-l-2 border-slate-200/80 pl-3.5 text-left text-sm leading-relaxed font-medium text-slate-500 italic">
              {summary}
            </p>
            <div className="w-full rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-left shadow-sm">
              <span className="mb-1.5 block text-[10px] font-black tracking-wider text-slate-900 uppercase">
                FANTASY IMPACT
              </span>
              <p className="text-left text-xs leading-relaxed font-medium text-slate-600">
                {impact}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* End tab panels                                                      */
/* ------------------------------------------------------------------ */


/**
 * Shared Playbook / native Matchup lineup cards.
 * Three-row player cards + solid POS color badges (RB/WR without slot numbers).
 */
import { useQuery } from "@tanstack/react-query";
import { Lock, User } from "lucide-react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { SosStars } from "@/components/sos/SosStars";
import { detailQuery } from "@/lib/player-detail-query";
import { playerHoverPrefetchProps } from "@/lib/prefetch-player-detail";
import type { Player } from "@/lib/players-build";
import type { NflGameProgress } from "@/lib/rolling-live-projection";
import { resolveInjuryStatus, injuryMicroBadge } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";

/** Strip RB1/WR2 → RB/WR so color tones resolve. */
export function normalizeSlotKey(slot: string): string {
  const raw = String(slot ?? "").trim().toUpperCase();
  if (!raw) return "BN";
  if (raw === "FLEX" || raw === "FLX" || raw === "WRRB" || raw === "WRTE") return "FLX";
  if (raw === "SFLEX" || raw === "SF") return "SF";
  if (raw === "BENCH" || raw === "BN") return "BN";
  if (raw === "DEF" || raw === "DST" || raw === "D/ST") return "DEF";
  // Drop trailing slot index (RB1 → RB).
  const stripped = raw.replace(/\d+$/, "");
  return stripped || raw;
}

export function badgeLabel(slot: string): string {
  return normalizeSlotKey(slot);
}

/** Solid position fills with white labels — Playbook Matchup parity. */
export const SLOT_PILL_TONE: Record<string, string> = {
  QB: "border-qb bg-qb text-white",
  RB: "border-rb bg-rb text-white",
  WR: "border-wr bg-wr text-white",
  TE: "border-te bg-te text-white",
  K: "border-k bg-k text-white",
  DEF: "border-def bg-def text-white",
  SF: "border-qb bg-qb text-white",
  BN: "border-slate-300 bg-slate-100 text-slate-600",
  IR: "border-slate-300 bg-slate-100 text-slate-600",
  TAXI: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Standalone center badge — overlaps the seam between left/right cards. */
export function MatchupSlotBadge({
  slot,
  className,
}: {
  slot: string;
  className?: string;
}) {
  const display = badgeLabel(slot);
  const isFlx = display === "FLX";
  const pillBase =
    "mx-auto z-20 flex h-9 w-11 items-center justify-center rounded-md border text-xs font-bold uppercase shadow-md ring-2 ring-white";

  if (isFlx) {
    return (
      <span
        className={cn(
          pillBase,
          "relative isolate overflow-hidden border-slate-300 text-white",
          className,
        )}
      >
        <span className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
          <span className="h-full w-1/3 bg-rb" />
          <span className="h-full w-1/3 bg-wr" />
          <span className="h-full w-1/3 bg-te" />
        </span>
        <span className="relative z-10">FLX</span>
      </span>
    );
  }

  return (
    <span className={cn(pillBase, SLOT_PILL_TONE[display] ?? SLOT_PILL_TONE["BN"], className)}>
      {display === "DEF" ? "DST" : display}
    </span>
  );
}

/** Compact lock chip — game started / final; lineup slot is frozen. */
function LineupLockBadge() {
  return (
    <span
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400"
      title="Lineup locked"
      aria-label="Lineup locked — this player's game has started"
    >
      <Lock className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

function posRankLabel(player: Player, sleeperPosRank?: number | null): string | null {
  const rank =
    sleeperPosRank != null && Number.isFinite(sleeperPosRank) && sleeperPosRank > 0
      ? sleeperPosRank
      : Number(player.posRank);
  if (!Number.isFinite(rank) || rank <= 0 || rank >= 999) return null;
  const pos = player.pos === "DEF" ? "DST" : player.pos;
  return `${pos}${Math.round(rank)}`;
}

/** Reorder "AWAY 10 - HOME 13" so the winning side is listed first. */
function formatWinnerFirstBoxScore(label: string): string {
  const raw = label.trim();
  if (!raw) return "";
  const m = raw.match(/^([A-Za-z]{2,4})\s+(\d+)\s*-\s*([A-Za-z]{2,4})\s+(\d+)$/);
  if (!m) return raw;
  const aTeam = m[1]!.toUpperCase();
  const aScore = Number(m[2]);
  const bTeam = m[3]!.toUpperCase();
  const bScore = Number(m[4]);
  if (!Number.isFinite(aScore) || !Number.isFinite(bScore)) return raw;
  if (aScore >= bScore) return `${aTeam} ${aScore} - ${bTeam} ${bScore}`;
  return `${bTeam} ${bScore} - ${aTeam} ${aScore}`;
}

/**
 * Left:  ★★★★★ vs. TEAM  |  POS_RANK
 * Right: POS_RANK  |  ★★★★★ vs. TEAM
 */
function SosStarRankLine({
  stars,
  opponent,
  posRank,
  align,
}: {
  stars: number | null;
  opponent: string | null;
  posRank: string | null;
  align: "left" | "right";
}) {
  const opp = (opponent ?? "").trim().toUpperCase();
  const starsEl = <SosStars stars={stars} />;
  const vsEl = opp ? (
    <span className="shrink-0 font-medium uppercase tracking-wide text-slate-500">{`vs. ${opp}`}</span>
  ) : null;
  const rankEl = posRank ? (
    <span className="shrink-0 font-semibold tabular-nums text-slate-500">{posRank}</span>
  ) : null;
  const divider = (
    <span className="mx-1 shrink-0 select-none text-slate-300" aria-hidden="true">
      |
    </span>
  );
  const starsAndVs = (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {starsEl}
      {vsEl}
    </span>
  );

  if (align === "right") {
    return (
      <div className="mt-1 flex max-w-full items-center justify-end truncate text-xs leading-none">
        {rankEl}
        {rankEl && (stars != null || opp) ? divider : null}
        {starsAndVs}
      </div>
    );
  }

  return (
    <div className="mt-1 flex max-w-full items-center truncate text-xs leading-none">
      {starsAndVs}
      {(stars != null || opp) && rankEl ? divider : null}
      {rankEl}
    </div>
  );
}

function MatchupInjuryBadge({
  player,
  onOpen,
}: {
  player: Player;
  onOpen: () => void;
}) {
  const catalogStatus = resolveInjuryStatus(player);
  const { data } = useQuery({
    ...detailQuery(player.id),
    enabled: Boolean(player.id),
  });
  const detailInjury = data?.player?.injury;
  const status =
    detailInjury &&
    detailInjury !== "Healthy" &&
    detailInjury !== "Active" &&
    detailInjury !== "None"
      ? detailInjury
      : catalogStatus;
  const badge = injuryMicroBadge(status);
  if (!badge) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${player.name} injury status ${badge.label}`}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white transition-all hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        badge.className,
      )}
    >
      {badge.label}
    </button>
  );
}

function MatchupPlayerThumb({
  player,
  onOpen,
  className,
}: {
  player: Player;
  onOpen: () => void;
  className?: string;
}) {
  const logo = teamLogo(player.team);
  return (
    <button
      type="button"
      onClick={onOpen}
      {...playerHoverPrefetchProps(player.id)}
      aria-label={`Open ${player.name} details`}
      className={cn(
        "relative h-14 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-slate-200 bg-white shadow-sm transition-all hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      <img
        src={playerImage(player.id, player.pos, player.team)}
        alt=""
        loading="lazy"
        className="h-full w-full rounded-full object-cover"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      {logo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          className="absolute -bottom-0.5 -right-0.5 z-30 h-5 w-5 rounded-full border-2 border-white bg-white object-contain shadow-sm"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </button>
  );
}

function MatchupScoreColumn({
  liveLabel,
  livePts,
  projPts,
  phase = "pre",
  showCheck,
  checkSide,
}: {
  liveLabel: string;
  livePts: number | null;
  projPts: number | null;
  phase?: NflGameProgress["phase"];
  showCheck: boolean;
  checkSide: "left" | "right";
}) {
  const check = showCheck ? (
    <span className="font-bold text-emerald-600" aria-hidden="true">
      ✓
    </span>
  ) : null;

  let projClass = "text-slate-400";
  if (phase === "post" && projPts != null && livePts != null) {
    const live = Number(livePts) || 0;
    const proj = Number(projPts) || 0;
    if (Math.abs(live) < 0.005 && Math.abs(proj) < 0.005) {
      projClass = "text-slate-400";
    } else if (live > proj + 0.005) {
      projClass = "text-emerald-600";
    } else if (live < proj - 0.005) {
      projClass = "text-rose-600";
    }
  }

  return (
    <div className="flex w-14 flex-shrink-0 flex-col items-center justify-center">
      <p className="text-center text-base font-bold tabular-nums leading-none text-slate-900">
        {liveLabel}
      </p>
      <p
        className={cn(
          "mt-1.5 flex items-center justify-center gap-0.5 text-xs font-medium tabular-nums leading-none",
          projClass,
        )}
      >
        {checkSide === "left" ? check : null}
        <span>{projPts != null ? projPts.toFixed(2) : ""}</span>
        {checkSide === "right" ? check : null}
      </p>
    </div>
  );
}

export type MatchupSideCardProps = {
  player: Player | null;
  livePts: number | null;
  projPts: number | null;
  phase?: NflGameProgress["phase"];
  scheduleLabel?: string;
  boxScoreLabel?: string;
  sosStars?: number | null;
  sosOpponent?: string | null;
  posRank?: number | null;
  bye?: boolean;
  showCheck?: boolean;
  onOpenPlayer?: (id: string) => void;
};

export function liveScoreLabel(
  phase: NflGameProgress["phase"] | undefined,
  livePts: number | null,
  opts?: { bye?: boolean },
): string {
  // Yet to play → "-". Bye → "-" on the muted final sheet.
  if (opts?.bye) return "-";
  if (phase !== "pre" || (livePts != null && livePts > 0)) {
    return livePts != null ? livePts.toFixed(2) : "0.00";
  }
  return "-";
}

function EmptySlotThumb() {
  return (
    <div
      className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-200 bg-slate-50"
      aria-hidden="true"
    >
      <User className="h-6 w-6 text-slate-300" strokeWidth={1.75} />
    </div>
  );
}

/**
 * LEFT card: avatar | left text stack | scores
 * Pre-game white sheet; completed games use muted final sheet (Playbook parity).
 */
export function LeftPlayerCard({
  player,
  livePts,
  projPts,
  phase = "pre",
  scheduleLabel = "",
  boxScoreLabel = "",
  sosStars = null,
  sosOpponent = null,
  posRank = null,
  bye = false,
  showCheck = false,
  onOpenPlayer,
}: MatchupSideCardProps) {
  const isFinal = phase === "post";
  // Bye is muted like a final sheet but must not show a lineup lock — managers can still swap.
  const isLocked = !bye && (phase === "post" || phase === "in");
  // Playbook Matchup sheets: white = yet to play / live; muted grey = completed (or bye).
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
      : showCheck
        ? "border-emerald-300/80 bg-gradient-to-r from-emerald-50 via-white to-white"
        : "border-slate-200 bg-white",
  );

  if (!player) {
    return (
      <div className="flex h-full min-h-[5.5rem] w-full items-center justify-between rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5">
        <EmptySlotThumb />
        <div className="flex min-w-0 flex-1 flex-col items-start justify-center pl-3.5 text-left">
          <p className="text-[15px] font-medium leading-none text-slate-400">Empty</p>
          <p className="mt-1 text-xs font-medium leading-none text-slate-300">No player</p>
        </div>
        <div className="w-14 flex-shrink-0" aria-hidden="true" />
      </div>
    );
  }

  const open = () => onOpenPlayer?.(player.id);
  const teamAbbr = (player.team || "FA").toUpperCase();
  const line2 = bye ? "BYE" : isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal && !bye ? formatWinnerFirstBoxScore(boxScoreLabel) : "";

  return (
    <div className={shell} {...playerHoverPrefetchProps(player.id)}>
      <MatchupPlayerThumb player={player} onOpen={open} />
      <div className="flex min-w-0 flex-1 flex-col items-start justify-center pl-3.5 text-left">
        <p className="flex max-w-full items-center gap-1.5 truncate text-left text-[15px] leading-snug">
          <button
            type="button"
            onClick={open}
            className="max-w-full cursor-pointer truncate font-bold text-slate-900 transition-all hover:text-blue-600 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {player.name}
          </button>
          <MatchupInjuryBadge player={player} onOpen={open} />
          <span className="shrink-0 text-sm font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-1 flex max-w-full items-center gap-1.5 truncate text-xs font-medium leading-none text-slate-500">
          <span className="truncate">{line2}</span>
          {isLocked && phase === "in" ? <LineupLockBadge /> : null}
        </p>
        {isFinal ? (
          line3Final ? (
            <p className="mt-1 flex max-w-full items-center gap-1.5 truncate text-xs font-medium tabular-nums leading-none text-slate-500">
              <span className="truncate">{line3Final}</span>
              {isLocked ? <LineupLockBadge /> : null}
            </p>
          ) : isLocked ? (
            <span className="mt-1">
              <LineupLockBadge />
            </span>
          ) : null
        ) : (
          <SosStarRankLine
            stars={sosStars}
            opponent={sosOpponent}
            posRank={posRankLabel(player, posRank)}
            align="left"
          />
        )}
      </div>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts, { bye })}
        livePts={livePts}
        projPts={bye ? null : projPts}
        phase={phase}
        showCheck={showCheck}
        checkSide="left"
      />
    </div>
  );
}

/** RIGHT card: scores | right text stack | avatar */
export function RightPlayerCard({
  player,
  livePts,
  projPts,
  phase = "pre",
  scheduleLabel = "",
  boxScoreLabel = "",
  sosStars = null,
  sosOpponent = null,
  posRank = null,
  bye = false,
  showCheck = false,
  onOpenPlayer,
}: MatchupSideCardProps) {
  const isFinal = phase === "post";
  // Bye is muted like a final sheet but must not show a lineup lock — managers can still swap.
  const isLocked = !bye && (phase === "post" || phase === "in");
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
      : showCheck
        ? "border-emerald-300/80 bg-gradient-to-l from-emerald-50 via-white to-white"
        : "border-slate-200 bg-white",
  );

  if (!player) {
    return (
      <div className="flex h-full min-h-[5.5rem] w-full items-center justify-between rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5">
        <div className="w-14 flex-shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col items-end justify-center pr-3.5 text-right">
          <p className="text-[15px] font-medium leading-none text-slate-400">Empty</p>
          <p className="mt-1 text-xs font-medium leading-none text-slate-300">No player</p>
        </div>
        <EmptySlotThumb />
      </div>
    );
  }

  const open = () => onOpenPlayer?.(player.id);
  const teamAbbr = (player.team || "FA").toUpperCase();
  const line2 = bye ? "BYE" : isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal && !bye ? formatWinnerFirstBoxScore(boxScoreLabel) : "";

  return (
    <div className={shell} {...playerHoverPrefetchProps(player.id)}>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts, { bye })}
        livePts={livePts}
        projPts={bye ? null : projPts}
        phase={phase}
        showCheck={showCheck}
        checkSide="right"
      />
      <div className="flex min-w-0 flex-1 flex-col items-end justify-center pr-3.5 text-right">
        <p className="flex max-w-full items-center justify-end gap-1.5 truncate text-right text-[15px] leading-snug">
          <button
            type="button"
            onClick={open}
            className="max-w-full cursor-pointer truncate font-bold text-slate-900 transition-all hover:text-blue-600 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {player.name}
          </button>
          <MatchupInjuryBadge player={player} onOpen={open} />
          <span className="shrink-0 text-sm font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-1 flex max-w-full items-center justify-end gap-1.5 truncate text-xs font-medium leading-none text-slate-500">
          {isLocked && phase === "in" ? <LineupLockBadge /> : null}
          <span className="truncate">{line2}</span>
        </p>
        {isFinal ? (
          line3Final ? (
            <p className="mt-1 flex max-w-full items-center justify-end gap-1.5 truncate text-xs font-medium tabular-nums leading-none text-slate-500">
              {isLocked ? <LineupLockBadge /> : null}
              <span className="truncate">{line3Final}</span>
            </p>
          ) : isLocked ? (
            <span className="mt-1">
              <LineupLockBadge />
            </span>
          ) : null
        ) : (
          <SosStarRankLine
            stars={sosStars}
            opponent={sosOpponent}
            posRank={posRankLabel(player, posRank)}
            align="right"
          />
        )}
      </div>
      <MatchupPlayerThumb player={player} onOpen={open} className="ml-3.5" />
    </div>
  );
}

/**
 * ONE parent grid row per slot. Left card and right card sit almost flush;
 * the position badge overlaps the center seam.
 */
export function MatchupGridRow({
  slot,
  left,
  right,
  leftLive,
  rightLive,
  leftProj,
  rightProj,
  leftPhase = "pre",
  rightPhase = "pre",
  leftSchedule = "",
  rightSchedule = "",
  leftBoxScore = "",
  rightBoxScore = "",
  leftSosStars = null,
  rightSosStars = null,
  leftSosOpponent = null,
  rightSosOpponent = null,
  leftPosRank = null,
  rightPosRank = null,
  leftBye = false,
  rightBye = false,
  showFavoriteCheck = false,
  onOpenPlayer,
}: {
  slot: string;
  left: Player | null;
  right: Player | null;
  leftLive: number | null;
  rightLive: number | null;
  leftProj: number | null;
  rightProj: number | null;
  leftPhase?: NflGameProgress["phase"];
  rightPhase?: NflGameProgress["phase"];
  leftSchedule?: string;
  rightSchedule?: string;
  leftBoxScore?: string;
  rightBoxScore?: string;
  leftSosStars?: number | null;
  rightSosStars?: number | null;
  leftSosOpponent?: string | null;
  rightSosOpponent?: string | null;
  leftPosRank?: number | null;
  rightPosRank?: number | null;
  leftBye?: boolean;
  rightBye?: boolean;
  showFavoriteCheck?: boolean;
  onOpenPlayer?: (id: string) => void;
}) {
  const leftWins =
    showFavoriteCheck &&
    leftPhase === "pre" &&
    leftProj != null &&
    rightProj != null &&
    leftProj > rightProj;
  const rightWins =
    showFavoriteCheck &&
    rightPhase === "pre" &&
    leftProj != null &&
    rightProj != null &&
    rightProj > leftProj;

  return (
    <div className="relative my-3 grid h-[96px] w-full grid-cols-2 items-center gap-1.5">
      <div className="min-w-0">
        <LeftPlayerCard
          player={left}
          livePts={leftLive}
          projPts={leftProj}
          phase={leftPhase}
          scheduleLabel={leftSchedule}
          boxScoreLabel={leftBoxScore}
          sosStars={leftSosStars}
          sosOpponent={leftSosOpponent}
          posRank={leftPosRank}
          bye={leftBye}
          showCheck={Boolean(leftWins)}
          {...(onOpenPlayer ? { onOpenPlayer } : {})}
        />
      </div>
      <div className="min-w-0">
        <RightPlayerCard
          player={right}
          livePts={rightLive}
          projPts={rightProj}
          phase={rightPhase}
          scheduleLabel={rightSchedule}
          boxScoreLabel={rightBoxScore}
          sosStars={rightSosStars}
          sosOpponent={rightSosOpponent}
          posRank={rightPosRank}
          bye={rightBye}
          showCheck={Boolean(rightWins)}
          {...(onOpenPlayer ? { onOpenPlayer } : {})}
        />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <MatchupSlotBadge slot={slot} />
      </div>
    </div>
  );
}

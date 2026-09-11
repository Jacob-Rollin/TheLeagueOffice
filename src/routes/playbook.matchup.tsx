import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { detailQuery } from "@/components/draft/PlayerDetail";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { playbookCardClass, resolveAvatarUrl } from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { starterRequirements } from "@/lib/power-rankings";
import {
  computeTeamDisplayProjection,
  formatNflGameStatusLabel,
  formatNflKickoffLabel,
  playerLiveRollingProjection,
  winPctFromDisplayProjections,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import { sosStarsFromRank, weeklySosMatchupFor, type SosMatchup } from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";
import { currentSeason, fetchSchedule, type PlayersPayload, type ScheduleGame } from "@/lib/players-build";
import { getCached, readCache } from "@/lib/sleeper-cache";

/** Sleeper ↔ ESPN abbreviation aliases for scoreboard lookups. */
const TEAM_PROGRESS_ALIASES: Record<string, string[]> = {
  WAS: ["WAS", "WSH"],
  WSH: ["WSH", "WAS"],
  LAR: ["LAR", "LA"],
  LA: ["LA", "LAR"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAX", "JAC"],
};

export const Route = createFileRoute("/playbook/matchup")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Matchup — Playbook" }],
  }),
  component: PlaybookMatchupPage,
});

const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);
const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);

type LineMode = "current" | "optimal";

type SlotRow = {
  slot: string;
  mine: Player | null;
  opp: Player | null;
};

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function normalizeSlot(pos: string): string {
  const value = pos.trim().toUpperCase();
  if (value === "SUPER_FLEX" || value === "SUPERFLEX" || value === "Q/W/R/T") return "FLEX";
  if (value === "W/R/T" || value === "WRRBTE") return "FLEX";
  return value;
}

function starterSlotLabels(rosterPositions: string[]): string[] {
  const labels = rosterPositions
    .map((pos) => normalizeSlot(String(pos ?? "")))
    .filter((pos) => pos && !SKIP_STARTER_SLOTS.has(pos));
  if (labels.length) return labels;
  const req = starterRequirements([]);
  const out: string[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]) {
    for (let i = 0; i < (req[pos] ?? 0); i += 1) out.push(pos);
  }
  return out;
}

function badgeLabel(slot: string): string {
  if (slot === "FLEX") return "FLX";
  if (slot === "BENCH" || slot === "BN") return "BN";
  if (slot === "DEF" || slot === "DST") return "DEF";
  return slot;
}

/** Muted position tokens — same as PositionBadge / player popup. */
const SLOT_PILL_TONE: Record<string, string> = {
  QB: "bg-qb/15 text-qb border-qb/40",
  RB: "bg-rb/15 text-rb border-rb/40",
  WR: "bg-wr/15 text-wr border-wr/40",
  TE: "bg-te/15 text-te border-te/40",
  K: "bg-k/15 text-k border-k/40",
  DEF: "bg-def/15 text-def border-def/40",
  BN: "bg-muted text-muted-foreground border-border",
  IR: "bg-muted text-muted-foreground border-border",
};

/** Standalone center badge — floats in the 64px spacer, never overlaps cards. */
function MatchupSlotBadge({ slot }: { slot: string }) {
  const label = badgeLabel(slot);
  const display = slot === "IR" ? "IR" : label;
  const isFlx = display === "FLX" || slot === "FLEX" || slot === "FLX";
  const pillBase =
    "mx-auto z-10 flex h-8 w-10 items-center justify-center rounded-md border text-[11px] font-bold uppercase shadow-sm";

  if (isFlx) {
    return (
      <span
        className={cn(
          pillBase,
          "border-border bg-gradient-to-r from-rb/35 via-wr/35 to-te/35 text-slate-800",
        )}
      >
        FLX
      </span>
    );
  }

  return (
    <span className={cn(pillBase, SLOT_PILL_TONE[display] ?? SLOT_PILL_TONE["BN"])}>
      {display}
    </span>
  );
}

function LineModeToggle({
  mode,
  onChange,
  align = "left",
}: {
  mode: LineMode;
  onChange: (next: LineMode) => void;
  align?: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-border bg-slate-50 p-0.5",
        align === "right" && "ml-auto",
      )}
    >
      <button
        type="button"
        onClick={() => onChange("current")}
        className={cn(
          "rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors",
          mode === "current" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-primary",
        )}
      >
        Current
      </button>
      <button
        type="button"
        onClick={() => onChange("optimal")}
        className={cn(
          "rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors",
          mode === "optimal" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-primary",
        )}
      >
        Optimal
      </button>
    </div>
  );
}

function WeekSelector({
  week,
  maxWeek = 18,
  onChange,
}: {
  week: number;
  maxWeek?: number;
  onChange: (week: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-1 py-0.5 shadow-sm">
      <button
        type="button"
        aria-label="Previous week"
        disabled={week <= 1}
        onClick={() => onChange(Math.max(1, week - 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-primary transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        {"<"}
      </button>
      <span className="min-w-[4.5rem] text-center text-xs font-bold tabular-nums text-slate-700">
        Week {week}
      </span>
      <button
        type="button"
        aria-label="Next week"
        disabled={week >= maxWeek}
        onClick={() => onChange(Math.min(maxWeek, week + 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-primary transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        {">"}
      </button>
    </div>
  );
}

function TeamLogoAvatar({
  name,
  logo,
  platform,
  cacheKey,
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
  cacheKey?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  const plat = (platform ?? "").trim().toLowerCase();
  const remountKey = `${cacheKey ?? "matchup"}:${src ?? "none"}:${plat}`;

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat]);

  if (src && !failed) {
    return (
      <span
        key={remountKey}
        className="flex h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-50"
      >
        <img
          key={remountKey}
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (plat === "espn") {
    return (
      <span
        key={remountKey}
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-white p-1"
      >
        <img src="/espn.png" alt="ESPN" className="h-7 w-7 object-contain" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      key={remountKey}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-xs font-bold text-slate-600"
    >
      {teamInitials(name)}
    </span>
  );
}

function buildCurrentStarterRows(
  team: ResolvedRosterTeam | null,
  labels: string[],
  starterIds: string[],
  playersById: Map<string, Player>,
): (Player | null)[] {
  if (!team) return labels.map(() => null);
  if (starterIds.length) {
    return labels.map((_, i) => {
      const id = starterIds[i];
      if (!id) return team.starters[i] ?? null;
      return playersById.get(id) ?? team.starters[i] ?? null;
    });
  }
  if (team.starters.length) {
    return labels.map((_, i) => team.starters[i] ?? null);
  }
  return buildOptimalStarterRows(team, labels, (id) => null);
}

function buildOptimalStarterRows(
  team: ResolvedRosterTeam | null,
  labels: string[],
  projectFor: (id: string) => number | null,
): (Player | null)[] {
  if (!team) return labels.map(() => null);
  const irIds = new Set((team.ir ?? []).map((p) => p.id));
  const pool = team.players
    .filter((p) => !irIds.has(p.id))
    .map((p) => ({
      player: p,
      weekly: projectFor(p.id) ?? weeklyFallback(p),
    }))
    .sort((a, b) => b.weekly - a.weekly);

  const used = new Set<string>();
  return labels.map((slot) => {
    const match = pool.find((entry) => {
      if (used.has(entry.player.id)) return false;
      if (slot === "FLEX") return FLEX_OK.has(entry.player.pos);
      return entry.player.pos === slot;
    });
    if (match) used.add(match.player.id);
    return match?.player ?? null;
  });
}

function padPairRows(
  mine: (Player | null)[],
  opp: (Player | null)[],
  slot: string,
): SlotRow[] {
  const len = Math.max(mine.length, opp.length);
  const rows: SlotRow[] = [];
  for (let i = 0; i < len; i += 1) {
    rows.push({
      slot,
      mine: mine[i] ?? null,
      opp: opp[i] ?? null,
    });
  }
  return rows;
}

function posRankLabel(player: Player): string | null {
  const rank = Number(player.posRank);
  if (!Number.isFinite(rank) || rank <= 0 || rank >= 999) return null;
  return `${player.pos}${Math.round(rank)}`;
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

function SosStars({ stars }: { stars: number | null }) {
  const filled =
    stars != null && Number.isFinite(stars)
      ? Math.max(0, Math.min(5, Math.round(stars)))
      : 0;
  return (
    <span className="inline-flex shrink-0 items-center" aria-label={`${filled} of 5 matchup stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={`sos-star-${i}`}
          className={cn(
            i > 0 ? "ml-0.5" : undefined,
            i < filled ? "font-bold text-amber-500" : "text-slate-200",
          )}
        >
          {"\u2605"}
        </span>
      ))}
    </span>
  );
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
      <div className="mt-0.5 flex max-w-full items-center justify-end truncate text-[11px] leading-none">
        {rankEl}
        {rankEl ? divider : null}
        {starsAndVs}
      </div>
    );
  }

  return (
    <div className="mt-0.5 flex max-w-full items-center truncate text-[11px] leading-none">
      {starsAndVs}
      {rankEl ? divider : null}
      {rankEl}
    </div>
  );
}

/**
 * Line 1 injury chip — reads `player.injury` from the same TanStack Query
 * cache / options as PlayerDetail (`detailQuery`).
 */
function MatchupInjuryBadge({
  playerId,
  playerName,
  onOpen,
}: {
  playerId: string;
  playerName: string;
  onOpen: () => void;
}) {
  const { data } = useQuery({
    ...detailQuery(playerId),
    enabled: Boolean(playerId),
  });

  if (!playerId) return null;

  const injury = data?.player?.injury;
  if (!injury || injury === "Healthy" || injury === "Active" || injury === "None") {
    return null;
  }

  let label: "Q" | "O" | "IR" | "NA" | null = null;
  if (injury === "Questionable") label = "Q";
  else if (injury === "Out" || injury === "Doubtful") label = "O";
  else if (injury === "IR") label = "IR";
  else if (injury === "NA") label = "NA";

  if (!label) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${playerName} injury status ${label}`}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white transition-all hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ backgroundColor: label === "Q" ? "#f59e0b" : "#e11d48" }}
    >
      {label}
    </button>
  );
}

/** Headshot + bottom-right NFL logo. No overflow-hidden on the frame. */
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
      aria-label={`Open ${player.name} details`}
      className={cn(
        "relative h-12 w-12 flex-shrink-0 cursor-pointer rounded-full transition-all hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      <img
        src={playerImage(player.id, player.pos, player.team)}
        alt=""
        loading="lazy"
        className="h-12 w-12 rounded-full object-cover"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      {logo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          className="absolute bottom-0 right-0 z-30 h-5 w-5 rounded-full border-2 border-white bg-white object-contain"
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
  projPts,
  showCheck,
  checkSide,
}: {
  liveLabel: string;
  projPts: number | null;
  showCheck: boolean;
  checkSide: "left" | "right";
}) {
  const check = showCheck ? (
    <span className="font-bold text-emerald-600" aria-hidden="true">
      ✓
    </span>
  ) : null;
  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center justify-center">
      <p className="text-center text-sm font-bold tabular-nums leading-none text-slate-900">
        {liveLabel}
      </p>
      <p className="mt-1 flex items-center justify-center gap-0.5 text-[11px] font-medium tabular-nums leading-none text-slate-400">
        {checkSide === "left" ? check : null}
        <span>{projPts != null ? projPts.toFixed(2) : "--"}</span>
        {checkSide === "right" ? check : null}
      </p>
    </div>
  );
}

type SideCardProps = {
  player: Player | null;
  livePts: number | null;
  projPts: number | null;
  phase?: NflGameProgress["phase"];
  scheduleLabel?: string;
  boxScoreLabel?: string;
  sosStars?: number | null;
  sosOpponent?: string | null;
  showCheck?: boolean;
  onOpenPlayer?: (id: string) => void;
};

function liveScoreLabel(
  phase: NflGameProgress["phase"] | undefined,
  livePts: number | null,
): string {
  if (phase !== "pre" || (livePts != null && livePts > 0)) {
    return livePts != null ? livePts.toFixed(2) : "0.00";
  }
  return "-";
}

/**
 * LEFT card: avatar | left text stack | scores
 * One discrete bordered box — never spans into the center badge column.
 */
function LeftPlayerCard({
  player,
  livePts,
  projPts,
  phase = "pre",
  scheduleLabel = "",
  boxScoreLabel = "",
  sosStars = null,
  sosOpponent = null,
  showCheck = false,
  onOpenPlayer,
}: SideCardProps) {
  const isFinal = phase === "post";
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
      : "border-slate-200 bg-white",
  );

  if (!player) {
    return (
      <div className="flex h-full w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <span className="w-full text-center text-[11px] font-medium text-slate-400">Empty</span>
      </div>
    );
  }

  const open = () => onOpenPlayer?.(player.id);
  const teamAbbr = (player.team || "FA").toUpperCase();
  const line2 = isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal ? formatWinnerFirstBoxScore(boxScoreLabel) : "";

  return (
    <div className={shell}>
      <MatchupPlayerThumb player={player} onOpen={open} />
      <div className="flex min-w-0 flex-1 flex-col items-start justify-center pl-3.5 text-left">
        <p className="flex max-w-full items-center gap-1.5 truncate text-left text-sm leading-none">
          <button
            type="button"
            onClick={open}
            className="max-w-full cursor-pointer truncate font-bold text-slate-900 transition-all hover:text-blue-600 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {player.name}
          </button>
          <MatchupInjuryBadge
            playerId={player.id}
            playerName={player.name}
            onOpen={open}
          />
          <span className="shrink-0 font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-0.5 max-w-full truncate text-[11px] font-medium leading-none text-slate-500">
          {line2}
        </p>
        {isFinal ? (
          line3Final ? (
            <p className="mt-0.5 max-w-full truncate text-[11px] font-medium tabular-nums leading-none text-slate-500">
              {line3Final}
            </p>
          ) : null
        ) : (
          <SosStarRankLine
            stars={sosStars}
            opponent={sosOpponent}
            posRank={posRankLabel(player)}
            align="left"
          />
        )}
      </div>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts)}
        projPts={projPts}
        showCheck={showCheck}
        checkSide="left"
      />
    </div>
  );
}

/**
 * RIGHT card: scores | right text stack | avatar
 * Mirrored track — still a single grid cell sibling of the left card.
 */
function RightPlayerCard({
  player,
  livePts,
  projPts,
  phase = "pre",
  scheduleLabel = "",
  boxScoreLabel = "",
  sosStars = null,
  sosOpponent = null,
  showCheck = false,
  onOpenPlayer,
}: SideCardProps) {
  const isFinal = phase === "post";
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
      : "border-slate-200 bg-white",
  );

  if (!player) {
    return (
      <div className="flex h-full w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <span className="w-full text-center text-[11px] font-medium text-slate-400">Empty</span>
      </div>
    );
  }

  const open = () => onOpenPlayer?.(player.id);
  const teamAbbr = (player.team || "FA").toUpperCase();
  const line2 = isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal ? formatWinnerFirstBoxScore(boxScoreLabel) : "";

  return (
    <div className={shell}>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts)}
        projPts={projPts}
        showCheck={showCheck}
        checkSide="right"
      />
      <div className="flex min-w-0 flex-1 flex-col items-end justify-center pr-3.5 text-right">
        <p className="flex max-w-full items-center justify-end gap-1.5 truncate text-right text-sm leading-none">
          <button
            type="button"
            onClick={open}
            className="max-w-full cursor-pointer truncate font-bold text-slate-900 transition-all hover:text-blue-600 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {player.name}
          </button>
          <MatchupInjuryBadge
            playerId={player.id}
            playerName={player.name}
            onOpen={open}
          />
          <span className="shrink-0 font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-0.5 max-w-full truncate text-[11px] font-medium leading-none text-slate-500">
          {line2}
        </p>
        {isFinal ? (
          line3Final ? (
            <p className="mt-0.5 max-w-full truncate text-[11px] font-medium tabular-nums leading-none text-slate-500">
              {line3Final}
            </p>
          ) : null
        ) : (
          <SosStarRankLine
            stars={sosStars}
            opponent={sosOpponent}
            posRank={posRankLabel(player)}
            align="right"
          />
        )}
      </div>
      <MatchupPlayerThumb player={player} onOpen={open} className="ml-3.5" />
    </div>
  );
}

/**
 * ONE parent grid row per slot. Left card, center badge, and right card are
 * always direct horizontal children — never separate mapped lines.
 */
function MatchupGridRow({
  slot,
  mine,
  opp,
  mineLive,
  oppLive,
  mineProj,
  oppProj,
  minePhase = "pre",
  oppPhase = "pre",
  mineSchedule = "",
  oppSchedule = "",
  mineBoxScore = "",
  oppBoxScore = "",
  mineSosStars = null,
  oppSosStars = null,
  mineSosOpponent = null,
  oppSosOpponent = null,
  showFavoriteCheck = false,
  onOpenPlayer,
}: {
  slot: string;
  mine: Player | null;
  opp: Player | null;
  mineLive: number | null;
  oppLive: number | null;
  mineProj: number | null;
  oppProj: number | null;
  minePhase?: NflGameProgress["phase"];
  oppPhase?: NflGameProgress["phase"];
  mineSchedule?: string;
  oppSchedule?: string;
  mineBoxScore?: string;
  oppBoxScore?: string;
  mineSosStars?: number | null;
  oppSosStars?: number | null;
  mineSosOpponent?: string | null;
  oppSosOpponent?: string | null;
  showFavoriteCheck?: boolean;
  onOpenPlayer?: (id: string) => void;
}) {
  const mineWins =
    showFavoriteCheck &&
    mineProj != null &&
    oppProj != null &&
    mineProj > oppProj;
  const oppWins =
    showFavoriteCheck &&
    mineProj != null &&
    oppProj != null &&
    oppProj > mineProj;

  return (
    <div className="mx-auto my-3 grid h-[88px] w-full max-w-7xl grid-cols-[1fr_64px_1fr] items-center">
      <div className="min-w-0">
        <LeftPlayerCard
          player={mine}
          livePts={mineLive}
          projPts={mineProj}
          phase={minePhase}
          scheduleLabel={mineSchedule}
          boxScoreLabel={mineBoxScore}
          sosStars={mineSosStars}
          sosOpponent={mineSosOpponent}
          showCheck={Boolean(mineWins)}
          {...(onOpenPlayer ? { onOpenPlayer } : {})}
        />
      </div>
      <div className="flex h-full items-center justify-center">
        <MatchupSlotBadge slot={slot} />
      </div>
      <div className="min-w-0">
        <RightPlayerCard
          player={opp}
          livePts={oppLive}
          projPts={oppProj}
          phase={oppPhase}
          scheduleLabel={oppSchedule}
          boxScoreLabel={oppBoxScore}
          sosStars={oppSosStars}
          sosOpponent={oppSosOpponent}
          showCheck={Boolean(oppWins)}
          {...(onOpenPlayer ? { onOpenPlayer } : {})}
        />
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="mx-auto mb-1 mt-6 block w-full max-w-7xl border-b border-slate-200 py-2 text-center text-sm font-black uppercase tracking-widest text-slate-900 first:mt-2">
      {label}
    </p>
  );
}

/** STARTERS row: Current/Optimal toggles share the same horizontal track as the section title. */
function StartersSectionHeader({
  myMode,
  oppMode,
  onMyMode,
  onOppMode,
}: {
  myMode: LineMode;
  oppMode: LineMode;
  onMyMode: (next: LineMode) => void;
  onOppMode: (next: LineMode) => void;
}) {
  return (
    <div className="mx-auto mb-1 mt-4 grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-slate-200 py-2">
      <div className="flex justify-start">
        <LineModeToggle mode={myMode} onChange={onMyMode} align="left" />
      </div>
      <p className="text-center text-sm font-black uppercase tracking-widest text-slate-900">
        Starters
      </p>
      <div className="flex justify-end">
        <LineModeToggle mode={oppMode} onChange={onOppMode} align="right" />
      </div>
    </div>
  );
}

const SCHEDULE_CACHE_KEY = "schedule-v1";
const PLAYERS_CACHE_KEY = "players-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Same defensive-rank catalog used by player popup SoS fallback. */
async function loadDefenseRanks(): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  try {
    const hit = await readCache<PlayersPayload>(PLAYERS_CACHE_KEY);
    const defenses = (hit?.data?.players ?? []).filter((p) => p.pos === "DEF");
    [...defenses]
      .sort((a, b) => b.proj.half - a.proj.half)
      .forEach((d, i) => {
        const team = (d.team || "").toUpperCase();
        if (team) ranks.set(team, i + 1);
      });
  } catch {
    /* ignore */
  }
  return ranks;
}

async function loadScheduleGames(): Promise<ScheduleGame[]> {
  try {
    const payload = await getCached<{ season: string; games: ScheduleGame[] }>(
      SCHEDULE_CACHE_KEY,
      DAY_MS,
      async () => {
        const season = currentSeason();
        return { season, games: await fetchSchedule(season) };
      },
    );
    return payload?.games ?? [];
  } catch {
    return [];
  }
}

/** Build team → week-by-week SoS rows from the native NFL schedule catalog. */
function buildScheduleSosByTeam(
  games: ScheduleGame[],
  ranks: Map<string, number>,
): Map<string, SosMatchup[]> {
  const byTeam = new Map<string, SosMatchup[]>();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({ week: g.week, opp: away, rank: ranks.get(away) ?? null, pointsAllowed: null });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({ week: g.week, opp: home, rank: ranks.get(home) ?? null, pointsAllowed: null });
      byTeam.set(away, rows);
    }
  }
  for (const [team, rows] of byTeam) {
    byTeam.set(
      team,
      [...rows].sort((a, b) => a.week - b.week),
    );
  }
  return byTeam;
}

function PlaybookMatchupPage() {
  const { activeLeague, activeLeagueId } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();
  const [scheduleSosByTeam, setScheduleSosByTeam] = useState<Map<string, SosMatchup[]>>(
    () => new Map(),
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const [games, ranks] = await Promise.all([loadScheduleGames(), loadDefenseRanks()]);
      if (!alive) return;
      setScheduleSosByTeam(buildScheduleSosByTeam(games, ranks));
    })().catch(() => {
      /* silent */
    });
    return () => {
      alive = false;
    };
  }, []);

  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = useCallback((id: string) => modalRef.current?.open(id), []);
  const [myMode, setMyMode] = useState<LineMode>("current");
  const [oppMode, setOppMode] = useState<LineMode>("current");
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
        headers: { accept: "application/json" },
      }).catch(() => null);
      const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      return Math.max(1, Number(json?.["week"] ?? 1) || 1);
    },
  });

  // Default to the active sync week on mount / league switch.
  useEffect(() => {
    if (nflWeek.data != null) setSelectedWeek(nflWeek.data);
  }, [nflWeek.data, activeLeagueId]);

  const activeWeek = selectedWeek ?? nflWeek.data ?? 1;
  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam } = useNflGameProgress(activeWeek);

  const loading =
    playersLoading ||
    rostersLoading ||
    projectionsLoading ||
    matchupsLoading ||
    nflWeek.isLoading;

  const weeklyPair = useMemo(() => {
    const empty = {
      oppRosterId: null as number | null,
      oppName: null as string | null,
      oppLogo: null as string | null,
      myPoints: 0,
      oppPoints: 0,
      myStarterIds: [] as string[],
      myPlayerPoints: {} as Record<string, number>,
      oppStarterIds: [] as string[],
      oppPlayerPoints: {} as Record<string, number>,
      myBaseline: 0,
      oppBaseline: 0,
    };
    const entries = matchups?.entries ?? [];
    if (!entries.length) return empty;

    const norm = (value: string | null | undefined) =>
      (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

    const myRosterId = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
    const mine =
      (myRosterId != null
        ? entries.find((row) => Number(row.rosterId) === Number(myRosterId))
        : null) ??
      entries.find(
        (row) =>
          Boolean(activeLeague?.teamName) &&
          norm(row.teamName) === norm(activeLeague?.teamName),
      ) ??
      entries.find((row) => Boolean(myTeam?.team) && norm(row.teamName) === norm(myTeam?.team)) ??
      null;

    if (!mine) return empty;

    const rival =
      mine.matchupId != null
        ? entries.find(
            (row) =>
              row.matchupId != null &&
              Number(row.matchupId) === Number(mine.matchupId) &&
              Number(row.rosterId) !== Number(mine.rosterId),
          ) ?? null
        : null;

    const rivalFromRosters =
      rival != null ? teams.find((t) => Number(t.slot) === Number(rival.rosterId)) ?? null : null;

    return {
      oppRosterId: rival?.rosterId ?? null,
      oppName: rivalFromRosters?.team || rival?.teamName || null,
      oppLogo: rivalFromRosters?.logo || rival?.logo || null,
      myPoints: mine.points,
      oppPoints: rival?.points ?? 0,
      myStarterIds: mine.starters ?? [],
      myPlayerPoints: mine.playerPoints ?? {},
      oppStarterIds: rival?.starters ?? [],
      oppPlayerPoints: rival?.playerPoints ?? {},
      myBaseline: mine.projectedPoints,
      oppBaseline: rival?.projectedPoints ?? 0,
    };
  }, [matchups, myTeam, teams, activeLeague?.teamName]);

  const oppTeam = useMemo(() => {
    if (weeklyPair.oppRosterId != null) {
      return teams.find((t) => Number(t.slot) === Number(weeklyPair.oppRosterId)) ?? null;
    }
    return null;
  }, [teams, weeklyPair.oppRosterId]);

  const slotLabels = useMemo(() => starterSlotLabels(rosterPositions), [rosterPositions]);

  const starterRows = useMemo(() => {
    const minePlayers =
      myMode === "optimal"
        ? buildOptimalStarterRows(myTeam, slotLabels, projectFor)
        : buildCurrentStarterRows(
            myTeam,
            slotLabels,
            weeklyPair.myStarterIds,
            playersById,
          );
    const oppPlayers =
      oppMode === "optimal"
        ? buildOptimalStarterRows(oppTeam, slotLabels, projectFor)
        : buildCurrentStarterRows(
            oppTeam,
            slotLabels,
            weeklyPair.oppStarterIds,
            playersById,
          );

    return slotLabels.map((slot, i) => ({
      slot,
      mine: minePlayers[i] ?? null,
      opp: oppPlayers[i] ?? null,
    }));
  }, [
    myMode,
    oppMode,
    myTeam,
    oppTeam,
    slotLabels,
    projectFor,
    weeklyPair.myStarterIds,
    weeklyPair.oppStarterIds,
    playersById,
  ]);

  const starterIdSets = useMemo(() => {
    const mine = new Set(
      starterRows.map((r) => r.mine?.id).filter((id): id is string => Boolean(id)),
    );
    const opp = new Set(
      starterRows.map((r) => r.opp?.id).filter((id): id is string => Boolean(id)),
    );
    return { mine, opp };
  }, [starterRows]);

  const benchRows = useMemo(() => {
    let mineBench = (myTeam?.bench ?? []).filter((p) => !starterIdSets.mine.has(p.id));
    let oppBench = (oppTeam?.bench ?? []).filter((p) => !starterIdSets.opp.has(p.id));

    if (myMode === "optimal") {
      const mineExtra = (myTeam?.players ?? []).filter(
        (p) =>
          !starterIdSets.mine.has(p.id) &&
          !(myTeam?.ir ?? []).some((ir) => ir.id === p.id) &&
          !mineBench.some((b) => b.id === p.id),
      );
      mineBench = [...mineBench, ...mineExtra];
    }
    if (oppMode === "optimal") {
      const oppExtra = (oppTeam?.players ?? []).filter(
        (p) =>
          !starterIdSets.opp.has(p.id) &&
          !(oppTeam?.ir ?? []).some((ir) => ir.id === p.id) &&
          !oppBench.some((b) => b.id === p.id),
      );
      oppBench = [...oppBench, ...oppExtra];
    }

    return padPairRows(mineBench, oppBench, "BN");
  }, [myTeam, oppTeam, starterIdSets, myMode, oppMode]);

  const irRows = useMemo(() => {
    return padPairRows(myTeam?.ir ?? [], oppTeam?.ir ?? [], "IR");
  }, [myTeam, oppTeam]);

  const livePtsFor = (
    player: Player | null,
    pointsMap: Record<string, number>,
  ): number | null => {
    if (!player) return null;
    return Math.round((Number(pointsMap[player.id] ?? 0) || 0) * 100) / 100;
  };

  const progressFor = (player: Player | null): NflGameProgress | undefined => {
    if (!player) return undefined;
    const nfl = (player.team || "").trim().toUpperCase();
    if (!nfl) return undefined;
    const keys = TEAM_PROGRESS_ALIASES[nfl] ?? [nfl];
    for (const key of keys) {
      const hit = progressByNflTeam.get(key);
      if (hit) return hit;
    }
    return undefined;
  };

  const phaseFor = (player: Player | null): NflGameProgress["phase"] => {
    return progressFor(player)?.phase ?? "pre";
  };

  const scheduleFor = (player: Player | null): string => {
    if (!player) return "";
    const nfl = (player.team || "").trim().toUpperCase();
    if (!nfl) return "";
    if (player.bye != null && player.bye === activeWeek) return "BYE";

    const progress = progressFor(player);
    if (progress?.phase === "post") return "Final";
    if (progress?.phase === "in") {
      return formatNflGameStatusLabel(progress, nfl) || "Live";
    }

    // Pre-game: always surface kickoff day/time — never blank the line.
    const kickoff =
      formatNflKickoffLabel(progress?.kickoffIso) ||
      formatNflGameStatusLabel(progress, nfl);
    if (kickoff && kickoff.toLowerCase() !== "final") return kickoff;

    const detail = (progress?.shortDetail ?? "").trim();
    if (detail) {
      return detail
        .replace(/\s+at\s+/i, " ")
        .replace(/\s+(EDT|EST|CDT|CST|MDT|MST|PDT|PST)\b/gi, "")
        .replace(/\s+(AM|PM)\b/gi, (_, m: string) => m.toUpperCase())
        .trim();
    }
    return "TBD";
  };

  const boxScoreFor = (player: Player | null): string => {
    const progress = progressFor(player);
    if (!progress || progress.phase !== "post") return "";
    return formatWinnerFirstBoxScore(progress.boxScoreLabel ?? "");
  };

  /**
   * True weekly SoS: player_brain positional matchup group first (same as
   * player popup), then native schedule + defense-rank fallback.
   */
  const weeklySosHitFor = (
    player: Player | null,
  ): { stars: number | null; opp: string | null } => {
    if (!player) return { stars: null, opp: null };
    if (phaseFor(player) === "post") return { stars: null, opp: null };

    const brainHit = weeklySosMatchupFor(brain, player.id, activeWeek);
    if (brainHit) {
      return {
        stars: sosStarsFromRank(brainHit.rank),
        opp: (brainHit.opp ?? "").trim().toUpperCase() || null,
      };
    }

    const team = (player.team || "").trim().toUpperCase();
    const schedHit = team
      ? scheduleSosByTeam.get(team)?.find((m) => Number(m.week) === Number(activeWeek))
      : undefined;
    if (schedHit) {
      return {
        stars: sosStarsFromRank(schedHit.rank),
        opp: (schedHit.opp ?? "").trim().toUpperCase() || null,
      };
    }

    const progressOpp = (progressFor(player)?.opponentAbbr ?? "").trim().toUpperCase();
    return { stars: null, opp: progressOpp || null };
  };

  const sosStarsFor = (player: Player | null): number | null => weeklySosHitFor(player).stars;

  const sosOpponentFor = (player: Player | null): string | null => weeklySosHitFor(player).opp;

  const projPtsFor = (
    player: Player | null,
    pointsMap: Record<string, number>,
  ): number | null => {
    if (!player) return null;
    const live = Number(pointsMap[player.id] ?? 0) || 0;
    const baseline = projectFor(player.id) ?? weeklyFallback(player);
    const nfl = (player.team || "").trim().toUpperCase();
    return (
      Math.round(
        playerLiveRollingProjection({
          livePoints: live,
          baselineProjection: baseline,
          progress: progressByNflTeam.get(nfl),
        }) * 100,
      ) / 100
    );
  };

  const headerProjections = useMemo(() => {
    const mineStarters = starterRows
      .map((r) => r.mine)
      .filter((p): p is Player => Boolean(p));
    const oppStarters = starterRows
      .map((r) => r.opp)
      .filter((p): p is Player => Boolean(p));

    const myProj = computeTeamDisplayProjection({
      starters: mineStarters,
      playerPoints: weeklyPair.myPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: weeklyPair.myPoints,
      teamBaselineProj: weeklyPair.myBaseline,
    });
    const oppProj = computeTeamDisplayProjection({
      starters: oppStarters,
      playerPoints: weeklyPair.oppPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: weeklyPair.oppPoints,
      teamBaselineProj: weeklyPair.oppBaseline,
    });
    const myWinPct = winPctFromDisplayProjections(myProj, oppProj);
    return { myProj, oppProj, myWinPct, oppWinPct: 100 - myWinPct };
  }, [starterRows, weeklyPair, projectFor, progressByNflTeam]);

  const myName = myTeam?.team || activeLeague?.teamName || "My Team";
  const oppName =
    weeklyPair.oppName ||
    oppTeam?.team ||
    (weeklyPair.oppRosterId == null && matchups?.entries?.length ? "Bye week" : "Opponent");
  const mineLeadsProj = headerProjections.myProj >= headerProjections.oppProj;
  const mineLeadsWin = headerProjections.myWinPct >= headerProjections.oppWinPct;

  return (
    <section key={activeLeagueId ?? "none"} className={playbookCardClass}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display-title text-lg uppercase tracking-wide">Matchup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeLeague?.name?.trim() || "Active league"} weekly head-to-head board.
          </p>
        </div>
        <WeekSelector week={activeWeek} onChange={setSelectedWeek} />
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading matchup board…</p>
      ) : (
        <>
          {/* Header replica of dashboard Matchup card */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-col items-center justify-between gap-5 px-4 py-6 sm:flex-row sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[42%]">
                <TeamLogoAvatar
                  name={myName}
                  logo={myTeam?.logo ?? activeLeague?.avatar ?? null}
                  platform={activeLeague?.platform ?? null}
                  cacheKey={`${activeLeagueId ?? "none"}-mine`}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{myName}</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                    {weeklyPair.myPoints.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "text-[11px] tabular-nums",
                      mineLeadsProj
                        ? "font-bold text-emerald-600"
                        : "font-medium text-slate-400",
                    )}
                  >
                    {headerProjections.myProj.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-center justify-center">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold uppercase text-white">
                  vs
                </span>
              </div>

              <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:max-w-[42%]">
                <div className="min-w-0 text-right">
                  <p className="truncate text-sm font-semibold text-slate-800">{oppName}</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                    {weeklyPair.oppPoints.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "text-[11px] tabular-nums",
                      !mineLeadsProj
                        ? "font-bold text-emerald-600"
                        : "font-medium text-slate-400",
                    )}
                  >
                    {headerProjections.oppProj.toFixed(2)}
                  </p>
                </div>
                <TeamLogoAvatar
                  name={oppName}
                  logo={weeklyPair.oppLogo || oppTeam?.logo || null}
                  platform={activeLeague?.platform ?? null}
                  cacheKey={`${activeLeagueId ?? "none"}-opp`}
                />
              </div>
            </div>

            <div className="border-t border-border/60 px-4 pb-4 pt-3">
              <p className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                WIN %
              </p>
              <div className="flex w-full items-center gap-3 text-sm font-bold">
                <span
                  className={cn(
                    "w-12 shrink-0 tabular-nums",
                    mineLeadsWin ? "text-emerald-600" : "text-rose-600",
                  )}
                >
                  {headerProjections.myWinPct}%
                </span>
                <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1.5">
                  <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        mineLeadsWin ? "bg-emerald-500" : "bg-rose-500",
                      )}
                      style={{ width: `${headerProjections.myWinPct}%` }}
                    />
                  </div>
                  <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        mineLeadsWin ? "bg-rose-500" : "bg-emerald-500",
                      )}
                      style={{ width: `${headerProjections.oppWinPct}%` }}
                    />
                  </div>
                </div>
                <span
                  className={cn(
                    "w-12 shrink-0 text-right tabular-nums",
                    mineLeadsWin ? "text-rose-600" : "text-emerald-600",
                  )}
                >
                  {headerProjections.oppWinPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Side-by-side FantasyPros card rows */}
          <div className="mt-3">
            <StartersSectionHeader
              myMode={myMode}
              oppMode={oppMode}
              onMyMode={setMyMode}
              onOppMode={setOppMode}
            />
            <div>
              {starterRows.map((row, i) => (
                <MatchupGridRow
                  key={`starter-${row.slot}-${i}`}
                  slot={row.slot}
                  mine={row.mine}
                  opp={row.opp}
                  mineLive={livePtsFor(row.mine, weeklyPair.myPlayerPoints)}
                  oppLive={livePtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                  mineProj={projPtsFor(row.mine, weeklyPair.myPlayerPoints)}
                  oppProj={projPtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                  minePhase={phaseFor(row.mine)}
                  oppPhase={phaseFor(row.opp)}
                  mineSchedule={scheduleFor(row.mine)}
                  oppSchedule={scheduleFor(row.opp)}
                  mineBoxScore={boxScoreFor(row.mine)}
                  oppBoxScore={boxScoreFor(row.opp)}
                  mineSosStars={sosStarsFor(row.mine)}
                  oppSosStars={sosStarsFor(row.opp)}
                  mineSosOpponent={sosOpponentFor(row.mine)}
                  oppSosOpponent={sosOpponentFor(row.opp)}
                  showFavoriteCheck
                  onOpenPlayer={openPlayer}
                />
              ))}
            </div>

            <SectionHeader label="Bench" />
            <div>
              {benchRows.length ? (
                benchRows.map((row, i) => (
                  <MatchupGridRow
                    key={`bench-${i}-${row.mine?.id ?? "x"}-${row.opp?.id ?? "y"}`}
                    slot="BN"
                    mine={row.mine}
                    opp={row.opp}
                    mineLive={livePtsFor(row.mine, weeklyPair.myPlayerPoints)}
                    oppLive={livePtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                    mineProj={projPtsFor(row.mine, weeklyPair.myPlayerPoints)}
                    oppProj={projPtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                    minePhase={phaseFor(row.mine)}
                    oppPhase={phaseFor(row.opp)}
                    mineSchedule={scheduleFor(row.mine)}
                    oppSchedule={scheduleFor(row.opp)}
                    mineBoxScore={boxScoreFor(row.mine)}
                    oppBoxScore={boxScoreFor(row.opp)}
                    mineSosStars={sosStarsFor(row.mine)}
                    oppSosStars={sosStarsFor(row.opp)}
                    mineSosOpponent={sosOpponentFor(row.mine)}
                    oppSosOpponent={sosOpponentFor(row.opp)}
                    onOpenPlayer={openPlayer}
                  />
                ))
              ) : (
                <p className="mx-auto max-w-7xl px-3 py-4 text-center text-sm text-muted-foreground">
                  No bench players listed for this matchup.
                </p>
              )}
            </div>

            {irRows.length > 0 ? (
              <>
                <SectionHeader label="IR" />
                <div>
                  {irRows.map((row, i) => (
                    <MatchupGridRow
                      key={`ir-${i}-${row.mine?.id ?? "x"}-${row.opp?.id ?? "y"}`}
                      slot="IR"
                      mine={row.mine}
                      opp={row.opp}
                      mineLive={livePtsFor(row.mine, weeklyPair.myPlayerPoints)}
                      oppLive={livePtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                      mineProj={projPtsFor(row.mine, weeklyPair.myPlayerPoints)}
                      oppProj={projPtsFor(row.opp, weeklyPair.oppPlayerPoints)}
                      minePhase={phaseFor(row.mine)}
                      oppPhase={phaseFor(row.opp)}
                      mineSchedule={scheduleFor(row.mine)}
                      oppSchedule={scheduleFor(row.opp)}
                      mineBoxScore={boxScoreFor(row.mine)}
                      oppBoxScore={boxScoreFor(row.opp)}
                      mineSosStars={sosStarsFor(row.mine)}
                      oppSosStars={sosStarsFor(row.opp)}
                      mineSosOpponent={sosOpponentFor(row.mine)}
                      oppSosOpponent={sosOpponentFor(row.opp)}
                      onOpenPlayer={openPlayer}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}

      <PlayerModalHost ref={modalRef} />
    </section>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { detailQuery } from "@/components/draft/PlayerDetail";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  MatchupReplayModal,
  WatchReplayButton,
} from "@/components/playbook/MatchupReplayModal";
import { playbookCardClass, resolveAvatarUrl } from "@/components/playbook/panels";
import { SosStars } from "@/components/sos/SosStars";
import type { MatchupReplayRequest } from "@/lib/matchup-replay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { starterRequirements } from "@/lib/power-rankings";
import {
  computeDynamicWinProbability,
  computeTeamDisplayProjection,
  formatNflGameStatusLabel,
  formatNflKickoffLabel,
  playerLiveRollingProjection,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import { sosStarsFromRank, weeklySosMatchupFor, type SosMatchup } from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";
import { currentSeason, fetchSchedule, type ScheduleGame } from "@/lib/players-build";
import { getCached } from "@/lib/sleeper-cache";

/** Sleeper ↔ ESPN abbreviation aliases for scoreboard lookups. */
const TEAM_PROGRESS_ALIASES: Record<string, string[]> = {
  WAS: ["WAS", "WSH"],
  WSH: ["WSH", "WAS"],
  LAR: ["LAR", "LA"],
  LA: ["LA", "LAR"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAX", "JAC"],
};

function progressForNflTeam(
  teamAbbr: string | null | undefined,
  progressByNflTeam: Map<string, NflGameProgress>,
): NflGameProgress | undefined {
  const nfl = (teamAbbr || "").trim().toUpperCase();
  if (!nfl) return undefined;
  const keys = TEAM_PROGRESS_ALIASES[nfl] ?? [nfl];
  for (const key of keys) {
    const hit = progressByNflTeam.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export const Route = createFileRoute("/playbook/matchup")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Matchup — Playbook" }],
  }),
  component: PlaybookMatchupPage,
});

/** Never invent a weekly proj from season averages — Sleeper shows "—" instead. */
const weeklyFallback = (_p: Player) => 0;
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

/** Opaque pastel pos fills (same look as the old /15 tints) with solid pos-colored labels. */
const SLOT_PILL_TONE: Record<string, string> = {
  QB: "border-[color-mix(in_oklab,var(--color-qb)_32%,white)] bg-[color-mix(in_oklab,var(--color-qb)_18%,white)] text-qb",
  RB: "border-[color-mix(in_oklab,var(--color-rb)_32%,white)] bg-[color-mix(in_oklab,var(--color-rb)_18%,white)] text-rb",
  WR: "border-[color-mix(in_oklab,var(--color-wr)_32%,white)] bg-[color-mix(in_oklab,var(--color-wr)_18%,white)] text-wr",
  TE: "border-[color-mix(in_oklab,var(--color-te)_32%,white)] bg-[color-mix(in_oklab,var(--color-te)_18%,white)] text-te",
  K: "border-[color-mix(in_oklab,var(--color-k)_32%,white)] bg-[color-mix(in_oklab,var(--color-k)_18%,white)] text-k",
  DEF: "border-[color-mix(in_oklab,var(--color-def)_32%,white)] bg-[color-mix(in_oklab,var(--color-def)_18%,white)] text-def",
  BN: "border-slate-300 bg-slate-100 text-slate-600",
  IR: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Standalone center badge — overlaps the seam between left/right cards. */
function MatchupSlotBadge({ slot }: { slot: string }) {
  const label = badgeLabel(slot);
  const display = slot === "IR" ? "IR" : label;
  const isFlx = display === "FLX" || slot === "FLEX" || slot === "FLX";
  const pillBase =
    "mx-auto z-20 flex h-9 w-11 items-center justify-center rounded-md border text-xs font-bold uppercase shadow-md ring-2 ring-white";

  if (isFlx) {
    return (
      <span
        className={cn(
          pillBase,
          "relative isolate overflow-hidden border-slate-300 text-slate-800",
        )}
      >
        <span className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
          <span className="h-full w-1/3 bg-[color-mix(in_oklab,var(--color-rb)_22%,white)]" />
          <span className="h-full w-1/3 bg-[color-mix(in_oklab,var(--color-wr)_22%,white)]" />
          <span className="h-full w-1/3 bg-[color-mix(in_oklab,var(--color-te)_22%,white)]" />
        </span>
        <span className="relative z-10">FLX</span>
      </span>
    );
  }

  return (
    <span className={cn(pillBase, SLOT_PILL_TONE[display] ?? SLOT_PILL_TONE["BN"])}>
      {display}
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

type MatchupOption = {
  id: string;
  matchupId: number;
  leftRosterId: number;
  rightRosterId: number | null;
  label: string;
  isMine: boolean;
};

function MatchupPicker({
  options,
  value,
  onChange,
}: {
  options: MatchupOption[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (!options.length) {
    return (
      <div className="inline-flex h-9 min-w-[12rem] items-center rounded-lg border border-border bg-white px-3 text-xs font-medium text-slate-400 shadow-sm">
        No matchups
      </div>
    );
  }

  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Select matchup"
        className="h-9 w-[min(100vw-8rem,20rem)] border-border bg-white shadow-sm sm:w-[22rem]"
      >
        <SelectValue placeholder="Select matchup" />
      </SelectTrigger>
      <SelectContent align="center" className="max-h-72">
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            <span className="flex items-center gap-2">
              <span className="truncate">{opt.label}</span>
              {opt.isMine ? (
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                  You
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  opts?: { fillEmptyFromLive?: boolean },
): (Player | null)[] {
  if (!team) return labels.map(() => null);

  const used = new Set<string>();
  const takeLiveForSlot = (slot: string, index: number): Player | null => {
    // 1) Index-aligned live starter (host order matches labels).
    const atIndex = team.starters[index] ?? null;
    if (atIndex && !used.has(atIndex.id) && playerFitsSlot(atIndex, slot)) {
      used.add(atIndex.id);
      return atIndex;
    }
    // 2) Any unused live starter that legally fills this slot (covers FLEX holes
    // when boxscore id resolution / client cache misses the player).
    for (const candidate of team.starters) {
      if (!candidate || used.has(candidate.id)) continue;
      if (!playerFitsSlot(candidate, slot)) continue;
      used.add(candidate.id);
      return candidate;
    }
    return null;
  };

  // Week-scoped starters (including "" empty slots).
  if (starterIds.length) {
    return labels.map((slot, i) => {
      const id = starterIds[i];
      if (id) {
        const hit = playersById.get(id) ?? null;
        if (hit) {
          used.add(hit.id);
          return hit;
        }
        // Id resolved on the server but missing from the client Sleeper cache —
        // fall back to the live host lineup for this slot.
        if (opts?.fillEmptyFromLive) return takeLiveForSlot(slot, i);
        return null;
      }
      if (opts?.fillEmptyFromLive) return takeLiveForSlot(slot, i);
      return null;
    });
  }
  if (team.starters.length) {
    return labels.map((slot, i) => {
      const atIndex = team.starters[i] ?? null;
      if (atIndex) {
        used.add(atIndex.id);
        return atIndex;
      }
      return takeLiveForSlot(slot, i);
    });
  }
  return buildOptimalStarterRows(team, labels, (id) => null, {
    pointsMap: {},
    progressByNflTeam: new Map(),
    activeWeek: 0,
  });
}

/**
 * Optimal lineup value for a player this week:
 * - Final games → actual fantasy points (retrospective ideal)
 * - In progress → live rolling projection
 * - Yet to play → Sleeper weekly projection (bye weeks stay 0)
 */
function optimalPlayerValue(
  player: Player,
  projectFor: (id: string) => number | null,
  pointsMap: Record<string, number>,
  progressByNflTeam: Map<string, NflGameProgress>,
  activeWeek: number,
): number {
  if (player.bye != null && Number(player.bye) === Number(activeWeek)) return 0;

  const progress = progressForNflTeam(player.team, progressByNflTeam);
  const phase = progress?.phase ?? "pre";
  const live = Math.max(0, Number(pointsMap[player.id] ?? 0) || 0);
  const baseline = projectFor(player.id) ?? weeklyFallback(player);

  if (phase === "post") return live;

  if (phase === "in") {
    return playerLiveRollingProjection({
      livePoints: live,
      baselineProjection: baseline,
      progress,
    });
  }

  return Math.max(0, baseline);
}

function playerFitsSlot(player: Player, slot: string): boolean {
  if (slot === "FLEX" || slot === "FLX") return FLEX_OK.has(player.pos);
  if (slot === "DEF" || slot === "DST") return player.pos === "DEF";
  return player.pos === slot;
}

/**
 * Build the ideal starter set for the week.
 * Finished players compete on actuals; yet-to-play compete on projections.
 * Non-FLEX slots fill first so FLEX gets the best leftover skill player.
 */
function buildOptimalStarterRows(
  team: ResolvedRosterTeam | null,
  labels: string[],
  projectFor: (id: string) => number | null,
  opts: {
    pointsMap: Record<string, number>;
    progressByNflTeam: Map<string, NflGameProgress>;
    activeWeek: number;
    /** Week-scoped IR ids when browsing historical matchups. */
    irIds?: string[];
    /** Week-scoped roster pool; falls back to live team.players. */
    playerPool?: Player[];
  },
): (Player | null)[] {
  if (!team) return labels.map(() => null);
  const irIds = new Set(
    (opts.irIds?.length ? opts.irIds : (team.ir ?? []).map((p) => p.id)).filter(Boolean),
  );
  const source = opts.playerPool?.length ? opts.playerPool : team.players;
  const pool = source
    .filter((p) => !irIds.has(p.id))
    .map((p) => ({
      player: p,
      value: optimalPlayerValue(
        p,
        projectFor,
        opts.pointsMap,
        opts.progressByNflTeam,
        opts.activeWeek,
      ),
    }))
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name));

  const used = new Set<string>();
  const pickForSlot = (slot: string): Player | null => {
    const match = pool.find((entry) => {
      if (used.has(entry.player.id)) return false;
      return playerFitsSlot(entry.player, slot);
    });
    if (match) used.add(match.player.id);
    return match?.player ?? null;
  };

  const out: (Player | null)[] = labels.map(() => null);
  // Fill locked positions before FLEX so the leftover best skill piece can flex.
  labels.forEach((slot, i) => {
    if (slot === "FLEX" || slot === "FLX") return;
    out[i] = pickForSlot(slot);
  });
  labels.forEach((slot, i) => {
    if (slot !== "FLEX" && slot !== "FLX") return;
    out[i] = pickForSlot(slot);
  });
  return out;
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

function posRankLabel(
  player: Player,
  sleeperPosRank?: number | null,
): string | null {
  const rank =
    sleeperPosRank != null && Number.isFinite(sleeperPosRank) && sleeperPosRank > 0
      ? sleeperPosRank
      : Number(player.posRank);
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

  let label: "Q" | "O" | "D" | "IR" | "NA" | null = null;
  if (injury === "Questionable") label = "Q";
  else if (injury === "Doubtful") label = "D";
  else if (injury === "Out") label = "O";
  else if (injury === "IR") label = "IR";
  else if (injury === "NA") label = "NA";

  if (!label) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${playerName} injury status ${label}`}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white transition-all hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{
        backgroundColor:
          label === "Q" ? "#f59e0b" : "#e11d48",
      }}
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
    // 0.00 vs 0.00 (Out / IR / blank slate) stays the default grey.
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

/** Live vs original weekly proj — grey before kickoff or on an exact match. */
function projVsLiveTone(livePts: number, projPts: number, weekStarted: boolean): string {
  if (!weekStarted) return "text-slate-400";
  const live = Number(livePts) || 0;
  const proj = Number(projPts) || 0;
  if (Math.abs(live - proj) < 0.005) return "text-slate-400";
  if (live > proj + 0.005) return "text-emerald-600";
  if (live < proj - 0.005) return "text-rose-600";
  return "text-slate-400";
}

/** Placeholder thumb matching MatchupPlayerThumb size for empty bench/IR slots. */
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
 * One discrete bordered box — center badge overlaps the outer seam.
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
  const { rankFor } = useLeagueProjections();
  const isFinal = phase === "post";
  const isLocked = phase === "post" || phase === "in";
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
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
  const line2 = isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal ? formatWinnerFirstBoxScore(boxScoreLabel) : "";
  const sleeperPos = rankFor(player.id).pos;

  return (
    <div className={shell}>
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
          <MatchupInjuryBadge
            playerId={player.id}
            playerName={player.name}
            onOpen={open}
          />
          <span className="shrink-0 text-sm font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-1 flex max-w-full items-center gap-1.5 truncate text-xs font-medium leading-none text-slate-500">
          <span className="truncate">{line2}</span>
          {phase === "in" ? <LineupLockBadge /> : null}
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
            posRank={posRankLabel(player, sleeperPos)}
            align="left"
          />
        )}
      </div>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts)}
        livePts={livePts}
        projPts={projPts}
        phase={phase}
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
  const { rankFor } = useLeagueProjections();
  const isFinal = phase === "post";
  const isLocked = phase === "post" || phase === "in";
  const shell = cn(
    "flex h-full w-full items-center justify-between rounded-xl border p-3.5 shadow-sm",
    isFinal
      ? "border-slate-200/80 bg-slate-50/85 opacity-95"
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
  const line2 = isFinal ? "Final" : scheduleLabel.trim() || "TBD";
  const line3Final = isFinal ? formatWinnerFirstBoxScore(boxScoreLabel) : "";
  const sleeperPos = rankFor(player.id).pos;

  return (
    <div className={shell}>
      <MatchupScoreColumn
        liveLabel={liveScoreLabel(phase, livePts)}
        livePts={livePts}
        projPts={projPts}
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
          <MatchupInjuryBadge
            playerId={player.id}
            playerName={player.name}
            onOpen={open}
          />
          <span className="shrink-0 text-sm font-medium text-slate-400">{teamAbbr}</span>
        </p>
        <p className="mt-1 flex max-w-full items-center justify-end gap-1.5 truncate text-xs font-medium leading-none text-slate-500">
          {phase === "in" ? <LineupLockBadge /> : null}
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
            posRank={posRankLabel(player, sleeperPos)}
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
    minePhase === "pre" &&
    mineProj != null &&
    oppProj != null &&
    mineProj > oppProj;
  const oppWins =
    showFavoriteCheck &&
    oppPhase === "pre" &&
    mineProj != null &&
    oppProj != null &&
    oppProj > mineProj;

  return (
    <div className="relative mx-auto my-3 grid h-[96px] w-full max-w-shell grid-cols-2 items-center gap-1.5">
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
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <MatchupSlotBadge slot={slot} />
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="mx-auto mb-1 mt-6 block w-full max-w-shell border-b border-slate-200 py-2 text-center text-sm font-black uppercase tracking-widest text-slate-900 first:mt-2">
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
    <div className="mx-auto mb-1 mt-4 grid w-full max-w-shell grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-slate-200 py-2">
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
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Team → week-by-week opponents from the NFL schedule (no invented SOS ranks). */
function buildScheduleOppByTeam(games: ScheduleGame[]): Map<string, SosMatchup[]> {
  const byTeam = new Map<string, SosMatchup[]>();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({ week: g.week, opp: away, rank: null, pointsAllowed: null });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({ week: g.week, opp: home, rank: null, pointsAllowed: null });
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
  const { standings } = useActiveStandings();
  const brain = usePlayerBrain();
  const { rankFor: positionalDefenseRank } = usePositionalDefenseRanks();
  const [scheduleSosByTeam, setScheduleSosByTeam] = useState<Map<string, SosMatchup[]>>(
    () => new Map(),
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const games = await loadScheduleGames();
      if (!alive) return;
      setScheduleSosByTeam(buildScheduleOppByTeam(games));
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
  const [viewMatchupId, setViewMatchupId] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week", "v3-week"],
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
  const { projectFor, scoringMap, loading: projectionsLoading } = useLeagueProjections(activeWeek);
  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam } = useNflGameProgress(activeWeek);

  // Reset viewed matchup when week or league changes.
  useEffect(() => {
    setViewMatchupId(null);
    setMyMode("current");
    setOppMode("current");
  }, [activeWeek, activeLeagueId]);

  const myRosterId = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;

  const matchupOptions = useMemo((): MatchupOption[] => {
    const entries = matchups?.entries ?? [];
    const byId = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (entry.matchupId == null) continue;
      const bucket = byId.get(entry.matchupId) ?? [];
      bucket.push(entry);
      byId.set(entry.matchupId, bucket);
    }

    const resolveName = (rosterId: number, fallback: string) =>
      teams.find((t) => Number(t.slot) === Number(rosterId))?.team?.trim() || fallback;

    const options: MatchupOption[] = [];
    for (const [matchupId, pair] of byId) {
      const sorted = [...pair].sort((a, b) => {
        if (myRosterId != null && Number(a.rosterId) === Number(myRosterId)) return -1;
        if (myRosterId != null && Number(b.rosterId) === Number(myRosterId)) return 1;
        return Number(a.rosterId) - Number(b.rosterId);
      });
      const left = sorted[0];
      if (!left) continue;
      const right = sorted[1] ?? null;
      const leftName = resolveName(left.rosterId, left.teamName);
      const rightName = right ? resolveName(right.rosterId, right.teamName) : "Bye week";
      const isMine =
        myRosterId != null &&
        (Number(left.rosterId) === Number(myRosterId) ||
          (right != null && Number(right.rosterId) === Number(myRosterId)));
      options.push({
        id: String(matchupId),
        matchupId,
        leftRosterId: left.rosterId,
        rightRosterId: right?.rosterId ?? null,
        label: right ? `${leftName} vs ${rightName}` : `${leftName} (Bye)`,
        isMine,
      });
    }

    options.sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return options;
  }, [matchups, teams, myRosterId]);

  useEffect(() => {
    if (!matchupOptions.length) return;
    if (viewMatchupId && matchupOptions.some((o) => o.id === viewMatchupId)) return;
    const mine = matchupOptions.find((o) => o.isMine);
    setViewMatchupId(mine?.id ?? matchupOptions[0]!.id);
  }, [matchupOptions, viewMatchupId]);

  const loading =
    playersLoading ||
    rostersLoading ||
    projectionsLoading ||
    matchupsLoading ||
    nflWeek.isLoading;

  const weeklyPair = useMemo(() => {
    const empty = {
      leftRosterId: null as number | null,
      oppRosterId: null as number | null,
      oppName: null as string | null,
      oppLogo: null as string | null,
      myPoints: 0,
      oppPoints: 0,
      myStarterIds: [] as string[],
      myPlayerIds: [] as string[],
      myIrIds: [] as string[],
      myPlayerPoints: {} as Record<string, number>,
      oppStarterIds: [] as string[],
      oppPlayerIds: [] as string[],
      oppIrIds: [] as string[],
      oppPlayerPoints: {} as Record<string, number>,
      myBaseline: 0,
      oppBaseline: 0,
      hasWeeklyRoster: false,
    };
    const entries = matchups?.entries ?? [];
    if (!entries.length || !viewMatchupId) return empty;

    const selected =
      matchupOptions.find((o) => o.id === viewMatchupId) ??
      matchupOptions.find((o) => o.isMine) ??
      matchupOptions[0] ??
      null;
    if (!selected) return empty;

    const left =
      entries.find((row) => Number(row.rosterId) === Number(selected.leftRosterId)) ?? null;
    if (!left) return empty;

    const right =
      selected.rightRosterId != null
        ? entries.find((row) => Number(row.rosterId) === Number(selected.rightRosterId)) ?? null
        : null;

    const rightFromRosters =
      right != null ? teams.find((t) => Number(t.slot) === Number(right.rosterId)) ?? null : null;

    const myPlayerIds = left.playerIds ?? [];
    const oppPlayerIds = right?.playerIds ?? [];
    const hasWeeklyRoster = myPlayerIds.length > 0 || oppPlayerIds.length > 0;

    return {
      leftRosterId: left.rosterId,
      oppRosterId: right?.rosterId ?? null,
      oppName: rightFromRosters?.team || right?.teamName || (right ? null : "Bye week"),
      oppLogo: rightFromRosters?.logo || right?.logo || null,
      myPoints: left.points,
      oppPoints: right?.points ?? 0,
      myStarterIds: left.starters ?? [],
      myPlayerIds,
      myIrIds: left.irIds ?? [],
      myPlayerPoints: left.playerPoints ?? {},
      oppStarterIds: right?.starters ?? [],
      oppPlayerIds,
      oppIrIds: right?.irIds ?? [],
      oppPlayerPoints: right?.playerPoints ?? {},
      myBaseline: left.projectedPoints,
      oppBaseline: right?.projectedPoints ?? 0,
      hasWeeklyRoster,
    };
  }, [matchups, matchupOptions, viewMatchupId, teams]);

  const leftTeam = useMemo(() => {
    if (weeklyPair.leftRosterId != null) {
      return teams.find((t) => Number(t.slot) === Number(weeklyPair.leftRosterId)) ?? null;
    }
    return null;
  }, [teams, weeklyPair.leftRosterId]);

  const oppTeam = useMemo(() => {
    if (weeklyPair.oppRosterId != null) {
      return teams.find((t) => Number(t.slot) === Number(weeklyPair.oppRosterId)) ?? null;
    }
    return null;
  }, [teams, weeklyPair.oppRosterId]);

  const slotLabels = useMemo(() => starterSlotLabels(rosterPositions), [rosterPositions]);

  const resolvePlayersByIds = useCallback(
    (ids: string[]): Player[] => {
      const out: Player[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const hit = playersById.get(id);
        if (hit) out.push(hit);
      }
      return out;
    },
    [playersById],
  );

  const starterRows = useMemo(() => {
    const minePool = weeklyPair.hasWeeklyRoster
      ? resolvePlayersByIds(weeklyPair.myPlayerIds)
      : undefined;
    const oppPool = weeklyPair.hasWeeklyRoster
      ? resolvePlayersByIds(weeklyPair.oppPlayerIds)
      : undefined;
    const fillEmptyFromLive =
      // Current NFL week, or week still loading (ESPN boxscore holes need live fill).
      nflWeek.data == null || Number(activeWeek) === Number(nflWeek.data);
    const minePlayers =
      myMode === "optimal"
        ? buildOptimalStarterRows(leftTeam, slotLabels, projectFor, {
            pointsMap: weeklyPair.myPlayerPoints,
            progressByNflTeam,
            activeWeek,
            irIds: weeklyPair.myIrIds,
            ...(minePool ? { playerPool: minePool } : {}),
          })
        : buildCurrentStarterRows(
            leftTeam,
            slotLabels,
            weeklyPair.myStarterIds,
            playersById,
            { fillEmptyFromLive },
          );
    const oppPlayers =
      oppMode === "optimal"
        ? buildOptimalStarterRows(oppTeam, slotLabels, projectFor, {
            pointsMap: weeklyPair.oppPlayerPoints,
            progressByNflTeam,
            activeWeek,
            irIds: weeklyPair.oppIrIds,
            ...(oppPool ? { playerPool: oppPool } : {}),
          })
        : buildCurrentStarterRows(
            oppTeam,
            slotLabels,
            weeklyPair.oppStarterIds,
            playersById,
            { fillEmptyFromLive },
          );

    return slotLabels.map((slot, i) => ({
      slot,
      mine: minePlayers[i] ?? null,
      opp: oppPlayers[i] ?? null,
    }));
  }, [
    myMode,
    oppMode,
    leftTeam,
    oppTeam,
    slotLabels,
    projectFor,
    weeklyPair.myStarterIds,
    weeklyPair.oppStarterIds,
    weeklyPair.myPlayerPoints,
    weeklyPair.oppPlayerPoints,
    weeklyPair.myPlayerIds,
    weeklyPair.oppPlayerIds,
    weeklyPair.myIrIds,
    weeklyPair.oppIrIds,
    weeklyPair.hasWeeklyRoster,
    playersById,
    progressByNflTeam,
    activeWeek,
    nflWeek.data,
    resolvePlayersByIds,
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
    const weekBench = (playerIds: string[], starterIds: Set<string>, irIds: string[]) => {
      const irSet = new Set(irIds);
      return resolvePlayersByIds(playerIds.filter((id) => !starterIds.has(id) && !irSet.has(id)));
    };

    let mineBench: Player[];
    let oppBench: Player[];

    if (weeklyPair.hasWeeklyRoster) {
      mineBench = weekBench(weeklyPair.myPlayerIds, starterIdSets.mine, weeklyPair.myIrIds);
      oppBench = weekBench(weeklyPair.oppPlayerIds, starterIdSets.opp, weeklyPair.oppIrIds);
    } else {
      mineBench = (leftTeam?.bench ?? []).filter((p) => !starterIdSets.mine.has(p.id));
      oppBench = (oppTeam?.bench ?? []).filter((p) => !starterIdSets.opp.has(p.id));
    }

    if (myMode === "optimal") {
      const pool = weeklyPair.hasWeeklyRoster
        ? resolvePlayersByIds(weeklyPair.myPlayerIds)
        : (leftTeam?.players ?? []);
      const mineExtra = pool.filter(
        (p) =>
          !starterIdSets.mine.has(p.id) &&
          !weeklyPair.myIrIds.includes(p.id) &&
          !mineBench.some((b) => b.id === p.id),
      );
      mineBench = [...mineBench, ...mineExtra];
    }
    if (oppMode === "optimal") {
      const pool = weeklyPair.hasWeeklyRoster
        ? resolvePlayersByIds(weeklyPair.oppPlayerIds)
        : (oppTeam?.players ?? []);
      const oppExtra = pool.filter(
        (p) =>
          !starterIdSets.opp.has(p.id) &&
          !weeklyPair.oppIrIds.includes(p.id) &&
          !oppBench.some((b) => b.id === p.id),
      );
      oppBench = [...oppBench, ...oppExtra];
    }

    return padPairRows(mineBench, oppBench, "BN");
  }, [
    leftTeam,
    oppTeam,
    starterIdSets,
    myMode,
    oppMode,
    weeklyPair.hasWeeklyRoster,
    weeklyPair.myPlayerIds,
    weeklyPair.oppPlayerIds,
    weeklyPair.myIrIds,
    weeklyPair.oppIrIds,
    resolvePlayersByIds,
  ]);

  const irRows = useMemo(() => {
    // Week-scoped IR ids (live reserve for current week; reconstructed for past).
    if (weeklyPair.hasWeeklyRoster) {
      return padPairRows(
        resolvePlayersByIds(weeklyPair.myIrIds),
        resolvePlayersByIds(weeklyPair.oppIrIds),
        "IR",
      );
    }
    return padPairRows(leftTeam?.ir ?? [], oppTeam?.ir ?? [], "IR");
  }, [
    leftTeam,
    oppTeam,
    weeklyPair.hasWeeklyRoster,
    weeklyPair.myIrIds,
    weeklyPair.oppIrIds,
    resolvePlayersByIds,
  ]);

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
   * True weekly SoS: player_brain positional matchup group only
   * (fantasy points allowed vs this player's position). Schedule catalog
   * supplies opponent abbreviation when brain lacks a row — never DEF output ranks.
   * Stars stay visible for finished weeks when browsing history.
   */
  const weeklySosHitFor = (
    player: Player | null,
  ): { stars: number | null; opp: string | null } => {
    if (!player) return { stars: null, opp: null };

    const team = (player.team || "").trim().toUpperCase();
    const schedHit = team
      ? scheduleSosByTeam.get(team)?.find((m) => Number(m.week) === Number(activeWeek))
      : undefined;
    const progressOpp = (progressFor(player)?.opponentAbbr ?? "").trim().toUpperCase();

    const brainHit = weeklySosMatchupFor(brain, player.id, activeWeek);
    if (
      brainHit &&
      brainHit.rank != null &&
      Number.isFinite(Number(brainHit.rank)) &&
      Number(brainHit.rank) > 0
    ) {
      return {
        stars: sosStarsFromRank(brainHit.rank),
        opp: (brainHit.opp ?? "").trim().toUpperCase() || progressOpp || null,
      };
    }

    const opp =
      (brainHit?.opp ?? "").trim().toUpperCase() ||
      (schedHit?.opp ?? "").trim().toUpperCase() ||
      progressOpp ||
      null;
    const positionalRank =
      schedHit?.rank != null && Number.isFinite(Number(schedHit.rank)) && Number(schedHit.rank) > 0
        ? Number(schedHit.rank)
        : positionalDefenseRank(player.pos, opp);

    return {
      stars: sosStarsFromRank(positionalRank),
      opp,
    };
  };

  const sosStarsFor = (player: Player | null): number | null => weeklySosHitFor(player).stars;

  const sosOpponentFor = (player: Player | null): string | null => weeklySosHitFor(player).opp;

  const projPtsFor = (
    player: Player | null,
    pointsMap: Record<string, number>,
    _opts?: { slot?: string },
  ): number | null => {
    if (!player) return null;

    // Bye / no Sleeper weekly line → "—" (not 0.00, not a season-avg guess).
    if (player.bye != null && Number(player.bye) === Number(activeWeek)) return null;

    // Trust Sleeper weekly projections even when the player still carries Out/IR
    // tags — when Sleeper publishes a number we show it; when they publish "—"
    // projectFor is null and we leave the dash.
    const baseline = projectFor(player.id);
    if (baseline == null) return null;

    const live = Number(pointsMap[player.id] ?? 0) || 0;
    const progress = progressForNflTeam(player.team, progressByNflTeam);
    const phase = progress?.phase ?? "pre";

    // Once the NFL game is final, lock the grey line to the original weekly
    // projection (not the live rolling figure that collapses to actuals).
    if (phase === "post") {
      return Math.round(baseline * 100) / 100;
    }

    if (phase === "pre") {
      return Math.round(baseline * 100) / 100;
    }

    return (
      Math.round(
        playerLiveRollingProjection({
          livePoints: live,
          baselineProjection: baseline,
          progress,
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

    const sumMap = (players: Player[], map: Record<string, number>) =>
      Math.round(
        players.reduce((sum, p) => sum + (Number(map[p.id] ?? 0) || 0), 0) * 100,
      ) / 100;

    const myLive = sumMap(mineStarters, weeklyPair.myPlayerPoints);
    const oppLive = sumMap(oppStarters, weeklyPair.oppPlayerPoints);

    const myProj = computeTeamDisplayProjection({
      starters: mineStarters,
      playerPoints: weeklyPair.myPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: myLive,
      teamBaselineProj: weeklyPair.myBaseline,
    });
    const oppProj = computeTeamDisplayProjection({
      starters: oppStarters,
      playerPoints: weeklyPair.oppPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: oppLive,
      teamBaselineProj: weeklyPair.oppBaseline,
    });
    const { pctA: finalWinPctA, pctB: finalWinPctB } = computeDynamicWinProbability({
      scoreA: myLive,
      scoreB: oppLive,
      startersA: mineStarters,
      startersB: oppStarters,
      pointsMapA: weeklyPair.myPlayerPoints,
      pointsMapB: weeklyPair.oppPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      activeWeek,
    });

    return {
      myProj,
      oppProj,
      finalWinPctA,
      finalWinPctB,
      myWinPct: finalWinPctA,
      oppWinPct: finalWinPctB,
    };
  }, [starterRows, weeklyPair, projectFor, progressByNflTeam, activeWeek]);

  const myName =
    leftTeam?.team?.trim() ||
    matchups?.entries?.find((e) => Number(e.rosterId) === Number(weeklyPair.leftRosterId))
      ?.teamName ||
    "Team";
  const oppName =
    weeklyPair.oppName ||
    oppTeam?.team ||
    (weeklyPair.oppRosterId == null && matchups?.entries?.length ? "Bye week" : "Opponent");

  const recordFor = (rosterId: number | null | undefined, teamName: string): string | null => {
    const rows = standings?.rows ?? [];
    if (!rows.length) return null;
    const byId =
      rosterId != null
        ? rows.find((r) => Number(r.rosterId) === Number(rosterId))
        : undefined;
    const byName = rows.find(
      (r) => (r.team ?? "").trim().toLowerCase() === teamName.trim().toLowerCase(),
    );
    const row = byId ?? byName;
    if (!row) return null;
    const ties = Number(row.ties ?? 0) || 0;
    return ties > 0 ? `${row.wins}-${row.losses}-${ties}` : `${row.wins}-${row.losses}`;
  };

  const myRecord = recordFor(weeklyPair.leftRosterId, myName);
  const oppRecord = recordFor(weeklyPair.oppRosterId, oppName);

  /** When Optimal is on, header live total follows the ideal lineup's actuals. */
  const headerLivePoints = useMemo(() => {
    const sumLive = (
      rows: { mine: Player | null; opp: Player | null }[],
      side: "mine" | "opp",
      pointsMap: Record<string, number>,
    ) => {
      let total = 0;
      for (const row of rows) {
        const player = side === "mine" ? row.mine : row.opp;
        if (!player) continue;
        total += Number(pointsMap[player.id] ?? 0) || 0;
      }
      return Math.round(total * 100) / 100;
    };
    return {
      mine:
        myMode === "optimal"
          ? sumLive(starterRows, "mine", weeklyPair.myPlayerPoints)
          : weeklyPair.myPoints,
      opp:
        oppMode === "optimal"
          ? sumLive(starterRows, "opp", weeklyPair.oppPlayerPoints)
          : weeklyPair.oppPoints,
    };
  }, [
    myMode,
    oppMode,
    starterRows,
    weeklyPair.myPlayerPoints,
    weeklyPair.oppPlayerPoints,
    weeklyPair.myPoints,
    weeklyPair.oppPoints,
  ]);

  /** Original weekly proj totals (not live-collapsed), for the header proj line. */
  const teamOrigProj = useMemo(() => {
    const sumBaselines = (starters: (Player | null)[]) => {
      let total = 0;
      for (const player of starters) {
        if (!player) continue;
        if (player.bye != null && Number(player.bye) === Number(activeWeek)) continue;
        total += projectFor(player.id) ?? weeklyFallback(player);
      }
      return Math.round(total * 100) / 100;
    };
    return {
      mine: sumBaselines(starterRows.map((r) => r.mine)),
      opp: sumBaselines(starterRows.map((r) => r.opp)),
    };
  }, [starterRows, projectFor, activeWeek]);
  const weekStarted = useMemo(() => {
    if (headerLivePoints.mine > 0.005 || headerLivePoints.opp > 0.005) return true;
    for (const row of starterRows) {
      for (const player of [row.mine, row.opp]) {
        if (!player) continue;
        const phase = progressForNflTeam(player.team, progressByNflTeam)?.phase ?? "pre";
        if (phase === "in" || phase === "post") return true;
      }
    }
    return false;
  }, [starterRows, progressByNflTeam, headerLivePoints.mine, headerLivePoints.opp]);

  /** True when every starter's NFL game is final (or bye) — show WON / LOST. */
  const matchupFinal = useMemo(() => {
    const starters = starterRows
      .flatMap((r) => [r.mine, r.opp])
      .filter((p): p is Player => Boolean(p));
    if (!starters.length) return false;
    return starters.every((player) => {
      if (player.bye != null && Number(player.bye) === Number(activeWeek)) return true;
      const phase = progressForNflTeam(player.team, progressByNflTeam)?.phase;
      return phase === "post";
    });
  }, [starterRows, progressByNflTeam, activeWeek]);

  const mineWon = headerLivePoints.mine > headerLivePoints.opp + 0.005;
  const oppWon = headerLivePoints.opp > headerLivePoints.mine + 0.005;
  const matchupTied = matchupFinal && !mineWon && !oppWon;
  const mineLeadsWin = matchupFinal
    ? mineWon || (matchupTied && headerProjections.finalWinPctA >= headerProjections.finalWinPctB)
    : headerProjections.finalWinPctA >= headerProjections.finalWinPctB;

  const mineOutcomeLabel = matchupFinal
    ? matchupTied
      ? "TIE"
      : mineWon
        ? "WON"
        : "LOST"
    : `${headerProjections.finalWinPctA}%`;
  const oppOutcomeLabel = matchupFinal
    ? matchupTied
      ? "TIE"
      : oppWon
        ? "WON"
        : "LOST"
    : `${headerProjections.finalWinPctB}%`;
  const mineOutcomeClass = matchupFinal
    ? matchupTied
      ? "text-slate-500"
      : mineWon
        ? "text-emerald-600"
        : "text-rose-600"
    : mineLeadsWin
      ? "text-emerald-600"
      : "text-rose-600";
  const oppOutcomeClass = matchupFinal
    ? matchupTied
      ? "text-slate-500"
      : oppWon
        ? "text-emerald-600"
        : "text-rose-600"
    : mineLeadsWin
      ? "text-rose-600"
      : "text-emerald-600";

  const replayRequest = useMemo((): MatchupReplayRequest | null => {
    if (!matchupFinal) return null;
    const toStarters = (side: "mine" | "opp") =>
      starterRows
        .map((row) => (side === "mine" ? row.mine : row.opp))
        .filter((p): p is Player => Boolean(p))
        .map((p) => ({
          id: p.id,
          name: p.name,
          pos: p.pos,
          team: p.team,
          projection: projectFor(p.id) ?? weeklyFallback(p),
        }));
    return {
      season: currentSeason(),
      week: activeWeek,
      scoringMap,
      left: {
        name: myName,
        record: myRecord,
        logo: leftTeam?.logo ?? null,
        finalScore: headerLivePoints.mine,
        projectedScore: teamOrigProj.mine,
        starters: toStarters("mine"),
      },
      right: {
        name: oppName,
        record: oppRecord,
        logo: weeklyPair.oppLogo || oppTeam?.logo || null,
        finalScore: headerLivePoints.opp,
        projectedScore: teamOrigProj.opp,
        starters: toStarters("opp"),
      },
    };
  }, [
    matchupFinal,
    starterRows,
    projectFor,
    activeWeek,
    scoringMap,
    myName,
    myRecord,
    leftTeam?.logo,
    headerLivePoints.mine,
    headerLivePoints.opp,
    teamOrigProj.mine,
    teamOrigProj.opp,
    oppName,
    oppRecord,
    weeklyPair.oppLogo,
    oppTeam?.logo,
  ]);

  return (
    <div key={activeLeagueId ?? "none"}>
      <header className="mb-4 flex flex-col gap-3 sm:relative sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:max-w-[36%]">
          <h1 className="display-title text-3xl">Matchup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeLeague?.name?.trim() || "Active league"} weekly head-to-head board.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:absolute sm:left-1/2 sm:top-0 sm:z-10 sm:-translate-x-1/2">
          <MatchupPicker
            options={matchupOptions}
            value={viewMatchupId}
            onChange={setViewMatchupId}
          />
        </div>
        <div className="flex shrink-0 justify-start sm:justify-end">
          <WeekSelector week={activeWeek} onChange={setSelectedWeek} />
        </div>
      </header>

      <section className={playbookCardClass}>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading matchup board…</p>
      ) : (
        <>
          {/* FantasyPros-style header: avatars outward, scores tucked beside vs */}
          <div className="border-b border-border pb-5">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                <TeamLogoAvatar
                  name={myName}
                  logo={leftTeam?.logo ?? null}
                  platform={activeLeague?.platform ?? null}
                  cacheKey={`${activeLeagueId ?? "none"}-left-${weeklyPair.leftRosterId ?? "x"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold leading-tight text-slate-900 sm:text-lg">
                    {myName}
                  </p>
                  {myRecord ? (
                    <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">
                      {myRecord}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                    {headerLivePoints.mine.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xs font-medium tabular-nums",
                      projVsLiveTone(
                        headerLivePoints.mine,
                        teamOrigProj.mine,
                        weekStarted,
                      ),
                    )}
                  >
                    {teamOrigProj.mine.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-center justify-center px-0.5 sm:px-1">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold uppercase text-white">
                  vs
                </span>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                <div className="shrink-0 text-left">
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                    {headerLivePoints.opp.toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xs font-medium tabular-nums",
                      projVsLiveTone(
                        headerLivePoints.opp,
                        teamOrigProj.opp,
                        weekStarted,
                      ),
                    )}
                  >
                    {teamOrigProj.opp.toFixed(2)}
                  </p>
                </div>
                <div className="min-w-0 flex-1 text-right">
                  <p className="truncate text-base font-bold leading-tight text-slate-900 sm:text-lg">
                    {oppName}
                  </p>
                  {oppRecord ? (
                    <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">
                      {oppRecord}
                    </p>
                  ) : null}
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
                {matchupFinal ? "RESULT" : "WIN %"}
              </p>
              <div className="flex w-full items-center gap-3 text-sm font-bold">
                <span
                  className={cn(
                    "w-14 shrink-0 uppercase tracking-wide tabular-nums",
                    mineOutcomeClass,
                  )}
                >
                  {mineOutcomeLabel}
                </span>
                <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1.5">
                  <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        matchupFinal
                          ? mineWon
                            ? "bg-emerald-500"
                            : "bg-transparent"
                          : mineLeadsWin
                            ? "bg-emerald-500"
                            : "bg-rose-500",
                      )}
                      style={{
                        width: `${
                          matchupFinal
                            ? mineWon
                              ? 100
                              : matchupTied
                                ? 50
                                : 0
                            : headerProjections.finalWinPctA
                        }%`,
                      }}
                    />
                  </div>
                  <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        matchupFinal
                          ? oppWon
                            ? "bg-emerald-500"
                            : "bg-transparent"
                          : mineLeadsWin
                            ? "bg-rose-500"
                            : "bg-emerald-500",
                      )}
                      style={{
                        width: `${
                          matchupFinal
                            ? oppWon
                              ? 100
                              : matchupTied
                                ? 50
                                : 0
                            : headerProjections.finalWinPctB
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <span
                  className={cn(
                    "w-14 shrink-0 text-right uppercase tracking-wide tabular-nums",
                    oppOutcomeClass,
                  )}
                >
                  {oppOutcomeLabel}
                </span>
              </div>
            </div>

            {matchupFinal ? (
              <WatchReplayButton onClick={() => setReplayOpen(true)} />
            ) : null}
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
                <p className="mx-auto max-w-shell px-3 py-4 text-center text-sm text-muted-foreground">
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
                      mineProj={projPtsFor(row.mine, weeklyPair.myPlayerPoints, { slot: "IR" })}
                      oppProj={projPtsFor(row.opp, weeklyPair.oppPlayerPoints, { slot: "IR" })}
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
      <MatchupReplayModal
        open={replayOpen}
        onOpenChange={setReplayOpen}
        request={replayRequest}
      />
      </section>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";

import type { HostPlayerMeta, WeeklyMatchupEntry } from "@/lib/league.server";
import { currentSeason, fetchSchedule, type Player, type Pos, type ScheduleGame } from "@/lib/players-build";
import { starterRequirements } from "@/lib/power-rankings";
import { formatNflKickoffLabel, type NflGameProgress } from "@/lib/rolling-live-projection";
import { getCached } from "@/lib/sleeper-cache";
import { cn } from "@/lib/utils";

export const REGULAR_SEASON_WEEKS = 18;
export const HEX_CLIP = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

const SKIP_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const SCHEDULE_CACHE_KEY = "schedule-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const TEAM_ALIASES: Record<string, string[]> = {
  WAS: ["WAS", "WSH"],
  WSH: ["WSH", "WAS"],
  LAR: ["LAR", "LA"],
  LA: ["LA", "LAR"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAX", "JAC"],
};

export type LineupRow = {
  slot: string;
  player: Player | null;
  /** Host-platform headshot used when the Sleeper image is missing. */
  headshot?: string | null;
  /** Unmatched host player name for slots we could not resolve. */
  name?: string | null;
};

const POS_SET = new Set<Pos>(["QB", "RB", "WR", "TE", "K", "DEF"]);

/** Minimal Player for host-platform athletes missing from the Sleeper catalog. */
function hostAsPlayer(id: string, meta: HostPlayerMeta): Player {
  const raw = (meta.pos ?? "").toUpperCase().replace("D/ST", "DEF").replace("DST", "DEF");
  const pos = (POS_SET.has(raw as Pos) ? raw : "WR") as Pos;
  return {
    id,
    name: meta.name,
    team: meta.team ?? "",
    pos,
    age: null,
    exp: null,
    injury_status: null,
    injury: null,
    bye: null,
    adp: { std: 999, half: 999, ppr: 999 },
    adpRange: { min: 999, max: 999 },
    rank: { std: 999, half: 999, ppr: 999 },
    posRank: 999,
    proj: { std: 0, half: 0, ppr: 0 },
    prev: null,
  };
}

/**
 * League-scored points for a lineup player, including host-only athletes.
 * Prefer non-zero host metadata when `playerPoints` stored an explicit 0
 * (common for ESPN D/ST id remaps on past weeks).
 */
export function entryPoints(entry: WeeklyMatchupEntry, playerId: string): number {
  const clean = String(playerId ?? "").trim();
  if (!clean) return 0;
  const fromMap = entry.playerPoints[clean];
  const fromHost = entry.hostPlayers?.[clean]?.points;
  const mapped = fromMap != null && Number.isFinite(Number(fromMap)) ? Number(fromMap) : null;
  const hosted = fromHost != null && Number.isFinite(Number(fromHost)) ? Number(fromHost) : null;
  if (mapped != null && mapped !== 0) return mapped;
  if (hosted != null && hosted !== 0) return hosted;

  // DEF / unmatched ESPN rows: host may key points under `espn:…` while the
  // card resolved a Sleeper team-abbr id (or the reverse).
  const host = entry.hostPlayers ?? {};
  for (const [key, meta] of Object.entries(host)) {
    if (!meta) continue;
    const pts = Number(meta.points);
    if (!Number.isFinite(pts) || pts === 0) continue;
    if (key === clean) return pts;
    const pos = (meta.pos ?? "").toUpperCase();
    if (pos === "DEF" || pos === "DST") {
      const team = (meta.team ?? "").toUpperCase();
      if (team && (team === clean.toUpperCase() || clean.toUpperCase() === team)) return pts;
    }
  }
  return mapped ?? hosted ?? 0;
}

/**
 * Starters / bench / reserve for one matchup side, aligned to the league's
 * starting slots. ESPN athletes missing from the Sleeper catalog fall back to
 * the host's own name, team, position and headshot.
 */
export function resolveEntryLineup(
  entry: WeeklyMatchupEntry,
  labels: string[],
  playersById: Map<string, Player>,
): { starters: LineupRow[]; bench: LineupRow[]; reserve: LineupRow[] } {
  const host = entry.hostPlayers ?? {};
  const resolve = (id: string): Player | null => {
    const known = playersById.get(id);
    if (known) return known;
    const meta = host[id];
    return meta ? hostAsPlayer(id, meta) : null;
  };
  const headshot = (id: string | undefined) => (id ? (host[id]?.headshot ?? null) : null);

  const unmatchedByName = new Map<string, string>();
  for (const [key, meta] of Object.entries(host)) {
    if (key.startsWith("espn:") && meta.slot === "starter") unmatchedByName.set(meta.name.toLowerCase(), key);
  }

  const used = new Set<string>();
  const starters: LineupRow[] = labels.map((slot, i) => {
    let id = entry.starters[i] || "";
    const name = entry.starterNames?.[i] || null;
    if (!id && name) id = unmatchedByName.get(name.toLowerCase()) ?? "";
    const player = id ? resolve(id) : null;
    if (player) used.add(id);
    return { slot, player, headshot: headshot(id), name: player ? null : name };
  });

  const irIds = new Set(entry.irIds);
  for (const [key, meta] of Object.entries(host)) if (meta.slot === "ir") irIds.add(key);

  const benchIds = new Set(entry.playerIds);
  for (const [key, meta] of Object.entries(host)) if (meta.slot === "bench") benchIds.add(key);

  const toRows = (ids: Iterable<string>, slot: string) =>
    [...ids]
      .filter((id) => !used.has(id))
      .map((id) => ({ id, player: resolve(id) }))
      .filter((r): r is { id: string; player: Player } => Boolean(r.player))
      .map((r) => ({ slot, player: r.player, headshot: headshot(r.id) }));

  const reserve = toRows(irIds, "IR");
  for (const row of reserve) used.add(row.player.id);
  const bench = toRows(benchIds, "BN");

  return { starters, bench, reserve };
}

export function slotLabels(rosterPositions: string[]): string[] {
  const labels = rosterPositions
    .map((pos) => String(pos ?? "").trim().toUpperCase())
    .filter((pos) => pos && !SKIP_SLOTS.has(pos))
    .map((pos) =>
      pos === "SUPER_FLEX" || pos === "SUPERFLEX" || pos === "Q/W/R/T"
        ? "SF"
        : pos === "W/R/T" || pos === "WRRBTE"
          ? "FLEX"
          : pos === "DST"
            ? "DEF"
            : pos,
    );
  if (labels.length) return labels;
  const req = starterRequirements([]);
  const out: string[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]) {
    for (let i = 0; i < (req[pos] ?? 0); i += 1) out.push(pos);
  }
  return out;
}

/** Positions a mobile starter slot accepts (aligned with slotLabels). */
function slotEligiblePositions(slot: string): string[] {
  switch (slot.trim().toUpperCase()) {
    case "QB":
    case "RB":
    case "WR":
    case "TE":
    case "K":
      return [slot.trim().toUpperCase()];
    case "DEF":
    case "DST":
      return ["DEF"];
    case "FLEX":
    case "FLX":
    case "W/R/T":
      return ["RB", "WR", "TE"];
    case "WRRB":
    case "W/R":
      return ["RB", "WR"];
    case "WRTE":
    case "W/T":
      return ["WR", "TE"];
    case "SF":
    case "SFLEX":
    case "SUPER_FLEX":
    case "SUPERFLEX":
      return ["QB", "RB", "WR", "TE"];
    default:
      return [];
  }
}

function playerFitsMobileSlot(player: Player, slot: string): boolean {
  const eligible = slotEligiblePositions(slot);
  if (!eligible.length) return false;
  return eligible.includes(player.pos);
}

/**
 * Projected-optimal starters for the week (client-only). Dedicated slots fill
 * before FLEX/SF so leftovers get the best remaining skill pieces.
 */
export function buildProjectedOptimalLineup(
  labels: string[],
  pool: Player[],
  projectFor: (player: Player) => number | null,
): { starters: LineupRow[]; starterIds: Set<string>; total: number } {
  const ranked = pool
    .map((player) => ({
      player,
      value: Math.max(0, Number(projectFor(player)) || 0),
    }))
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name));

  const used = new Set<string>();
  const pick = (slot: string): Player | null => {
    const hit = ranked.find(
      (entry) => !used.has(entry.player.id) && playerFitsMobileSlot(entry.player, slot),
    );
    if (!hit) return null;
    used.add(hit.player.id);
    return hit.player;
  };

  const starters: LineupRow[] = labels.map((slot) => ({ slot, player: null }));
  labels.forEach((slot, i) => {
    if (slot === "FLEX" || slot === "FLX" || slot === "SF" || slot === "SFLEX") return;
    starters[i] = { slot, player: pick(slot) };
  });
  labels.forEach((slot, i) => {
    if (slot !== "FLEX" && slot !== "FLX" && slot !== "SF" && slot !== "SFLEX") return;
    starters[i] = { slot, player: pick(slot) };
  });

  let total = 0;
  for (const row of starters) {
    if (!row.player) continue;
    total += Math.max(0, Number(projectFor(row.player)) || 0);
  }
  return {
    starters,
    starterIds: new Set(
      starters.map((r) => r.player?.id).filter((id): id is string => Boolean(id)),
    ),
    total: Math.round(total * 100) / 100,
  };
}

/** Sum projected points for the given starter rows. */
export function sumLineupProjection(
  rows: LineupRow[],
  projectFor: (player: Player) => number | null,
): number {
  let total = 0;
  for (const row of rows) {
    if (!row.player) continue;
    const p = projectFor(row.player);
    if (p == null || !Number.isFinite(p)) continue;
    total += p;
  }
  return Math.round(total * 100) / 100;
}

export function teamKeys(team: string): string[] {
  const nfl = team.trim().toUpperCase();
  return TEAM_ALIASES[nfl] ?? [nfl];
}

export function progressFor(team: string, progress: Map<string, NflGameProgress>) {
  const nfl = team.trim().toUpperCase();
  if (!nfl || nfl === "FA") return undefined;
  for (const key of teamKeys(nfl)) {
    const hit = progress.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function shortName(player: Player) {
  if (player.pos === "DEF") return player.name.split(" ").at(-1) ?? player.name;
  const [first, ...rest] = player.name.split(" ");
  return rest.length ? `${first?.charAt(0)}. ${rest.join(" ")}` : player.name;
}

const MULTI_LETTER_INJURY = new Set(["IR", "PUP", "SUS", "COV", "NA", "DNR"]);

export function injuryAbbrev(status: string | null | undefined): string | null {
  const s = status?.trim().toUpperCase();
  if (!s) return null;
  return MULTI_LETTER_INJURY.has(s) ? s : s.charAt(0);
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "111.96" rendered as a large whole number with smaller top-aligned decimals. */
export function Score({
  value,
  className,
  decimalsClassName,
}: {
  value: number | null;
  className?: string;
  decimalsClassName?: string;
}) {
  if (value == null) return <span className={className}>-</span>;
  const [whole, decimals] = value.toFixed(2).split(".");
  return (
    <span className={cn("inline-flex items-start tabnum", className, "leading-none")}>
      {whole}
      <span className={cn("mt-[0.1em] text-[0.55em] leading-none", decimalsClassName)}>.{decimals}</span>
    </span>
  );
}

export function useNflSchedule() {
  return useQuery({
    queryKey: ["mobile-nfl-schedule", SCHEDULE_CACHE_KEY],
    staleTime: DAY_MS,
    retry: false,
    queryFn: async (): Promise<ScheduleGame[]> => {
      const payload = await getCached<{ season: string; games: ScheduleGame[] }>(SCHEDULE_CACHE_KEY, DAY_MS, async () => {
        const season = currentSeason();
        return { season, games: await fetchSchedule(season) };
      });
      return payload?.games ?? [];
    },
  });
}

/** "@ NE" / "vs. DET" for a team's game in the given week. */
export function scheduleOpponent(schedule: ScheduleGame[], week: number, team: string): string | null {
  const keys = teamKeys(team);
  const game = schedule.find(
    (g) => g.week === week && (keys.includes(g.home.toUpperCase()) || keys.includes(g.away.toUpperCase())),
  );
  if (!game) return null;
  return keys.includes(game.away.toUpperCase()) ? `@ ${game.home}` : `vs. ${game.away}`;
}

/** Left / right labels for the game strip under a player card. */
export function gameStripLabels(
  progress: NflGameProgress | undefined,
  opts: { bye: boolean; opponent: string | null; team?: string | null },
): {
  game: string;
  status: string;
  /** Player's NFL team currently has possession. */
  hasBall: boolean;
  /** Possession drive is in the red zone. */
  redZone: boolean;
} {
  if (opts.bye) return { game: "BYE", status: "", hasBall: false, redZone: false };
  const teamHasBall =
    progress?.phase === "in" &&
    Boolean(progress.possessionAbbr) &&
    Boolean(opts.team) &&
    teamKeys(opts.team!).includes(progress.possessionAbbr!.toUpperCase());
  const redZone = Boolean(progress?.isRedZone && teamHasBall);
  if (progress?.phase === "post") {
    return { game: progress.boxScoreLabel || "Final", status: "Final", hasBall: false, redZone: false };
  }
  if (progress?.phase === "in") {
    const period = progress.period ?? 1;
    const quarter = period > 4 ? "OT" : `Q${period}`;
    return {
      game: progress.boxScoreLabel || "Live",
      status: `${quarter} ${progress.displayClock ?? ""}`.trim(),
      hasBall: teamHasBall,
      redZone,
    };
  }
  return {
    game: formatNflKickoffLabel(progress?.kickoffIso) || "",
    status: opts.opponent ?? "",
    hasBall: false,
    redZone: false,
  };
}

/** Ruled-out / inactive designations that should always show Sideline. */
export function isRuledOut(status: string | null | undefined): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!s) return false;
  return (
    s === "O" ||
    s === "OUT" ||
    s === "IR" ||
    s === "PUP" ||
    s === "SUS" ||
    s === "SUSPENDED" ||
    s === "NA" ||
    s === "INACTIVE" ||
    s === "DNR" ||
    /^out\b/i.test(String(status))
  );
}

/**
 * Live possession pill. Public ESPN scoreboard cannot tell which skill players
 * are in a given package, so "Possession" means the NFL team has the ball
 * (Sideline otherwise / when ruled out). DEF inverts: active when the offense
 * (opponent) has the ball.
 */
export function possessionPill(
  player: Player,
  progress: NflGameProgress | undefined,
): "possession" | "sideline" | null {
  if (progress?.phase !== "in" || !progress.possessionAbbr) return null;
  if (isRuledOut(player.injury_status ?? player.injury)) return "sideline";
  const hasBall = teamKeys(player.team).includes(progress.possessionAbbr.toUpperCase());
  const active = player.pos === "DEF" ? !hasBall : hasBall;
  return active ? "possession" : "sideline";
}

/** Regulation minutes a player's game has left: 60 before kickoff, 0 once final or on bye. */
export function minutesLeft(progress: NflGameProgress | undefined): number {
  if (!progress) return 0;
  if (progress.phase === "pre") return 60;
  if (progress.phase === "post") return 0;
  return Math.max(0, Math.min(60, progress.minutesRemaining));
}

/** Compact football glyph for possession on the game strip. */
export function FootballIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("inline-block shrink-0", className)}
      fill="currentColor"
    >
      <ellipse cx="8" cy="8" rx="6.5" ry="4.2" transform="rotate(-35 8 8)" />
      <path
        d="M5.2 7.2h5.6M6.1 5.9l1.9 2.2M9.9 5.9L8 8.1M6.1 10.1L8 7.9M9.9 10.1L8 7.9"
        fill="none"
        stroke="var(--m-row-alt, #f6f5f2)"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Football / RZ badges beside the live clock on a player card strip. */
export function PossessionStripBadges({
  hasBall,
  redZone,
}: {
  hasBall: boolean;
  redZone: boolean;
}) {
  if (!hasBall && !redZone) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {hasBall ? <FootballIcon className="size-3 text-m-accent" /> : null}
      {redZone ? (
        <span className="rounded-[3px] bg-orange-500 px-1 py-px text-[8px] font-bold leading-none tracking-wide text-white">
          RZ
        </span>
      ) : null}
    </span>
  );
}

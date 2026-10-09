import { useQuery } from "@tanstack/react-query";

import type { HostPlayerMeta, WeeklyMatchupEntry } from "@/lib/league.server";
import { currentSeason, fetchSchedule, type Player, type Pos, type ScheduleGame } from "@/lib/players-build";
import { starterRequirements } from "@/lib/power-rankings";
import { formatNflKickoffLabel, type NflGameProgress } from "@/lib/rolling-live-projection";
import { getCached } from "@/lib/sleeper-cache";
import { cn } from "@/lib/utils";

export const REGULAR_SEASON_WEEKS = 18;
/** Flat hexagon (home-plate-ish) used for mobile pos-rank chips. */
export const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

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
 *
 * Placement prefers position fit over raw starter-array index so mis-ordered
 * native slot JSON (alphabetical MySQL keys) still paints QB/RB/… correctly.
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

  type Cand = { id: string; player: Player; index: number };
  const candidates: Cand[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < entry.starters.length; i += 1) {
    let id = entry.starters[i] || "";
    const name = entry.starterNames?.[i] || null;
    if (!id && name) id = unmatchedByName.get(name.toLowerCase()) ?? "";
    if (!id || seenIds.has(id)) continue;
    const player = resolve(id);
    if (!player) continue;
    seenIds.add(id);
    candidates.push({ id, player, index: i });
  }

  const used = new Set<string>();
  const takeForSlot = (slot: string, preferIndex: number): Cand | null => {
    const prefer = candidates.find(
      (c) =>
        !used.has(c.id) &&
        c.index === preferIndex &&
        playerFitsMobileSlot(c.player, slot),
    );
    if (prefer) return prefer;
    return (
      candidates.find((c) => !used.has(c.id) && playerFitsMobileSlot(c.player, slot)) ?? null
    );
  };

  const starters: LineupRow[] = labels.map((slot) => ({ slot, player: null }));
  // Dedicated slots first, then flex — same order as optimize.
  labels.forEach((slot, i) => {
    if (slot === "FLEX" || slot === "FLX" || slot === "SF" || slot === "SFLEX") return;
    const hit = takeForSlot(slot, i);
    if (!hit) return;
    used.add(hit.id);
    starters[i] = { slot, player: hit.player, headshot: headshot(hit.id) };
  });
  labels.forEach((slot, i) => {
    if (slot !== "FLEX" && slot !== "FLX" && slot !== "SF" && slot !== "SFLEX") return;
    const hit = takeForSlot(slot, i);
    if (!hit) return;
    used.add(hit.id);
    starters[i] = { slot, player: hit.player, headshot: headshot(hit.id) };
  });
  // Last resort: keep index alignment for unresolved host names / unknown pos.
  labels.forEach((slot, i) => {
    if (starters[i]?.player) return;
    const hit = candidates.find((c) => !used.has(c.id) && c.index === i);
    if (!hit) return;
    used.add(hit.id);
    starters[i] = { slot, player: hit.player, headshot: headshot(hit.id) };
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

export type OptimalLineupOptions = {
  /**
   * Per starter-slot index: keep this player locked in place (game started).
   * Null/undefined means the slot may be filled by optimize.
   */
  pinnedStarters?: Array<Player | null | undefined>;
  /** Player ids that cannot move (locked on bench/IR or already pinned). */
  immovableIds?: ReadonlySet<string>;
};

/**
 * Projected-optimal starters for the week (client-only). Dedicated slots fill
 * before FLEX/SF so leftovers get the best remaining skill pieces.
 * Locked (immovable) players stay put and are never promoted from bench.
 */
export function buildProjectedOptimalLineup(
  labels: string[],
  pool: Player[],
  projectFor: (player: Player) => number | null,
  options?: OptimalLineupOptions,
): { starters: LineupRow[]; starterIds: Set<string>; total: number } {
  const pinned = options?.pinnedStarters ?? [];
  const immovable = options?.immovableIds ?? new Set<string>();

  const used = new Set<string>();
  const starters: LineupRow[] = labels.map((slot, i) => {
    const pinnedPlayer = pinned[i] ?? null;
    if (pinnedPlayer) {
      used.add(pinnedPlayer.id);
      return { slot, player: pinnedPlayer };
    }
    return { slot, player: null };
  });

  const ranked = pool
    .filter((player) => !immovable.has(player.id) && !used.has(player.id))
    .map((player) => ({
      player,
      value: Math.max(0, Number(projectFor(player)) || 0),
    }))
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name));

  const pick = (slot: string): Player | null => {
    const hit = ranked.find(
      (entry) => !used.has(entry.player.id) && playerFitsMobileSlot(entry.player, slot),
    );
    if (!hit) return null;
    used.add(hit.player.id);
    return hit.player;
  };

  labels.forEach((slot, i) => {
    if (starters[i]?.player) return;
    if (slot === "FLEX" || slot === "FLX" || slot === "SF" || slot === "SFLEX") return;
    starters[i] = { slot, player: pick(slot) };
  });
  labels.forEach((slot, i) => {
    if (starters[i]?.player) return;
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

/** Aggregate starter NFL phases into a fantasy matchup clock state. */
export type MatchupClockStatus = "pre" | "live" | "final";

export function matchupClockStatus(
  starters: Array<Player | null | undefined>,
  progressByNflTeam: Map<string, NflGameProgress>,
  week: number,
): MatchupClockStatus {
  let sawPre = false;
  let sawIn = false;
  let sawPost = false;
  for (const player of starters) {
    if (!player) continue;
    if (player.bye != null && Number(player.bye) === Number(week)) continue;
    const phase = progressFor(player.team, progressByNflTeam)?.phase ?? "pre";
    if (phase === "in") sawIn = true;
    else if (phase === "post") sawPost = true;
    else sawPre = true;
  }
  if (sawIn || (sawPost && sawPre)) return "live";
  if (sawPost && !sawPre) return "final";
  return "pre";
}

/** Result for the viewing manager after a completed matchup. */
export type MatchupViewerResult = "won" | "lost" | "tied";

export function matchupViewerResult(myPoints: number, oppPoints: number): MatchupViewerResult {
  if (Math.abs(myPoints - oppPoints) < 0.005) return "tied";
  return myPoints > oppPoints ? "won" : "lost";
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

/** Parse `@ LAR` / `vs. BAL` into home/away prefix + opponent abbr. */
export function parseOpponentLabel(label: string | null | undefined): {
  prefix: "@" | "vs.";
  abbr: string;
} | null {
  const raw = String(label ?? "").trim();
  if (!raw) return null;
  const away = /^@\s*/i.test(raw);
  const abbr = raw.replace(/^(vs\.?|@)\s*/i, "").trim().toUpperCase();
  if (!abbr) return null;
  return { prefix: away ? "@" : "vs.", abbr };
}

/**
 * Sleeper-style mid strip: `@ HOU #19 vs RB` (opponent + defense rank vs player pos).
 */
export function matchupDefenseLabel(opts: {
  opponentLabel: string | null | undefined;
  pos: string | null | undefined;
  defenseRank: number | null | undefined;
}): string | null {
  const parts = matchupDefenseParts(opts);
  if (!parts) return null;
  return parts.rank != null
    ? `${parts.prefix} ${parts.abbr} #${parts.rank} vs ${parts.pos}`
    : `${parts.prefix} ${parts.abbr}${parts.pos ? ` vs ${parts.pos}` : ""}`;
}

export type MatchupDefenseParts = {
  prefix: "@" | "vs.";
  abbr: string;
  pos: string;
  rank: number | null;
};

export function matchupDefenseParts(opts: {
  opponentLabel: string | null | undefined;
  pos: string | null | undefined;
  defenseRank: number | null | undefined;
}): MatchupDefenseParts | null {
  const parsed = parseOpponentLabel(opts.opponentLabel);
  if (!parsed) return null;
  const pos = (opts.pos || "").toUpperCase() === "DEF" ? "DST" : (opts.pos || "").toUpperCase();
  const rank =
    opts.defenseRank != null && Number.isFinite(opts.defenseRank) && opts.defenseRank > 0
      ? Math.round(opts.defenseRank)
      : null;
  return { prefix: parsed.prefix, abbr: parsed.abbr, pos, rank };
}

/** Tough (low #) = red, soft (high #) = green, mid = black — Sleeper-style. */
export function matchupDefenseTone(rank: number | null | undefined): "tough" | "soft" | "neutral" {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return "neutral";
  if (rank <= 10) return "tough";
  if (rank >= 23) return "soft";
  return "neutral";
}

export function matchupDefenseToneClass(rank: number | null | undefined): string {
  const tone = matchupDefenseTone(rank);
  if (tone === "tough") return "text-red-600";
  if (tone === "soft") return "text-emerald-600";
  return "text-m-card-fg";
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
 * Live unit pill for mobile cards. Public ESPN scoreboard cannot tell which
 * skill players are in a given package, so we label the relevant *team unit*:
 * - Offense — player's NFL team has the ball (skill / K)
 * - Defense — opponent has the ball (DST only)
 * - Sideline — the other unit is out, or the player is ruled out
 * Football icon on the strip still means "this NFL team has the ball."
 */
export type LiveUnitPill = "offense" | "defense" | "sideline";

export function possessionPill(
  player: Player,
  progress: NflGameProgress | undefined,
): LiveUnitPill | null {
  if (progress?.phase !== "in" || !progress.possessionAbbr) return null;
  if (isRuledOut(player.injury_status ?? player.injury)) return "sideline";
  const hasBall = teamKeys(player.team).includes(progress.possessionAbbr.toUpperCase());
  if (player.pos === "DEF") return hasBall ? "sideline" : "defense";
  return hasBall ? "offense" : "sideline";
}

export function liveUnitPillLabel(status: LiveUnitPill): string {
  if (status === "offense") return "Offense";
  if (status === "defense") return "Defense";
  return "Sideline";
}

/** Regulation minutes a player's game has left: 60 before kickoff, 0 once final or on bye. */
export function minutesLeft(progress: NflGameProgress | undefined): number {
  if (!progress) return 0;
  if (progress.phase === "pre") return 60;
  if (progress.phase === "post") return 0;
  return Math.max(0, Math.min(60, progress.minutesRemaining));
}

/**
 * Compact American-football glyph for the live game strip.
 * Clean black horizontal silhouette + white lace ticks (reads at ~14px).
 */
export function FootballIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 10"
      aria-hidden
      className={cn("inline-block shrink-0", className)}
    >
      {/* Pointed horizontal football */}
      <path
        fill="currentColor"
        d="M1 5C1 5 3.2 1.15 8 1.15S15 5 15 5 12.8 8.85 8 8.85 1 5 1 5Z"
      />
      {/* Seam + two lace ticks (white on black fill) */}
      <path
        d="M5.4 5h5.2M7.15 3.85v2.3M8.85 3.85v2.3"
        fill="none"
        stroke="#fff"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Football / RZ beside the live clock.
 * Football = the fantasy unit is the one currently on the field
 * (offense for skill/K, defense for DST).
 */
export function PossessionStripBadges({
  hasBall,
  redZone,
}: {
  hasBall: boolean;
  redZone: boolean;
}) {
  if (!hasBall && !redZone) return null;
  return (
    <span className="inline-flex items-center gap-1" title={hasBall ? "Unit on the field" : undefined}>
      {hasBall ? <FootballIcon className="h-2.5 w-3.5 text-m-card-fg" /> : null}
      {redZone ? (
        <span className="rounded-[3px] bg-orange-500 px-1 py-px text-[8px] font-bold leading-none tracking-wide text-white">
          RZ
        </span>
      ) : null}
    </span>
  );
}

/**
 * Football next to the quarter when this fantasy unit is relevant:
 * - Skill / K: NFL team has the ball (offense)
 * - DST: opponent has the ball (defense on the field) — not while Sideline
 */
export function stripShowsFootball(
  player: Pick<Player, "team" | "pos" | "injury_status" | "injury">,
  progress: NflGameProgress | undefined,
): boolean {
  if (progress?.phase !== "in" || !progress.possessionAbbr) return false;
  if (isRuledOut(player.injury_status ?? player.injury)) return false;
  const teamHasBall = teamKeys(player.team).includes(progress.possessionAbbr.toUpperCase());
  // DST inverts: football while defense is out, not while own offense has it.
  return player.pos === "DEF" ? !teamHasBall : teamHasBall;
}

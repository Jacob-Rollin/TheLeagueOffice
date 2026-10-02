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

/** League-scored points for a lineup player, including host-only athletes. */
export function entryPoints(entry: WeeklyMatchupEntry, playerId: string): number {
  return Number(entry.playerPoints[playerId] ?? entry.hostPlayers?.[playerId]?.points ?? 0) || 0;
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
  opts: { bye: boolean; opponent: string | null },
): { game: string; status: string } {
  if (opts.bye) return { game: "BYE", status: "" };
  if (progress?.phase === "post") return { game: progress.boxScoreLabel || "Final", status: "Final" };
  if (progress?.phase === "in") {
    const period = progress.period ?? 1;
    const quarter = period > 4 ? "OT" : `Q${period}`;
    return {
      game: progress.boxScoreLabel || "Live",
      status: `${quarter} ${progress.displayClock ?? ""}`.trim(),
    };
  }
  return { game: formatNflKickoffLabel(progress?.kickoffIso) || "", status: opts.opponent ?? "" };
}

/** Regulation minutes a player's game has left: 60 before kickoff, 0 once final or on bye. */
export function minutesLeft(progress: NflGameProgress | undefined): number {
  if (!progress) return 0;
  if (progress.phase === "pre") return 60;
  if (progress.phase === "post") return 0;
  return Math.max(0, Math.min(60, progress.minutesRemaining));
}

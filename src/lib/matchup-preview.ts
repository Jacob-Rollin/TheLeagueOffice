import type { ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import type { Player } from "@/lib/draft";
import { starterRequirements } from "@/lib/power-rankings";
import { computeDynamicWinProbability, type NflGameProgress } from "@/lib/rolling-live-projection";

/** Match Matchup page: never invent a weekly proj when Sleeper has none. */
export const matchupWeeklyFallback = (_p: Player) => 0;

const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);

function normalizeStarterSlot(pos: string): string {
  const value = pos.trim().toUpperCase();
  if (value === "SUPER_FLEX" || value === "SUPERFLEX" || value === "Q/W/R/T") return "FLEX";
  if (value === "W/R/T" || value === "WRRBTE") return "FLEX";
  return value;
}

export function matchupSlotLabels(rosterPositions: string[]): string[] {
  const labels = rosterPositions
    .map((pos) => normalizeStarterSlot(String(pos ?? "")))
    .filter((pos) => pos && !SKIP_STARTER_SLOTS.has(pos));
  if (labels.length) return labels;
  const req = starterRequirements([]);
  const out: string[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]) {
    for (let i = 0; i < (req[pos] ?? 0); i += 1) out.push(pos);
  }
  return out;
}

function playerFitsSlot(player: Player, slot: string): boolean {
  if (slot === "FLEX" || slot === "FLX") return FLEX_OK.has(player.pos);
  if (slot === "DEF" || slot === "DST") return player.pos === "DEF";
  return player.pos === slot;
}

function playerNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Same slot-aligned starter resolution as the Matchup page. Slots the manager
 * left empty stay empty (never back-filled from the bench or other slots).
 */
export function resolveMatchupStarters(
  team: ResolvedRosterTeam | null,
  labels: string[],
  starterIds: string[],
  playersById: Map<string, Player>,
  starterNames: string[] = [],
): Player[] {
  if (!team) return [];

  const used = new Set<string>();
  const takeLiveForSlot = (slot: string, index: number): Player | null => {
    const atIndex = team.starters[index] ?? null;
    if (atIndex && !used.has(atIndex.id) && playerFitsSlot(atIndex, slot)) {
      used.add(atIndex.id);
      return atIndex;
    }
    for (const candidate of team.starters) {
      if (!candidate || used.has(candidate.id)) continue;
      if (!playerFitsSlot(candidate, slot)) continue;
      used.add(candidate.id);
      return candidate;
    }
    return null;
  };

  if (!starterIds.length) {
    return team.starters.filter((p): p is Player => Boolean(p));
  }

  // Claim every resolvable starter first so a fallback never duplicates one.
  for (const id of starterIds) {
    const hit = id ? playersById.get(id) : undefined;
    if (hit) used.add(hit.id);
  }
  const rows = labels.map((slot, i): Player | null => {
    const id = starterIds[i];
    if (id) return playersById.get(id) ?? takeLiveForSlot(slot, i);
    const unmatchedName = starterNames[i]?.trim();
    if (!unmatchedName) return null;
    const key = playerNameKey(unmatchedName);
    const byName = team.players.find((p) => !used.has(p.id) && playerNameKey(p.name) === key) ?? null;
    if (byName) {
      used.add(byName.id);
      return byName;
    }
    return takeLiveForSlot(slot, i);
  });

  return rows.filter((p): p is Player => Boolean(p));
}

function nflAliases(team: string | null | undefined): string[] {
  const nfl = (team || "").trim().toUpperCase();
  if (nfl === "WAS" || nfl === "WSH") return ["WAS", "WSH"];
  if (nfl === "LAR" || nfl === "LA") return ["LAR", "LA"];
  if (nfl === "JAC" || nfl === "JAX") return ["JAC", "JAX"];
  return [nfl];
}

export type MatchupSide = {
  team: ResolvedRosterTeam | null;
  points: number;
  starterIds: string[];
  starterNames: string[];
  playerPoints: Record<string, number>;
};

export type MatchupPreview = {
  myOrigProj: number;
  oppOrigProj: number;
  myWinPct: number;
  oppWinPct: number;
  weekStarted: boolean;
  matchupFinal: boolean;
  mineStarters: Player[];
  oppStarters: Player[];
};

/** Matchup preview totals + live win % — same Sleeper starter math as /playbook/matchup. */
export function computeMatchupPreview(opts: {
  mine: MatchupSide;
  opp: MatchupSide;
  rosterPositions: string[];
  playersById: Map<string, Player>;
  projectFor: (id: string) => number | null;
  progressByNflTeam: Map<string, NflGameProgress>;
  activeWeek: number;
}): MatchupPreview {
  const { mine, opp, playersById, projectFor, progressByNflTeam, activeWeek } = opts;
  const labels = matchupSlotLabels(opts.rosterPositions);
  const mineStarters = resolveMatchupStarters(mine.team, labels, mine.starterIds, playersById, mine.starterNames);
  const oppStarters = resolveMatchupStarters(opp.team, labels, opp.starterIds, playersById, opp.starterNames);
  const onBye = (player: Player) => player.bye != null && Number(player.bye) === Number(activeWeek);

  const sumOrigProj = (starters: Player[]) => {
    let total = 0;
    for (const player of starters) {
      if (onBye(player)) continue;
      total += projectFor(player.id) ?? matchupWeeklyFallback(player);
    }
    return Math.round(total * 100) / 100;
  };

  const { pctA: myWinPct, pctB: oppWinPct } = computeDynamicWinProbability({
    scoreA: mine.points,
    scoreB: opp.points,
    startersA: mineStarters,
    startersB: oppStarters,
    pointsMapA: mine.playerPoints,
    pointsMapB: opp.playerPoints,
    projectFor,
    weeklyFallback: matchupWeeklyFallback,
    progressByNflTeam,
    activeWeek,
  });

  const allStarters = [...mineStarters, ...oppStarters];
  const phaseOf = (player: Player) => nflAliases(player.team).map((key) => progressByNflTeam.get(key)?.phase);
  const weekStarted =
    mine.points > 0.005 ||
    opp.points > 0.005 ||
    allStarters.some((player) => phaseOf(player).some((p) => p === "in" || p === "post"));
  const matchupFinal =
    allStarters.length > 0 && allStarters.every((player) => onBye(player) || phaseOf(player).includes("post"));

  return {
    myOrigProj: sumOrigProj(mineStarters),
    oppOrigProj: sumOrigProj(oppStarters),
    myWinPct,
    oppWinPct,
    weekStarted,
    matchupFinal,
    mineStarters,
    oppStarters,
  };
}

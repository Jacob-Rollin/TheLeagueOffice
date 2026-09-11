export type SosMatchup = {
  week: number;
  opp: string;
  rank: number | null;
  pointsAllowed: number | null;
};

export type PlayerSos = {
  rank: number | null;
  matchups: SosMatchup[];
};

export type SosGrade = "CAKEWALK" | "ADVANTAGEOUS" | "NEUTRAL" | "CATASTROPHIC";

export function matchupGrade(rank: number | null): SosGrade {
  if (rank === null) return "NEUTRAL";
  if (rank >= 25) return "CAKEWALK";
  if (rank >= 18) return "ADVANTAGEOUS";
  if (rank >= 11) return "NEUTRAL";
  return "CATASTROPHIC";
}

function averageRank(matchups: SosMatchup[], from: number, to: number): number | null {
  const ranks = matchups
    .filter((matchup) => matchup.week >= from && matchup.week <= to)
    .map((matchup) => matchup.rank)
    .filter((rank): rank is number => rank !== null);
  return ranks.length > 0 ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
}

export function strategicOutlook(sos: PlayerSos): string {
  const playoffRank = averageRank(sos.matchups, 15, 17);
  const earlyRank = averageRank(sos.matchups, 1, 6);
  const scheduledWeeks = new Set(sos.matchups.map((matchup) => matchup.week));
  const byeWeek = Array.from({ length: 14 }, (_, index) => index + 5).find(
    (week) => !scheduledWeeks.has(week),
  );

  if (playoffRank !== null && playoffRank >= 23) return "Top-10 Friendly Playoff Window";
  if (earlyRank !== null && earlyRank <= 10) return "Brutal Early Season Gauntlet";

  if (byeWeek !== undefined) {
    const adjacent = sos.matchups.filter(
      (matchup) => Math.abs(matchup.week - byeWeek) === 1 && matchup.rank !== null,
    );
    if (adjacent.some((matchup) => (matchup.rank ?? 0) >= 23)) {
      return "Highly Favorable Bye-Week Matchup Script";
    }
  }

  const easiest = [...sos.matchups]
    .filter((matchup) => matchup.rank !== null)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
  const hardest = [...sos.matchups]
    .filter((matchup) => matchup.rank !== null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];

  if (easiest && easiest.week >= 10) return "Late-Season Matchups Trend Favorably";
  if (hardest && hardest.week <= 6) return "Early Schedule Demands Caution";
  if ((sos.rank ?? 16) >= 18) return "Steady Run of Favorable Matchups";
  if ((sos.rank ?? 16) <= 10) return "Limited Margin Against Tough Defenses";
  return "Balanced Matchup Path Across the Season";
}

export function matchupTone(rank: number | null): string {
  if (rank !== null && rank <= 10) {
    return "bg-rose-500/[0.02] border-rose-500/20 text-rose-600";
  }
  if (rank !== null && rank >= 23) {
    return "bg-emerald-500/[0.02] border-emerald-500/20 text-emerald-600";
  }
  return "bg-transparent border-border/60 text-foreground";
}
/** Season-long burden score: higher = more favorable schedule. */
export function scheduleBurden(sos: PlayerSos | null | undefined): number | null {
  if (!sos || sos.matchups.length === 0) return null;
  const pts = sos.matchups.map((m) => m.pointsAllowed).filter((v): v is number => v !== null);
  if (pts.length > 0) return pts.reduce((sum, v) => sum + v, 0) / pts.length;
  const ranks = sos.matchups.map((m) => m.rank).filter((v): v is number => v !== null);
  if (ranks.length === 0) return null;
  return ranks.reduce((sum, v) => sum + v, 0) / ranks.length;
}

type SosPeer = { position: string; sos: PlayerSos | null };

/**
 * Slide-scale placement of one player's full-schedule burden against every
 * active player sharing the same position in the local brain matrix.
 */
export function positionPercentile(
  playerId: string,
  position: string,
  matrix: Record<string, SosPeer> | null | undefined,
  fallbackSos?: PlayerSos | null,
): string | null {
  const own = scheduleBurden(matrix?.[playerId]?.sos ?? fallbackSos ?? null);
  if (own === null) return null;
  const peers: number[] = [];
  for (const entry of Object.values(matrix ?? {})) {
    if (entry.position !== position) continue;
    const score = scheduleBurden(entry.sos);
    if (score !== null) peers.push(score);
  }
  if (peers.length < 5) return null;
  const easier = peers.filter((p) => p > own).length;
  const topFavorable = Math.max(1, Math.round(((easier + 1) / peers.length) * 100));
  const harder = peers.filter((p) => p < own).length;
  const topChallenging = Math.max(1, Math.round(((harder + 1) / peers.length) * 100));
  if (topFavorable <= 33) return `Position percentile: Top ${topFavorable}% most favorable schedules`;
  if (topChallenging <= 33) return `Position percentile: Top ${topChallenging}% most challenging schedules`;
  return "Position percentile: Near baseline position average";
}

/** Weeks 14-17 look-ahead label. */
export function playoffWindow(sos: PlayerSos | null | undefined): "Elite" | "Balanced" | "Challenging" {
  const ranks = (sos?.matchups ?? [])
    .filter((m) => m.week >= 14 && m.week <= 17)
    .map((m) => m.rank)
    .filter((r): r is number => r !== null);
  if (ranks.length === 0) return "Balanced";
  const avg = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
  if (avg >= 21) return "Elite";
  if (avg <= 11) return "Challenging";
  return "Balanced";
}

/**
 * Compact weekly SoS label from a single-week defensive rank
 * (1 = toughest matchup, 32 = softest). Matches popup-style percentile wording.
 */
export function weeklyMatchupLabel(rank: number | null | undefined): string | null {
  if (rank == null || !Number.isFinite(rank)) return null;
  const n = 32;
  const clamped = Math.max(1, Math.min(n, Math.round(rank)));
  const favorablePct = Math.max(1, Math.round(((n - clamped + 1) / n) * 100));
  const toughPct = Math.max(1, Math.round((clamped / n) * 100));
  if (clamped >= 22 || favorablePct <= 33) return `Top ${favorablePct}% matchup`;
  if (clamped <= 11 || toughPct <= 33) return `Top ${toughPct}% toughest matchup`;
  return "Average matchup";
}

/**
 * Map a weekly defensive SoS rank (1 = toughest, 32 = softest) to 1–5 gold stars.
 */
export function sosStarsFromRank(rank: number | null | undefined): number | null {
  if (rank == null || !Number.isFinite(rank)) return null;
  if (rank >= 25) return 5;
  if (rank >= 18) return 4;
  if (rank >= 11) return 3;
  if (rank >= 5) return 2;
  return 1;
}

/** Look up the weekly SoS rank for a player from the brain matrix. */
export function weeklySosRankFor(
  brain: Record<string, { sos: PlayerSos | null }> | null | undefined,
  playerId: string,
  week: number,
): number | null {
  return weeklySosMatchupFor(brain, playerId, week)?.rank ?? null;
}

/** Full weekly SoS row (opponent + defensive rank) from the brain matrix. */
export function weeklySosMatchupFor(
  brain: Record<string, { sos: PlayerSos | null }> | null | undefined,
  playerId: string,
  week: number,
): SosMatchup | null {
  const matchups = brain?.[playerId]?.sos?.matchups;
  if (!matchups?.length) return null;
  const w = Number(week);
  if (!Number.isFinite(w)) return null;
  return matchups.find((m) => Number(m.week) === w) ?? null;
}

export type WeekSlot = { week: number; matchup: SosMatchup | null };

/** Continuous week 1-18 sequence with bye placeholders for skipped weeks. */
export function weekSlots(matchups: SosMatchup[]): WeekSlot[] {
  const byWeek = new Map(matchups.map((m) => [m.week, m]));
  return Array.from({ length: 18 }, (_, i) => ({ week: i + 1, matchup: byWeek.get(i + 1) ?? null }));
}

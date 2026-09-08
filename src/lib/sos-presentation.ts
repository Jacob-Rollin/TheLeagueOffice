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
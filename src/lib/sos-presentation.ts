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
  const playoffRank = averageRank(sos.matchups, 14, 17);
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
/** Season-long burden score: higher = more favorable schedule (softer defenses). */
export function scheduleBurden(sos: PlayerSos | null | undefined): number | null {
  if (!sos || sos.matchups.length === 0) return null;
  // Prefer average weekly positional FPA rank (1 = toughest, 32 = softest) so
  // Overall, percentile, and stars share one positional scale.
  const ranks = sos.matchups.map((m) => m.rank).filter((v): v is number => v !== null);
  if (ranks.length > 0) return ranks.reduce((sum, v) => sum + v, 0) / ranks.length;
  const pts = sos.matchups.map((m) => m.pointsAllowed).filter((v): v is number => v !== null);
  if (pts.length === 0) return null;
  return pts.reduce((sum, v) => sum + v, 0) / pts.length;
}

type SosPeer = { position: string; sos: PlayerSos | null };

function normalizePos(position: string | null | undefined): string {
  const p = (position || "").toUpperCase();
  return p === "DST" ? "DEF" : p;
}

/** Collect same-position schedule burdens from the peer matrix. */
function samePositionBurdens(
  position: string,
  matrix: Record<string, SosPeer> | null | undefined,
): number[] {
  const pos = normalizePos(position);
  const peers: number[] = [];
  for (const entry of Object.values(matrix ?? {})) {
    if (normalizePos(entry.position) !== pos) continue;
    const score = scheduleBurden(entry.sos);
    if (score !== null) peers.push(score);
  }
  return peers;
}

export type PositionalSosStanding = {
  /** Overall grade vs same-position peers (not absolute 1–32 cutoffs). */
  grade: SosGrade;
  textClass: string;
  /** Compact middle-card label, e.g. "TOP 7%". */
  percentileLabel: string;
  percentileTone: "challenging" | "favorable" | "baseline";
  /** Caption under the percentile, e.g. "Most Challenging Schedule". */
  percentileCaption: string;
  topFavorablePct: number | null;
  topChallengingPct: number | null;
};

/**
 * Full positional SOS standing: overall grade + percentile share one same-position
 * peer comparison (fantasy points allowed / ranks vs that position only).
 */
export function positionalSosStanding(
  playerId: string,
  position: string,
  matrix: Record<string, SosPeer> | null | undefined,
  fallbackSos?: PlayerSos | null,
): PositionalSosStanding {
  const ownSos = matrix?.[playerId]?.sos ?? fallbackSos ?? null;
  const own = scheduleBurden(ownSos);
  const peers = samePositionBurdens(position, matrix);

  // Not enough same-position peers → fall back to absolute positional-rank grade.
  if (own === null || peers.length < 5) {
    const grade = matchupGrade(ownSos?.rank ?? (own != null ? Math.round(own) : null));
    return {
      grade,
      textClass: overallMatchupGradeClass(grade),
      percentileLabel: "BASELINE",
      percentileTone: "baseline",
      percentileCaption: "Near Baseline Average",
      topFavorablePct: null,
      topChallengingPct: null,
    };
  }

  const easier = peers.filter((p) => p > own).length;
  const harder = peers.filter((p) => p < own).length;
  const topFavorable = Math.max(1, Math.round(((easier + 1) / peers.length) * 100));
  const topChallenging = Math.max(1, Math.round(((harder + 1) / peers.length) * 100));

  // Grade from same-position standing so Overall never says NEUTRAL while
  // the percentile reads Top N% most challenging (or favorable).
  let grade: SosGrade;
  if (topFavorable <= 20) grade = "CAKEWALK";
  else if (topFavorable <= 40) grade = "ADVANTAGEOUS";
  else if (topChallenging <= 25) grade = "CATASTROPHIC";
  else grade = "NEUTRAL";

  let percentileTone: PositionalSosStanding["percentileTone"] = "baseline";
  let percentileLabel = "BASELINE";
  let percentileCaption = "Near Baseline Average";
  if (topFavorable <= 33) {
    percentileTone = "favorable";
    percentileLabel = `TOP ${topFavorable}%`;
    percentileCaption = "Most Favorable Schedule";
  } else if (topChallenging <= 33) {
    percentileTone = "challenging";
    percentileLabel = `TOP ${topChallenging}%`;
    percentileCaption = "Most Challenging Schedule";
  }

  return {
    grade,
    textClass: overallMatchupGradeClass(grade),
    percentileLabel,
    percentileTone,
    percentileCaption,
    topFavorablePct: topFavorable,
    topChallengingPct: topChallenging,
  };
}

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
  const standing = positionalSosStanding(playerId, position, matrix, fallbackSos);
  if (standing.topFavorablePct == null && standing.topChallengingPct == null) {
    // Absolute fallback path — still emit a readable line when peers are thin.
    if (standing.percentileTone === "baseline" && !matrix) return null;
  }
  if (standing.percentileTone === "favorable" && standing.topFavorablePct != null) {
    return `Position percentile: Top ${standing.topFavorablePct}% most favorable schedules`;
  }
  if (standing.percentileTone === "challenging" && standing.topChallengingPct != null) {
    return `Position percentile: Top ${standing.topChallengingPct}% most challenging schedules`;
  }
  return "Position percentile: Near baseline position average";
}

/**
 * Playoff-window label from weeks 14–17 positional ranks.
 * When peers are supplied, grades relative to same-position playoff windows.
 */
export function playoffWindow(
  sos: PlayerSos | null | undefined,
  position?: string | null,
  matrix?: Record<string, SosPeer> | null,
): "Elite" | "Balanced" | "Challenging" {
  const ownRanks = (sos?.matchups ?? [])
    .filter((m) => m.week >= 14 && m.week <= 17)
    .map((m) => m.rank)
    .filter((r): r is number => r !== null);
  if (ownRanks.length === 0) return "Balanced";
  const ownAvg = ownRanks.reduce((sum, r) => sum + r, 0) / ownRanks.length;

  const pos = normalizePos(position);
  if (pos && matrix) {
    const peerAvgs: number[] = [];
    for (const entry of Object.values(matrix)) {
      if (normalizePos(entry.position) !== pos) continue;
      const ranks = (entry.sos?.matchups ?? [])
        .filter((m) => m.week >= 14 && m.week <= 17)
        .map((m) => m.rank)
        .filter((r): r is number => r !== null);
      if (ranks.length === 0) continue;
      peerAvgs.push(ranks.reduce((sum, r) => sum + r, 0) / ranks.length);
    }
    if (peerAvgs.length >= 5) {
      const easier = peerAvgs.filter((p) => p > ownAvg).length;
      const harder = peerAvgs.filter((p) => p < ownAvg).length;
      const topFavorable = Math.max(1, Math.round(((easier + 1) / peerAvgs.length) * 100));
      const topChallenging = Math.max(1, Math.round(((harder + 1) / peerAvgs.length) * 100));
      if (topFavorable <= 33) return "Elite";
      if (topChallenging <= 33) return "Challenging";
      return "Balanced";
    }
  }

  if (ownAvg >= 21) return "Elite";
  if (ownAvg <= 11) return "Challenging";
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

export type SosDifficultyTone = "elite" | "good" | "neutral" | "bad" | "tough" | "bye";

/**
 * Shared difficulty chip for SOS table, Outlook, matchup stars, and sidebar.
 * Stars come from {@link sosStarsFromRank} (positional FPA ranks).
 * 5★ GREAT · 4★ GOOD · 3★ NEUTRAL · 2★ BAD · 1★ TOUGH
 */
export function sosDifficultyFromStars(stars: number | null | undefined): {
  tone: SosDifficultyTone;
  label: string | null;
} {
  if (stars == null || !Number.isFinite(stars)) return { tone: "bye", label: null };
  const n = Math.round(Number(stars));
  if (n >= 5) return { tone: "elite", label: "GREAT" };
  if (n >= 4) return { tone: "good", label: "GOOD" };
  if (n >= 3) return { tone: "neutral", label: "NEUTRAL" };
  if (n >= 2) return { tone: "bad", label: "BAD" };
  return { tone: "tough", label: "TOUGH" };
}

/** Chip background — each star tier gets its own distinct color. */
export function sosDifficultyChipClass(tone: SosDifficultyTone): string {
  if (tone === "elite") return "bg-emerald-600 text-white";
  if (tone === "good") return "bg-emerald-400 text-emerald-950";
  if (tone === "neutral") return "bg-amber-500 text-slate-950";
  if (tone === "bad") return "bg-rose-400 text-rose-950";
  if (tone === "tough") return "bg-rose-600 text-white";
  return "bg-slate-200 font-extrabold text-slate-500";
}

/** Title-case difficulty label for the SOS table Difficulty column. */
export function sosDifficultyDisplayLabel(label: string | null | undefined): string {
  if (!label) return "—";
  const upper = label.toUpperCase();
  if (upper === "GREAT") return "Great";
  if (upper === "GOOD") return "Good";
  if (upper === "NEUTRAL") return "Neutral";
  if (upper === "BAD") return "Bad";
  if (upper === "TOUGH") return "Tough";
  if (upper === "BYE") return "Bye";
  return label;
}

/** Text color for the season-long overall matchup grade (no pill). */
export function overallMatchupGradeClass(grade: SosGrade): string {
  if (grade === "CAKEWALK") return "text-emerald-600";
  if (grade === "ADVANTAGEOUS") return "text-emerald-500";
  if (grade === "CATASTROPHIC") return "text-rose-600";
  return "text-amber-500";
}

/** @deprecated Prefer {@link overallMatchupGradeClass} — pill badges removed from UI. */
export function overallMatchupBadge(grade: SosGrade): string {
  if (grade === "CAKEWALK") return "ELITE";
  if (grade === "ADVANTAGEOUS") return "SOFT";
  if (grade === "CATASTROPHIC") return "HARD";
  return "MID";
}

export function overallMatchupPresentation(rank: number | null | undefined): {
  grade: SosGrade;
  textClass: string;
  /** @deprecated Kept for callers still reading `.badge`; prefer `textClass`. */
  badge: string;
} {
  const grade = matchupGrade(rank ?? null);
  return {
    grade,
    textClass: overallMatchupGradeClass(grade),
    badge: overallMatchupBadge(grade),
  };
}

export type PlayoffWindowLabel = "Elite" | "Balanced" | "Challenging";

export function playoffWindowPresentation(
  sos: PlayerSos | null | undefined,
  position?: string | null,
  matrix?: Record<string, SosPeer> | null,
): { label: PlayoffWindowLabel; textClass: string } {
  const label = playoffWindow(sos, position, matrix);
  if (label === "Elite") return { label, textClass: "text-emerald-600" };
  if (label === "Challenging") return { label, textClass: "text-rose-600" };
  return { label, textClass: "text-amber-600" };
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

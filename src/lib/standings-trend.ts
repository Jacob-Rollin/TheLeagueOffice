/**
 * Week-over-week standings trend: ranks through a prior completed week,
 * derived from matchup history (not browser last-seen localStorage).
 */

export type TrendBoardEntry = {
  rosterId: number;
  matchupId: number | null;
  points: number;
};

export type TrendWeekBoard = {
  week: number;
  entries: TrendBoardEntry[];
};

type Tally = {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

function winPercentage(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  if (games <= 0) return 0;
  return (wins / games) * 100;
}

function sortByStandings(a: Tally & { rosterId: number }, b: Tally & { rosterId: number }): number {
  return (
    winPercentage(b.wins, b.losses, b.ties) - winPercentage(a.wins, a.losses, a.ties) ||
    b.wins - a.wins ||
    a.losses - b.losses ||
    b.pointsFor - a.pointsFor ||
    a.rosterId - b.rosterId
  );
}

function rankMapFromTallies(tallies: Map<number, Tally>): Record<string, number> | null {
  if (tallies.size < 2) return null;
  const ranked = [...tallies.entries()]
    .map(([rosterId, t]) => ({ rosterId, ...t }))
    .sort(sortByStandings);
  const out: Record<string, number> = {};
  ranked.forEach((row, index) => {
    out[String(row.rosterId)] = index + 1;
  });
  return out;
}

function boardsThrough(boards: TrendWeekBoard[], throughWeek: number): TrendWeekBoard[] {
  const max = Math.floor(throughWeek);
  if (max < 1) return [];
  return boards.filter((b) => b.week >= 1 && b.week <= max);
}

/** Actual (H2H) standings ranks through `throughWeek` from finalized matchup boards. */
export function h2hRankMapThroughWeek(
  boards: TrendWeekBoard[],
  throughWeek: number,
): Record<string, number> | null {
  const tallies = new Map<number, Tally>();
  const ensure = (rosterId: number): Tally => {
    const hit = tallies.get(rosterId);
    if (hit) return hit;
    const fresh = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
    tallies.set(rosterId, fresh);
    return fresh;
  };

  let decidedWeeks = 0;
  for (const board of boardsThrough(boards, throughWeek)) {
    const entries = board.entries ?? [];
    if (entries.length < 2) continue;

    for (const entry of entries) {
      const rosterId = Number(entry.rosterId);
      if (!Number.isFinite(rosterId)) continue;
      ensure(rosterId).pointsFor += Number(entry.points) || 0;
    }

    const byMatchup = new Map<number, TrendBoardEntry[]>();
    for (const entry of entries) {
      if (entry.matchupId == null) continue;
      const id = Number(entry.matchupId);
      if (!Number.isFinite(id)) continue;
      const bucket = byMatchup.get(id) ?? [];
      bucket.push(entry);
      byMatchup.set(id, bucket);
    }

    let decidedPairs = 0;
    for (const pair of byMatchup.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      if (!a || !b) continue;
      const aPts = Number(a.points) || 0;
      const bPts = Number(b.points) || 0;
      const aT = ensure(Number(a.rosterId));
      const bT = ensure(Number(b.rosterId));
      if (aPts > bPts) {
        aT.wins += 1;
        bT.losses += 1;
      } else if (bPts > aPts) {
        bT.wins += 1;
        aT.losses += 1;
      } else {
        aT.ties += 1;
        bT.ties += 1;
      }
      decidedPairs += 1;
    }
    if (decidedPairs > 0) decidedWeeks += 1;
  }

  if (decidedWeeks < 1) return null;
  return rankMapFromTallies(tallies);
}

/** All-Play standings ranks through `throughWeek` (N-1 decisions per scoring week). */
export function allPlayRankMapThroughWeek(
  boards: TrendWeekBoard[],
  throughWeek: number,
): Record<string, number> | null {
  const tallies = new Map<number, Tally>();
  const ensure = (rosterId: number): Tally => {
    const hit = tallies.get(rosterId);
    if (hit) return hit;
    const fresh = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
    tallies.set(rosterId, fresh);
    return fresh;
  };

  let scoredWeeks = 0;
  for (const board of boardsThrough(boards, throughWeek)) {
    const byRoster = new Map<number, number>();
    for (const entry of board.entries ?? []) {
      const rosterId = Number(entry.rosterId);
      if (!Number.isFinite(rosterId)) continue;
      const points = Number(entry.points);
      if (!Number.isFinite(points)) continue;
      byRoster.set(rosterId, points);
    }
    if (byRoster.size < 2) continue;

    const scoresList = [...byRoster.entries()].map(([rosterId, points]) => ({ rosterId, points }));
    const totalPts = scoresList.reduce((sum, row) => sum + row.points, 0);
    if (totalPts <= 0) continue;

    const sorted = [...scoresList].sort((a, b) => b.points - a.points);
    const decisionsPerWeek = Math.max(0, sorted.length - 1);
    sorted.forEach((teamScore, place) => {
      const tally = ensure(teamScore.rosterId);
      tally.pointsFor += teamScore.points;
      tally.wins += decisionsPerWeek - place;
      tally.losses += place;
    });
    scoredWeeks += 1;
  }

  if (scoredWeeks < 1) return null;
  return rankMapFromTallies(tallies);
}

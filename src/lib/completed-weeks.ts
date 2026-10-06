/**
 * Completed-week helpers for coaching / standings analytics.
 *
 * Host standings (W-L-T) often include the just-finished slate before Sleeper’s
 * `week` advances, and Sleeper may keep `display_week` on that slate while
 * `week` has already rolled. Analytics must follow the later of those signals
 * so avg points / coaching efficiency / Actual & All-Play do not stall a week
 * behind the standings page.
 */

export function completedWeeksThrough(input: {
  nflWeek?: number | null;
  displayWeek?: number | null;
  /** Wins + losses + ties from host standings for any team (games played). */
  gamesPlayed?: number | null;
}): number {
  const week = Math.max(0, Math.floor(Number(input.nflWeek ?? 0)) || 0);
  const display = Math.max(0, Math.floor(Number(input.displayWeek ?? 0)) || 0);
  const played = Math.max(0, Math.floor(Number(input.gamesPlayed ?? 0)) || 0);
  const fromNfl = week > 1 ? week - 1 : 0;
  // When `week` has advanced past `display_week`, the display slate is finished.
  const fromDisplay = week > display && display > 0 ? display : 0;
  return Math.min(18, Math.max(fromNfl, fromDisplay, played));
}

export function completedWeekNumberList(input: {
  nflWeek?: number | null;
  displayWeek?: number | null;
  gamesPlayed?: number | null;
}): number[] {
  const through = completedWeeksThrough(input);
  if (through <= 0) return [];
  return Array.from({ length: through }, (_, i) => i + 1);
}

/** Max games played across standings rows (host truth for completed slates). */
export function standingsGamesPlayed(
  rows: { wins?: number | null; losses?: number | null; ties?: number | null }[] | null | undefined,
): number {
  if (!rows?.length) return 0;
  let max = 0;
  for (const row of rows) {
    const played =
      (Number(row.wins) || 0) + (Number(row.losses) || 0) + (Number(row.ties) || 0);
    if (played > max) max = played;
  }
  return max;
}

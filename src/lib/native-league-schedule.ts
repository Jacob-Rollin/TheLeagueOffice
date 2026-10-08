/**
 * Client-safe round-robin schedule builder for native leagues.
 * Circle method; odd team counts get a bye (null opponent skipped).
 */

export type NativeScheduleMatchup = {
  week: number;
  matchupId: number;
  homeTeamId: number;
  awayTeamId: number;
};

/** Build up to `weekCount` weeks of home/away pairs from team ids. */
export function buildNativeRoundRobinSchedule(
  teamIds: number[],
  weekCount: number,
): NativeScheduleMatchup[] {
  const ids = teamIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length < 2 || weekCount < 1) return [];

  const rotating = [...ids];
  if (rotating.length % 2 === 1) rotating.push(-1); // bye sentinel
  const n = rotating.length;
  const roundsPerCycle = n - 1;
  const half = n / 2;
  const out: NativeScheduleMatchup[] = [];

  for (let week = 1; week <= weekCount; week++) {
    const round = (week - 1) % roundsPerCycle;
    // Rotate for this round from a fresh copy of the base order.
    const order = [...ids];
    if (order.length % 2 === 1) order.push(-1);
    for (let r = 0; r < round; r++) {
      const fixed = order[0]!;
      const rest = order.slice(1);
      const last = rest.pop()!;
      order.splice(0, order.length, fixed, last, ...rest);
    }

    let matchupId = 1;
    for (let i = 0; i < half; i++) {
      const a = order[i]!;
      const b = order[n - 1 - i]!;
      if (a < 0 || b < 0) continue;
      const home = week % 2 === 0 ? a : b;
      const away = week % 2 === 0 ? b : a;
      out.push({ week, matchupId, homeTeamId: home, awayTeamId: away });
      matchupId += 1;
    }
  }

  return out;
}

/** Count draftable roster spots (exclude IR). */
export function countDraftableRosterSpots(rosterSlots: Record<string, unknown> | null | undefined): number {
  if (!rosterSlots || typeof rosterSlots !== "object") return 15;
  let total = 0;
  for (const [key, value] of Object.entries(rosterSlots)) {
    if (key === "IR") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total > 0 ? total : 15;
}

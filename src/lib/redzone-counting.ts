/**
 * Red-zone counting rules aligned with FantasyPros / official boards.
 *
 * - Snaps that *start* at yardline_100 in (0, yardline] only.
 * - Exclude two-point conversion tries.
 * - Pass Att excludes sacks (nflverse sets pass_attempt=1 on sacks; Sacks is separate).
 * - Kneels (`qb_kneel`) count as rush attempts / yards.
 */

export function isRedZonePlayType(playType: string): boolean {
  return playType === "pass" || playType === "run" || playType === "qb_kneel";
}

export function isRushPlayType(playType: string): boolean {
  return playType === "run" || playType === "qb_kneel";
}

export function isTwoPointTry(twoPointAttempt: number): boolean {
  return twoPointAttempt > 0;
}

/** Official pass attempts: exclude sack plays (still count toward passSack). */
export function officialPassAttemptDelta(passAttempt: number, sack: number): number {
  if (sack > 0) return 0;
  return passAttempt > 0 ? passAttempt : 0;
}

export function rushAttemptDelta(rushAttempt: number): number {
  return rushAttempt > 0 ? rushAttempt : 1;
}

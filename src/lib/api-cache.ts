/**
 * Shared CDN Cache-Control helpers for Nitro /api data routes.
 *
 * Live/league data: short TTLs (scores move).
 * Research/warehouse: long TTLs (cron-warmed, changes hourly at most) so
 * scale does not burn TiDB free-tier RUs on every browser refresh.
 */

export function isGamedayUtc(date = new Date()): boolean {
  const day = date.getUTCDay(); // 0 Sun, 1 Mon, 4 Thu
  return day === 0 || day === 1 || day === 4;
}

/**
 * Early Tuesday UTC after the NFL week rolls — completed-week *analytics*
 * (coaching efficiency, avg points, standings Actual/All-Play, etc.) must
 * pick up the Tuesday ~1am ET finalize cron. Live matchup polls stay on the
 * normal gameday / short live TTLs and are not gated on this window.
 */
export function isWeekRollWindowUtc(date = new Date()): boolean {
  const day = date.getUTCDay(); // 2 Tue, 3 Wed
  if (day === 2) return true;
  // Short Wednesday morning so late finalize still propagates on history CDN.
  return day === 3 && date.getUTCHours() < 12;
}

/** Tuesday 05:00 UTC ≈ 1:00 AM Eastern (EDT) — week-roll finalize cron. */
export const WEEK_ROLL_CRON_UTC_HOUR = 5;

/**
 * Most recent Tuesday 05:00 UTC (matches Tuesday week-roll `league-delta-sync`).
 * Before that instant on Tuesday, returns the previous Tuesday.
 */
export function mostRecentWeekRollUtcMs(date = new Date()): number {
  const day = date.getUTCDay(); // 0 Sun … 2 Tue
  const daysSinceTuesday = (day + 5) % 7; // Tue→0, Wed→1, … Mon→6
  const roll = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceTuesday,
    WEEK_ROLL_CRON_UTC_HOUR,
    0,
    0,
    0,
  );
  if (date.getTime() < roll) return roll - 7 * 24 * 60 * 60 * 1000;
  return roll;
}

/**
 * Just-completed week (NFL `week - 1`) boards are soft-final until the early
 * Tuesday cron re-pulls host scores for completed-week analytics.
 * Live current-week matchups do not use this gate.
 */
export function isPriorWeekBoardFresh(syncedAtMs: number, date = new Date()): boolean {
  if (!(syncedAtMs > 0)) return false;
  const day = date.getUTCDay();
  const ageMs = date.getTime() - syncedAtMs;
  // Late Monday / pre-cron Tuesday: `mostRecentWeekRollUtcMs` steps back a week,
  // so Sunday boards would look "after roll" — require a recent overnight pull.
  if (
    (day === 1 && date.getUTCHours() >= 20) ||
    (day === 2 && date.getUTCHours() < WEEK_ROLL_CRON_UTC_HOUR)
  ) {
    return ageMs <= 8 * 60 * 60 * 1000;
  }
  return syncedAtMs >= mostRecentWeekRollUtcMs(date);
}

/** Default for live-ish /api/data routes (league boards, etc.). */
export function dataCacheControl(date = new Date()): string {
  // Live matchups stay on the fast path — do not tie them to week-roll analytics.
  if (isGamedayUtc(date)) {
    return "public, s-maxage=30, stale-while-revalidate=10, max-age=15";
  }
  return "public, s-maxage=300, stale-while-revalidate=60, max-age=60";
}

/**
 * Past-week / all-weeks matchup boards for completed-week analytics
 * (coaching / standings / avg PF). Longer edge TTL mid-week; shorten only
 * during the Tuesday week-roll window so finalized prior-week scores land.
 * Single-week live boards use `dataCacheControl` and stay frequent.
 */
export function leagueHistoryCacheControl(date = new Date()): string {
  if (isWeekRollWindowUtc(date)) {
    return "public, s-maxage=60, stale-while-revalidate=30, max-age=30";
  }
  if (isGamedayUtc(date)) {
    return "public, s-maxage=300, stale-while-revalidate=120, max-age=60";
  }
  return "public, s-maxage=1800, stale-while-revalidate=600, max-age=300";
}

/**
 * Research aggregates (FPA, SOS, leaders, redzone, …). Cron warms a few times
 * a day — edge can hold for an hour mid-week without stale product risk.
 */
export function researchCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=300, stale-while-revalidate=120, max-age=60";
  }
  return "public, s-maxage=3600, stale-while-revalidate=600, max-age=300";
}

/**
 * Player warehouse export. Ingest is daily — long CDN TTL is the main RU shield
 * as session count grows (every client hydrates this).
 */
export function warehouseCacheControl(date = new Date()): string {
  if (isGamedayUtc(date)) {
    return "public, s-maxage=600, stale-while-revalidate=300, max-age=120";
  }
  return "public, s-maxage=3600, stale-while-revalidate=600, max-age=300";
}

export function jsonResponse(data: unknown, init?: { status?: number; cache?: string }): Response {
  const status = init?.status ?? 200;
  const cache = init?.cache ?? (status === 200 ? dataCacheControl() : "no-store");
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cache,
      vary: "Accept-Encoding",
    },
  });
}

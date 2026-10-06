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
 * Tuesday (and early Wednesday UTC) after the NFL week rolls — completed-week
 * boards must propagate from the morning delta-sync cron, not sit behind a
 * 30-minute history CDN pin.
 */
export function isWeekRollWindowUtc(date = new Date()): boolean {
  const day = date.getUTCDay(); // 2 Tue, 3 Wed
  if (day === 2) return true;
  return day === 3 && date.getUTCHours() < 12;
}

/**
 * Most recent Tuesday 08:00 UTC (matches `league-delta-sync` cron).
 * Before that instant on Tuesday, returns the previous Tuesday.
 */
export function mostRecentWeekRollUtcMs(date = new Date()): number {
  const day = date.getUTCDay(); // 0 Sun … 2 Tue
  const daysSinceTuesday = (day + 5) % 7; // Tue→0, Wed→1, … Mon→6
  const roll = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceTuesday,
    8,
    0,
    0,
    0,
  );
  if (date.getTime() < roll) return roll - 7 * 24 * 60 * 60 * 1000;
  return roll;
}

/**
 * Just-completed week (NFL `week - 1`) boards are soft-final until the Tuesday
 * morning cron re-pulls host scores. Reject midweek snapshots frozen as "final".
 */
export function isPriorWeekBoardFresh(syncedAtMs: number, date = new Date()): boolean {
  if (!(syncedAtMs > 0)) return false;
  const day = date.getUTCDay();
  const ageMs = date.getTime() - syncedAtMs;
  // Late Monday / pre-cron Tuesday: `mostRecentWeekRollUtcMs` steps back a week,
  // so Sunday boards would look "after roll" — require a recent overnight pull.
  if ((day === 1 && date.getUTCHours() >= 20) || (day === 2 && date.getUTCHours() < 8)) {
    return ageMs <= 8 * 60 * 60 * 1000;
  }
  return syncedAtMs >= mostRecentWeekRollUtcMs(date);
}

/** Default for live-ish /api/data routes (league boards, etc.). */
export function dataCacheControl(date = new Date()): string {
  if (isGamedayUtc(date) || isWeekRollWindowUtc(date)) {
    return "public, s-maxage=30, stale-while-revalidate=10, max-age=15";
  }
  return "public, s-maxage=300, stale-while-revalidate=60, max-age=60";
}

/**
 * Past-week / all-weeks matchup boards — not live scoring.
 * Longer edge TTL cuts TiDB RUs when analytics hydrates history.
 * Shorten on Tuesday week-roll mornings so finalized prior-week scores land.
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

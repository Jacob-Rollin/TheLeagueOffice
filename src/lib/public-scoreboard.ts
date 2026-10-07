/**
 * Shared ESPN NFL scoreboard fetch helpers.
 *
 * Prefer visitor→ESPN directly (CORS allows *). That keeps ScoreTicker off the
 * Hobby CDN Request meter. Fall back to same-origin `/api/public/scoreboard`
 * only when the direct pull fails (extension blocks, flaky network).
 */

export const SCOREBOARD_PROXY_URL = "/api/public/scoreboard";
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** In-tab coalescing so remounts / dual hooks do not double-hit ESPN. */
const memory = new Map<string, { at: number; live: boolean; value: unknown }>();
const LIVE_MEMORY_TTL_MS = 15_000;
/** Align with mid-week quiet poll so remounts do not re-hit ESPN every 2m. */
const IDLE_MEMORY_TTL_MS = 5 * 60_000;

export function scoreboardQueryKey(week?: number | null, seasontype?: number | null) {
  return ["nfl-public-scoreboard", week ?? null, seasontype ?? null] as const;
}

function scoreboardKey(week?: number | null, seasontype?: number | null): string {
  return `${week ?? ""}|${seasontype ?? ""}`;
}

export function scoreboardProxyUrl(week?: number | null, seasontype?: number | null): string {
  const params = new URLSearchParams();
  if (week != null && week > 0) params.set("week", String(week));
  if (seasontype != null && seasontype > 0) params.set("seasontype", String(seasontype));
  const qs = params.toString();
  return qs ? `${SCOREBOARD_PROXY_URL}?${qs}` : SCOREBOARD_PROXY_URL;
}

function espnScoreboardUrl(week?: number | null, seasontype?: number | null): string {
  const params = new URLSearchParams();
  if (week != null && week > 0) params.set("week", String(week));
  if (seasontype != null && seasontype > 0) params.set("seasontype", String(seasontype));
  const qs = params.toString();
  return qs ? `${ESPN_SCOREBOARD}?${qs}` : ESPN_SCOREBOARD;
}

async function readJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch scoreboard JSON — browser→ESPN first, Vercel proxy only as fallback. */
export async function fetchPublicScoreboard(
  week?: number | null,
  seasontype?: number | null,
): Promise<unknown | null> {
  const key = scoreboardKey(week, seasontype);
  const now = Date.now();
  const hit = memory.get(key);
  if (hit) {
    const ttl = hit.live ? LIVE_MEMORY_TTL_MS : IDLE_MEMORY_TTL_MS;
    if (now - hit.at < ttl) return hit.value;
  }

  let json = await readJson(espnScoreboardUrl(week, seasontype));
  if (json == null) {
    json = await readJson(scoreboardProxyUrl(week, seasontype));
  }
  if (json == null) return null;

  memory.set(key, { at: now, live: scoreboardHasLiveGame(json), value: json });
  return json;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function scoreboardHasLiveGame(json: any): boolean {
  const events: any[] = Array.isArray(json?.events) ? json.events : [];
  return events.some((ev) => {
    const state = String(
      ev?.competitions?.[0]?.status?.type?.state ?? ev?.status?.type?.state ?? "",
    );
    return state.toLowerCase() === "in";
  });
}

/** Earliest upcoming kickoff (ms), or null when none are still pre-game. */
export function scoreboardNextKickoffMs(json: any, now = Date.now()): number | null {
  const events: any[] = Array.isArray(json?.events) ? json.events : [];
  let next: number | null = null;
  for (const ev of events) {
    const state = String(
      ev?.competitions?.[0]?.status?.type?.state ?? ev?.status?.type?.state ?? "",
    ).toLowerCase();
    if (state !== "pre") continue;
    const raw =
      ev?.competitions?.[0]?.date ?? ev?.date ?? ev?.competitions?.[0]?.startDate ?? null;
    const at = raw ? Date.parse(String(raw)) : NaN;
    if (!Number.isFinite(at) || at < now - 5 * 60 * 1000) continue;
    next = next == null ? at : Math.min(next, at);
  }
  return next;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

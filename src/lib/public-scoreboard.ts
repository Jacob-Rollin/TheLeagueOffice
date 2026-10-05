/**
 * Shared ESPN NFL scoreboard fetch helpers.
 * Browser clients hit the same-origin proxy so CDN Cache-Control can coalesce
 * ScoreTicker + live-matchup progress polls onto one upstream ESPN call.
 */

export const SCOREBOARD_PROXY_URL = "/api/public/scoreboard";

export function scoreboardQueryKey(week?: number | null, seasontype?: number | null) {
  return ["nfl-public-scoreboard", week ?? null, seasontype ?? null] as const;
}

export function scoreboardProxyUrl(week?: number | null, seasontype?: number | null): string {
  const params = new URLSearchParams();
  if (week != null && week > 0) params.set("week", String(week));
  if (seasontype != null && seasontype > 0) params.set("seasontype", String(seasontype));
  const qs = params.toString();
  return qs ? `${SCOREBOARD_PROXY_URL}?${qs}` : SCOREBOARD_PROXY_URL;
}

/** Fetch scoreboard JSON via the CDN-cached same-origin proxy. */
export async function fetchPublicScoreboard(
  week?: number | null,
  seasontype?: number | null,
): Promise<unknown | null> {
  const url = scoreboardProxyUrl(week, seasontype);
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
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
/* eslint-enable @typescript-eslint/no-explicit-any */

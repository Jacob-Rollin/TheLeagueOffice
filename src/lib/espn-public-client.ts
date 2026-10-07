/**
 * Browser → public ESPN JSON (CORS *). Shared IndexedDB keys so homepage,
 * mobile home, and player-news remounts do not re-hit ESPN every navigation.
 */

import { getCached } from "@/lib/sleeper-cache";

const NEWS_TTL_MS = 15 * 60 * 1000;

/** Raw NFL news payload from site.api.espn.com (`articles` array). */
export async function fetchEspnNflNewsJson(limit = 50): Promise<{ articles?: unknown[] }> {
  const safe = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  return getCached(`espn-nfl-news-raw-v1:${safe}`, NEWS_TTL_MS, async () => {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=${safe}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`espn news ${res.status}`);
    return (await res.json()) as { articles?: unknown[] };
  });
}

/** Fantasy player news feed for one ESPN athlete id. */
export async function fetchEspnPlayerFeedJson(athleteId: string): Promise<{ feed?: unknown[] }> {
  const id = String(athleteId ?? "").trim();
  if (!id) return { feed: [] };
  return getCached(`espn-player-feed-v1:${id}`, 10 * 60 * 1000, async () => {
    const res = await fetch(
      `https://site.web.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(id)}&limit=15`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`espn feed ${res.status}`);
    return (await res.json()) as { feed?: unknown[] };
  }).catch(() => ({ feed: [] }));
}

/** Team-scoped NFL news (`&team=dal`). */
export async function fetchEspnTeamNewsJson(teamAbbr: string): Promise<{ articles?: unknown[] }> {
  const team = String(teamAbbr ?? "")
    .trim()
    .toLowerCase();
  if (!team || team === "fa") return { articles: [] };
  return getCached(`espn-team-news-v1:${team}`, NEWS_TTL_MS, async () => {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50&team=${encodeURIComponent(team)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`espn team news ${res.status}`);
    return (await res.json()) as { articles?: unknown[] };
  }).catch(() => ({ articles: [] }));
}

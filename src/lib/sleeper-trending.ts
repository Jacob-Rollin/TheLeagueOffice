/**
 * Shared client trending helper — one IndexedDB key + one RQ key family.
 */
import { getCached } from "@/lib/sleeper-cache";

export type TrendingRow = { player_id: string; count: number };

const TTL = 15 * 60 * 1000;

async function sleeperTrending(
  type: "add" | "drop",
  lookbackHours: number,
  limit: number,
): Promise<TrendingRow[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
    { headers: { accept: "application/json" } },
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const json = (await res.json()) as { player_id?: string; count?: number }[];
  return (Array.isArray(json) ? json : [])
    .map((row) => ({
      player_id: String(row?.player_id ?? ""),
      count: Number(row?.count ?? 0) || 0,
    }))
    .filter((row) => row.player_id);
}

/** Cached trending adds/drops (default 24h lookback, top 50). */
export async function fetchTrendingAddsClient(
  lookbackHours = 24,
  limit = 50,
  type: "add" | "drop" = "add",
): Promise<TrendingRow[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 50));
  const safeLookback = Math.min(168, Math.max(1, Math.floor(lookbackHours) || 24));
  return getCached(`sleeper-trending-${type}-v1:${safeLookback}|${safeLimit}`, TTL, () =>
    sleeperTrending(type, safeLookback, safeLimit),
  );
}

export const TRENDING_QUERY_KEY = ["sleeper-trending-add", "v1"] as const;

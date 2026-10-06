/**
 * Shared player catalog loader for client routes.
 * Prefers the browser Sleeper day-cache (zero Fluid CPU). SSR / serverFn
 * callers still use the memoized server build as a fallback.
 */
import { buildPlayersPayload, type PlayersPayload } from "@/lib/players-build";
import { getCached } from "@/lib/sleeper-cache";

const CACHE_KEY = "players-v3";
const DAY = 1000 * 60 * 60 * 24;

export type { PlayersPayload };

/** Client-first catalog. Use as React Query `queryFn` instead of `getPlayers()`. */
export async function loadPlayersCatalog(): Promise<PlayersPayload> {
  if (typeof window !== "undefined") {
    return getCached(CACHE_KEY, DAY, buildPlayersPayload);
  }
  const { loadPlayers } = await import("@/lib/players.server");
  return loadPlayers();
}

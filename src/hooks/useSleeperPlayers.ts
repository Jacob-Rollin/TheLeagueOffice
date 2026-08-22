import { useCallback, useEffect, useRef, useState } from "react";

import { buildPlayersPayload, type PlayersPayload } from "@/lib/players-build";
import { clearCache, getCached, readCache } from "@/lib/sleeper-cache";

const CACHE_KEY = "players-v1";
const DAY = 1000 * 60 * 60 * 24;

export type SleeperPlayersState = {
  data: PlayersPayload | null;
  loading: boolean;
  error: string | null;
  /** Epoch ms of the cached record backing `data`, when known. */
  fetchedAt: number | null;
  resync: () => void;
};

/**
 * Downloads the Sleeper fantasy catalog directly from the user's browser at
 * most once per day, filters it to active fantasy assets, and persists it
 * locally. Search / filtering / scrolling then run entirely over this array
 * with zero network calls.
 */
export function useSleeperPlayers(fallback?: PlayersPayload | null): SleeperPlayersState {
  const [data, setData] = useState<PlayersPayload | null>(fallback ?? null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(!fallback);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      const hit = await readCache<PlayersPayload>(CACHE_KEY);
      if (!cancelled && hit && Date.now() - hit.fetchedAt < DAY) {
        setData(hit.data);
        setFetchedAt(hit.fetchedAt);
        setLoading(false);
        return;
      }
      if (!cancelled && !hit) setLoading(true);
      try {
        const fresh = await getCached(CACHE_KEY, DAY, buildPlayersPayload);
        if (cancelled) return;
        setData(fresh);
        setFetchedAt(Date.now());
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Sleeper sync failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const resync = useCallback(() => {
    void (async () => {
      await clearCache(CACHE_KEY);
      setNonce((n) => n + 1);
    })();
  }, []);

  return { data, loading, error, fetchedAt, resync };
}

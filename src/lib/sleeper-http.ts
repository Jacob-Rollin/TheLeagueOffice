/**
 * Budgeted browser → api.sleeper.app JSON fetch.
 * All public Sleeper client loaders should use this (or acquireSleeperPermit)
 * so tabs stay under the soft ~180/min ceiling ≪ ~1000/min IP limit.
 */

import { acquireSleeperPermit, waitForSleeperPermit } from "@/lib/sleeper-rate-budget";

export type SleeperFetchKind = "live" | "warm" | "default";

/** One outbound Sleeper GET with soft budget + single 429 backoff. */
export async function sleeperFetchJson<T>(
  url: string,
  kind: SleeperFetchKind = "default",
): Promise<T | null> {
  const ok =
    kind === "live" ? acquireSleeperPermit("live") : await waitForSleeperPermit(kind, 4_000);
  if (!ok) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      if (!acquireSleeperPermit(kind === "live" ? "live" : "warm")) return null;
      const retry = await fetch(url, { headers: { accept: "application/json" } });
      if (!retry.ok) return null;
      return (await retry.json()) as T;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

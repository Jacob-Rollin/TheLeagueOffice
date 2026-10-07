/**
 * Browser FantasyCalc implied-value history — visitor IP, no Fluid.
 * Soft-empty on miss / CORS / rate limit so sparklines stay cheap.
 */

import { getCached } from "@/lib/sleeper-cache";
import type { MarketFormat, MarketHistoryPoint } from "@/lib/trade-market";

const FC_BASE = "https://api.fantasycalc.com";
const HISTORY_DAYS = 30;
const HISTORY_TTL_MS = 30 * 60 * 1000;
const PPR_PARAM: Record<MarketFormat, string> = { std: "0", half: "0.5", ppr: "1" };

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

type FcImplied = { historicalValues?: { date?: string; value?: number }[] };

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mapHistory(json: FcImplied | null): MarketHistoryPoint[] {
  return (json?.historicalValues ?? [])
    .filter(
      (p): p is { date: string; value: number } =>
        typeof p.date === "string" && Number(p.value) > 0,
    )
    .slice(-HISTORY_DAYS)
    .map((p) => ({ date: p.date, value: Number(p.value) }));
}

export async function fetchMarketHistoryClient(
  fcId: number,
  format: MarketFormat = "half",
): Promise<MarketHistoryPoint[]> {
  const id = Math.max(0, Math.trunc(Number(fcId) || 0));
  if (!id) return [];
  const fmt: MarketFormat = format === "std" || format === "ppr" ? format : "half";
  const ppr = PPR_PARAM[fmt];
  const url = `${FC_BASE}/trades/implied/${encodeURIComponent(String(id))}?isDynasty=false&numQbs=1&numTeams=12&ppr=${ppr}`;

  try {
    return await getCached(`fc-implied-history-v1:${id}|${fmt}`, HISTORY_TTL_MS, async () => {
      const first = await fetchJson<FcImplied>(url);
      if (first) return mapHistory(first);
      await new Promise((r) => setTimeout(r, 750));
      const second = await fetchJson<FcImplied>(url);
      if (second) return mapHistory(second);
      throw new Error("fantasycalc history miss");
    });
  } catch {
    if (!allowFluidFallback()) return [];
    const { getMarketHistory } = await import("@/lib/players.functions");
    return getMarketHistory({ data: { fcId: id, format: fmt } });
  }
}

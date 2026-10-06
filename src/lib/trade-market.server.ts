/**
 * Trade Market Values: FantasyCalc market (built from real trades across
 * platforms) joined with a Sleeper-usage opportunity grade for Buy Low / Sell High.
 */

import { currentSeason, fetchRows, HOUR, SLEEPER_BASE, type SleeperRow } from "./players-build";
import {
  MARKET_POSITIONS,
  type MarketFormat,
  type MarketHistoryPoint,
  type MarketPos,
  type MarketRow,
  type OpportunityRow,
  type TradeMarketPayload,
} from "./trade-market";

const FC_BASE = "https://api.fantasycalc.com";
const HISTORY_DAYS = 30;
const PPR_PARAM: Record<MarketFormat, string> = { std: "0", half: "0.5", ppr: "1" };

function memo<T>(ttl: number, fn: (key: string) => Promise<T>) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = fn(key).catch((err) => {
      store.delete(key);
      throw err;
    });
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type FcEntry = {
  player?: {
    id?: number;
    name?: string;
    sleeperId?: string | null;
    position?: string;
    maybeTeam?: string | null;
  };
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number;
  maybeTradeFrequency?: number | null;
};

function isMarketPos(pos: unknown): pos is MarketPos {
  return typeof pos === "string" && (MARKET_POSITIONS as string[]).includes(pos);
}

const marketValues = memo<MarketRow[]>(HOUR, async (format) => {
  const ppr = PPR_PARAM[format as MarketFormat] ?? "0.5";
  const rows = await fetchJson<FcEntry[]>(
    `${FC_BASE}/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=${ppr}`,
  );
  if (!rows) return [];
  const out: MarketRow[] = [];
  for (const entry of Array.isArray(rows) ? rows : []) {
    const p = entry.player;
    const sleeperId = p?.sleeperId?.trim();
    if (!p?.id || !sleeperId || !isMarketPos(p.position)) continue;
    out.push({
      id: sleeperId,
      fcId: p.id,
      name: p.name?.trim() || "Unknown",
      pos: p.position,
      team: p.maybeTeam?.trim() || "FA",
      value: Number(entry.value) || 0,
      trend30: Number(entry.trend30Day) || 0,
      overallRank: Number(entry.overallRank) || 999,
      positionRank: Number(entry.positionRank) || 999,
      tradeFrequency:
        typeof entry.maybeTradeFrequency === "number" ? entry.maybeTradeFrequency : null,
    });
  }
  return out.sort((a, b) => b.value - a.value);
});

const s = (stats: Record<string, number> | null | undefined, key: string): number => {
  const v = stats?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

type Components = Record<string, number>;

/** Usage inputs and weights per position; each input becomes a percentile in its pool. */
const WEIGHTS: Record<MarketPos, Record<string, number>> = {
  WR: { targetsPg: 0.25, airYardsPg: 0.15, snapPct: 0.15, targetShare: 0.2, airShare: 0.1, redZonePg: 0.15 },
  TE: { targetsPg: 0.25, airYardsPg: 0.15, snapPct: 0.15, targetShare: 0.2, airShare: 0.1, redZonePg: 0.15 },
  RB: { touchesPg: 0.3, targetsPg: 0.15, snapPct: 0.2, redZonePg: 0.25, targetShare: 0.1 },
  QB: { passAttPg: 0.35, rushAttPg: 0.25, redZonePg: 0.25, snapPct: 0.15 },
};

function percentile(sorted: number[], v: number): number {
  if (sorted.length <= 1) return 50;
  let lo = 0;
  while (lo < sorted.length && sorted[lo]! < v) lo++;
  let hi = lo;
  while (hi < sorted.length && sorted[hi]! === v) hi++;
  return ((lo + (hi - lo - 1) / 2) / (sorted.length - 1)) * 100;
}

function buildOpportunity(rows: SleeperRow[]): OpportunityRow[] {
  const teamTargets = new Map<string, number>();
  const teamAir = new Map<string, number>();
  for (const row of rows) {
    const team = row.team?.trim();
    if (!team) continue;
    teamTargets.set(team, (teamTargets.get(team) ?? 0) + s(row.stats, "rec_tgt"));
    teamAir.set(team, (teamAir.get(team) ?? 0) + Math.max(0, s(row.stats, "rec_air_yd")));
  }

  type Draft = Omit<OpportunityRow, "score" | "rank"> & { comps: Components };
  const pool: Draft[] = [];
  for (const row of rows) {
    const pos = row.player?.position;
    if (!isMarketPos(pos)) continue;
    const st = row.stats;
    const gp = s(st, "gp");
    if (gp < 1) continue;
    const snaps = s(st, "off_snp");
    const teamSnaps = s(st, "tm_off_snp");
    const snapPct = teamSnaps > 0 ? snaps / teamSnaps : null;
    const targets = s(st, "rec_tgt");
    const team = row.team?.trim() ?? "";
    const tTargets = teamTargets.get(team) ?? 0;
    const tAir = teamAir.get(team) ?? 0;
    const targetShare = tTargets > 0 ? targets / tTargets : null;
    const air = Math.max(0, s(st, "rec_air_yd"));
    const rushAtt = s(st, "rush_att");
    const passAtt = s(st, "pass_att");
    const redZone =
      pos === "QB"
        ? s(st, "pass_rz_att") + s(st, "rush_rz_att")
        : s(st, "rec_rz_tgt") + s(st, "rush_rz_att");

    // Only grade players with a real role so part-timers don't skew the cuts.
    if (pos === "QB" ? passAtt / gp < 15 : snaps / gp < 15) continue;

    const targetsPg = targets / gp;
    const airYardsPg = air / gp;
    const redZonePg = redZone / gp;
    const touchesPg = (rushAtt + targets) / gp;
    const passAttPg = passAtt / gp;
    const comps: Components = {
      targetsPg,
      airYardsPg,
      snapPct: snapPct ?? 0,
      targetShare: targetShare ?? 0,
      airShare: tAir > 0 ? air / tAir : 0,
      redZonePg,
      touchesPg,
      rushAttPg: rushAtt / gp,
      passAttPg,
    };
    pool.push({
      id: row.player_id,
      pos,
      gp,
      pts: { std: s(st, "pts_std"), half: s(st, "pts_half_ppr"), ppr: s(st, "pts_ppr") },
      snapPct,
      targetsPg,
      airYardsPg,
      targetShare,
      redZonePg,
      touchesPg,
      passAttPg,
      comps,
    });
  }

  const out: OpportunityRow[] = [];
  for (const pos of MARKET_POSITIONS) {
    const group = pool.filter((p) => p.pos === pos);
    const weights = WEIGHTS[pos];
    const sortedByKey = new Map<string, number[]>();
    for (const key of Object.keys(weights)) {
      sortedByKey.set(key, group.map((g) => g.comps[key] ?? 0).sort((a, b) => a - b));
    }
    const scored = group.map(({ comps, ...rest }) => {
      let total = 0;
      for (const [key, w] of Object.entries(weights)) {
        total += w * percentile(sortedByKey.get(key) ?? [], comps[key] ?? 0);
      }
      return { ...rest, score: Math.min(99, Math.max(1, Math.round(total))), rank: 0 };
    });
    scored
      .sort((a, b) => b.score - a.score || b.targetsPg + b.touchesPg - (a.targetsPg + a.touchesPg))
      .forEach((r, i) => {
        r.rank = i + 1;
        out.push(r);
      });
  }
  return out;
}

const opportunityForSeason = memo<OpportunityRow[]>(3 * HOUR, async (season) => {
  const rows = await fetchRows(
    `${SLEEPER_BASE}/stats/nfl/${season}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_half_ppr`,
  ).catch(() => [] as SleeperRow[]);
  return buildOpportunity(rows);
});

export async function loadTradeMarket(format: MarketFormat): Promise<TradeMarketPayload> {
  const season = currentSeason();
  const [rows, opportunity] = await Promise.all([
    marketValues(format).catch(() => [] as MarketRow[]),
    opportunityForSeason(season).catch(() => [] as OpportunityRow[]),
  ]);
  return { format, season, rows, opportunity };
}

type FcImplied = { historicalValues?: { date?: string; value?: number }[] };

const HISTORY_CONCURRENCY = 4;
let historyActive = 0;
const historyQueue: (() => void)[] = [];

async function withHistorySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (historyActive >= HISTORY_CONCURRENCY) {
    await new Promise<void>((resolve) => historyQueue.push(resolve));
  }
  historyActive++;
  try {
    return await fn();
  } finally {
    historyActive--;
    historyQueue.shift()?.();
  }
}

const marketHistory = memo<MarketHistoryPoint[]>(6 * HOUR, async (key) => {
  const [fcId, format] = key.split(":");
  const ppr = PPR_PARAM[(format as MarketFormat) ?? "half"] ?? "0.5";
  const url = `${FC_BASE}/trades/implied/${encodeURIComponent(fcId ?? "")}?isDynasty=false&numQbs=1&numTeams=12&ppr=${ppr}`;
  const json = await withHistorySlot(async () => {
    const first = await fetchJson<FcImplied>(url);
    if (first) return first;
    await new Promise((r) => setTimeout(r, 750));
    return await fetchJson<FcImplied>(url);
  });
  return (json?.historicalValues ?? [])
    .filter((p): p is { date: string; value: number } => typeof p.date === "string" && Number(p.value) > 0)
    .slice(-HISTORY_DAYS)
    .map((p) => ({ date: p.date, value: Number(p.value) }));
});

export async function loadMarketHistory(
  fcId: number,
  format: MarketFormat,
): Promise<MarketHistoryPoint[]> {
  return await marketHistory(`${fcId}:${format}`).catch(() => [] as MarketHistoryPoint[]);
}

/**
 * Browser → CDN/TiDB league matchup boards.
 * Prefer this over Fluid getConnectionMatchups so polls hit edge cache,
 * not Vercel CPU + host APIs. Fluid refresh only when the snap is missing
 * or older than the live freshness window (and the tab is visible).
 */

import type { LeagueWeekMatchups, WeeklyMatchupEntry } from "@/lib/league.server";

type CdnMatchupRow = {
  week?: number;
  team_id: number;
  matchup_id: number | null;
  roster_points: number;
  projected_points: number;
  team_name: string | null;
  owner_name: string | null;
  starters: unknown;
  player_points: unknown;
  platform?: string | null;
  synced_at?: string | null;
};

export type LeagueMatchupsCdnHit = {
  board: LeagueWeekMatchups;
  syncedAtMs: number;
};

const LIVE_MAX_AGE_MS = 90 * 1000;
const lastFluidRefresh = new Map<string, number>();
const FLUID_REFRESH_MIN_MS = 60 * 1000;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function sanitizePlayerId(raw: string | number | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "";
  const asText = String(raw).trim();
  if (asText.startsWith("n:")) return asText;
  const asNum = Number(asText);
  if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(asText)) {
    const truncated = Math.trunc(asNum);
    const abs = Math.abs(truncated);
    if (truncated < 0 && abs >= 16001 && abs <= 16034) return String(truncated);
    return String(abs);
  }
  return asText;
}

function roundPoints(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

function stampWinProbabilities(entries: WeeklyMatchupEntry[]): void {
  const byMatchup = new Map<number, WeeklyMatchupEntry[]>();
  for (const entry of entries) {
    if (entry.matchupId == null) continue;
    const bucket = byMatchup.get(entry.matchupId) ?? [];
    bucket.push(entry);
    byMatchup.set(entry.matchupId, bucket);
  }
  for (const pair of byMatchup.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    if (!a || !b) continue;
    const mine = a.projectedPoints;
    const opp = b.projectedPoints;
    const total = Math.abs(mine) + Math.abs(opp);
    if (total <= 0) {
      a.winProbabilityPct = 50;
      b.winProbabilityPct = 50;
      continue;
    }
    const pct = Math.max(1, Math.min(99, Math.round((mine / (mine + opp || 1)) * 100)));
    a.winProbabilityPct = pct;
    b.winProbabilityPct = 100 - pct;
  }
}

function boardFromRows(week: number, rows: CdnMatchupRow[]): LeagueMatchupsCdnHit | null {
  if (!rows.length) return null;
  const platform = String(rows[0]?.platform ?? "sleeper")
    .trim()
    .toLowerCase();
  const source = platform === "espn" ? "espn" : platform === "yahoo" ? "yahoo" : "sleeper";
  let syncedAtMs = 0;
  const entries: WeeklyMatchupEntry[] = rows.map((row) => {
    const at = row.synced_at ? Date.parse(String(row.synced_at)) : 0;
    if (Number.isFinite(at)) syncedAtMs = Math.max(syncedAtMs, at);
    const starters = parseJson<string[]>(row.starters, []).map((id) => sanitizePlayerId(id));
    const playerPoints: Record<string, number> = {};
    for (const [rawId, pts] of Object.entries(parseJson<Record<string, number>>(row.player_points, {}))) {
      const key = sanitizePlayerId(rawId);
      if (!key) continue;
      playerPoints[key] = roundPoints(Number(pts) || 0);
    }
    const playerIdSet = new Set<string>([...starters.filter(Boolean), ...Object.keys(playerPoints)]);
    return {
      rosterId: Number(row.team_id),
      matchupId: row.matchup_id == null ? null : Number(row.matchup_id),
      points: roundPoints(Number(row.roster_points) || 0),
      projectedPoints: roundPoints(Number(row.projected_points) || 0),
      winProbabilityPct: null,
      teamName: row.team_name?.trim() || `Team ${row.team_id}`,
      owner: row.owner_name?.trim() || "",
      logo: null,
      starters,
      playerIds: [...playerIdSet],
      irIds: [],
      playerPoints,
    };
  });
  stampWinProbabilities(entries);
  return { board: { week, entries, source }, syncedAtMs };
}

async function fetchCdnMatchupRows(
  leagueId: string,
  week?: number | null,
): Promise<CdnMatchupRow[]> {
  const qs = new URLSearchParams({ view: "matchups" });
  if (week != null && week > 0) qs.set("week", String(week));
  try {
    const res = await fetch(`/api/data/league/${encodeURIComponent(leagueId)}?${qs}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { matchups?: CdnMatchupRow[] };
    return Array.isArray(json.matchups) ? json.matchups : [];
  } catch {
    return [];
  }
}

/** One week board from CDN/TiDB (null on miss). */
export async function fetchLeagueWeekMatchupsCdn(
  leagueId: string,
  week: number,
): Promise<LeagueMatchupsCdnHit | null> {
  const rows = await fetchCdnMatchupRows(leagueId, week);
  return boardFromRows(week, rows);
}

/** All stored weeks for analytics (one CDN hit, split client-side). */
export async function fetchLeagueAllMatchupsCdn(
  leagueId: string,
): Promise<Map<number, LeagueMatchupsCdnHit>> {
  const rows = await fetchCdnMatchupRows(leagueId, null);
  const byWeek = new Map<number, CdnMatchupRow[]>();
  for (const row of rows) {
    const week = Math.max(1, Number(row.week) || 0);
    if (!week) continue;
    const bucket = byWeek.get(week) ?? [];
    bucket.push(row);
    byWeek.set(week, bucket);
  }
  const out = new Map<number, LeagueMatchupsCdnHit>();
  for (const [week, weekRows] of byWeek) {
    const hit = boardFromRows(week, weekRows);
    if (hit) out.set(week, hit);
  }
  return out;
}

export function isLiveMatchupFresh(syncedAtMs: number, now = Date.now()): boolean {
  return syncedAtMs > 0 && now - syncedAtMs <= LIVE_MAX_AGE_MS;
}

/**
 * Optionally kick Fluid once to refresh host → TiDB when CDN is cold/stale.
 * Throttled + caller must only invoke when the tab is visible.
 */
export async function maybeRefreshMatchupsViaFluid(input: {
  leagueId: string;
  week: number;
  platform: string;
  s2?: string;
  swid?: string;
  connectionId?: string;
  allow: boolean;
}): Promise<LeagueWeekMatchups | null> {
  if (!input.allow) return null;
  const key = `${input.leagueId}|${input.week}`;
  const now = Date.now();
  const prev = lastFluidRefresh.get(key) ?? 0;
  if (now - prev < FLUID_REFRESH_MIN_MS) return null;
  lastFluidRefresh.set(key, now);
  try {
    const { getConnectionMatchups } = await import("@/lib/league.functions");
    return await getConnectionMatchups({
      data: {
        identifier: input.leagueId,
        platform: input.platform,
        week: input.week,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      },
    });
  } catch {
    return null;
  }
}

/**
 * Browser → Sleeper public league matchup boards (schedule + scores).
 * Prefer this over Fluid for Sleeper so future-week schedules and cold
 * TiDB weeks use the visitor's rate-limit pool instead of Vercel CPU.
 *
 * Live current-week polls bypass the long IndexedDB TTL so scores move
 * every ~30–45s without burning Fluid.
 */

import type { LeagueWeekMatchups, WeeklyMatchupEntry } from "@/lib/league.server";
import { getCached, writeCache } from "@/lib/sleeper-cache";
import { acquireSleeperPermit, waitForSleeperPermit } from "@/lib/sleeper-rate-budget";

const SLEEPER = "https://api.sleeper.app/v1";
/** In-memory ceiling for live score polls (network floor). */
const LIVE_MEMORY_TTL_MS = 20 * 1000;

function sleeperAvatar(id: string | null | undefined): string | null {
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
}

async function sleeperJson<T>(url: string, kind: "live" | "warm" | "default"): Promise<T | null> {
  const ok =
    kind === "live" ? acquireSleeperPermit("live") : await waitForSleeperPermit(kind, 4_000);
  if (!ok) return null;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
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

type RosterRow = {
  roster_id: number;
  owner_id: string | null;
  reserve?: string[] | null;
};

type UserRow = {
  user_id: string;
  display_name: string;
  avatar?: string | null;
  metadata?: { team_name?: string; avatar?: string };
};

type MatchupRow = {
  roster_id?: number;
  matchup_id?: number | null;
  points?: number;
  starters?: (string | null)[] | null;
  players?: (string | null)[] | null;
  players_points?: Record<string, number> | null;
  starters_points?: unknown[] | null;
};

function roundHundredths(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadLeagueMeta(leagueId: string): Promise<{
  metaByRoster: Map<number, { teamName: string; owner: string; logo: string | null }>;
  reserveByRoster: Map<number, string[]>;
} | null> {
  return getCached(`sleeper-matchup-meta-v1:${leagueId}`, 10 * 60 * 1000, async () => {
    const [rosters, users] = await Promise.all([
      sleeperJson<RosterRow[]>(`${SLEEPER}/league/${leagueId}/rosters`, "warm"),
      sleeperJson<UserRow[]>(`${SLEEPER}/league/${leagueId}/users`, "warm"),
    ]);
    if (!rosters?.length) return null;
    const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
    const metaByRoster = new Map<number, { teamName: string; owner: string; logo: string | null }>();
    const reserveByRoster = new Map<number, string[]>();
    for (const r of rosters) {
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      const metaAvatar = u?.metadata?.avatar?.trim() || null;
      const logo =
        (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
        sleeperAvatar(u?.avatar) ||
        null;
      metaByRoster.set(r.roster_id, {
        teamName: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
        owner: u?.display_name ?? "",
        logo,
      });
      reserveByRoster.set(
        r.roster_id,
        (r.reserve ?? []).map((p) => String(p)).filter(Boolean),
      );
    }
    return { metaByRoster, reserveByRoster };
  });
}

function buildEntries(
  rows: MatchupRow[],
  metaByRoster: Map<number, { teamName: string; owner: string; logo: string | null }>,
  reserveByRoster: Map<number, string[]>,
  attachLiveReserve: boolean,
): WeeklyMatchupEntry[] {
  return rows
    .map((row) => {
      const rosterId = Number(row.roster_id ?? 0);
      const meta = metaByRoster.get(rosterId);
      const matchupRaw = row.matchup_id;
      const matchupId =
        matchupRaw == null || Number.isNaN(Number(matchupRaw)) ? null : Number(matchupRaw);
      const playerPoints: Record<string, number> = {};
      if (row.players_points && typeof row.players_points === "object") {
        for (const [pid, pts] of Object.entries(row.players_points)) {
          playerPoints[String(pid)] = Number(pts) || 0;
        }
      }
      const starters = (Array.isArray(row.starters) ? row.starters : []).map((id) =>
        id && id !== "0" ? String(id) : "",
      );
      const starterPoints = Array.isArray(row.starters_points) ? row.starters_points : [];
      starters.forEach((id, i) => {
        if (!id || id in playerPoints) return;
        const pts = Number(starterPoints[i]);
        if (Number.isFinite(pts)) playerPoints[id] = pts;
      });
      const fromPlayers = (Array.isArray(row.players) ? row.players : [])
        .map((id) => (id && id !== "0" ? String(id) : ""))
        .filter(Boolean);
      const playerIds = [
        ...new Set([...fromPlayers, ...starters.filter(Boolean), ...Object.keys(playerPoints)]),
      ];
      const irIds = attachLiveReserve
        ? (reserveByRoster.get(rosterId) ?? []).filter((id) => playerIds.includes(id))
        : [];
      return {
        rosterId,
        matchupId,
        points: roundHundredths(Number(row.points ?? 0)),
        projectedPoints: 0,
        winProbabilityPct: null,
        teamName: meta?.teamName ?? `Team ${rosterId}`,
        owner: meta?.owner ?? "",
        logo: meta?.logo ?? null,
        starters,
        playerIds,
        irIds,
        playerPoints,
      };
    })
    .filter((e) => e.rosterId > 0);
}

const liveMemory = new Map<string, { at: number; board: LeagueWeekMatchups }>();

async function buildBoard(
  leagueId: string,
  safeWeek: number,
  currentWeek: number | null | undefined,
  kind: "live" | "warm",
): Promise<LeagueWeekMatchups | null> {
  const [meta, rows] = await Promise.all([
    loadLeagueMeta(leagueId),
    sleeperJson<MatchupRow[]>(`${SLEEPER}/league/${leagueId}/matchups/${safeWeek}`, kind),
  ]);
  if (!meta || !rows?.length) return null;
  const attachLiveReserve = currentWeek == null || safeWeek >= currentWeek;
  const entries = buildEntries(rows, meta.metaByRoster, meta.reserveByRoster, attachLiveReserve);
  if (entries.length < 2) return null;
  return { week: safeWeek, entries, source: "sleeper" as const };
}

export type SleeperMatchupsClientOpts = {
  /**
   * `live` — network fetch for current-week scores (≤20s memory cache).
   * `warm` — IndexedDB-backed schedule/history fill (minutes TTL).
   */
  mode?: "live" | "warm";
};

/**
 * One week of public Sleeper matchups for a numeric league id.
 * Works for completed (scored) and future (schedule-only) weeks.
 */
export async function fetchSleeperWeekMatchupsClient(
  leagueId: string,
  week: number,
  currentWeek?: number | null,
  opts?: SleeperMatchupsClientOpts,
): Promise<LeagueWeekMatchups | null> {
  const clean = String(leagueId ?? "").trim();
  const safeWeek = Math.max(1, Math.min(18, Math.floor(Number(week) || 0)));
  if (!/^\d{6,}$/.test(clean) || safeWeek < 1) return null;

  const mode = opts?.mode ?? "warm";
  const memKey = `${clean}|${safeWeek}`;

  if (mode === "live") {
    const hit = liveMemory.get(memKey);
    if (hit && Date.now() - hit.at < LIVE_MEMORY_TTL_MS) return hit.board;

    const board = await buildBoard(clean, safeWeek, currentWeek, "live");
    if (!board) return hit?.board ?? null;
    liveMemory.set(memKey, { at: Date.now(), board });
    // Refresh the warm cache so other surfaces see fresher scores.
    void writeCache(`sleeper-matchups-v1:${clean}|${safeWeek}`, board).catch(() => undefined);
    return board;
  }

  const ttlMs =
    currentWeek != null && safeWeek < currentWeek ? 30 * 60 * 1000 : 5 * 60 * 1000;

  return getCached<LeagueWeekMatchups | { empty: true }>(
    `sleeper-matchups-v1:${clean}|${safeWeek}`,
    ttlMs,
    async () => {
      const board = await buildBoard(clean, safeWeek, currentWeek, "warm");
      if (!board) return { empty: true as const };
      return board;
    },
  ).then((hit) => (hit && !("empty" in hit) ? hit : null));
}

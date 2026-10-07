/**
 * Browser Sleeper War Room sync (user leagues + roster/settings pull).
 * Prefer over Fluid getUserLeagues / getLeagueSync so opening Draft does not
 * burn Vercel Active CPU — each visitor uses their own Sleeper rate-limit pool.
 */

import type { LeagueSummary, LeagueSync, RosterSlotCounts } from "@/lib/league.server";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";
import { ensureSleeperNumericLeagueId } from "@/lib/sleeper-resolve-client";

const SLEEPER = "https://api.sleeper.app/v1";
const USER_LEAGUES_TTL_MS = 10 * 60 * 1000;
const LEAGUE_SYNC_TTL_MS = 5 * 60 * 1000;

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

function scoringLabel(settings: Record<string, unknown> | null | undefined): string {
  const rec = Number(settings?.["rec"] ?? 0);
  if (rec >= 1) return "Full PPR";
  if (rec > 0) return "Half PPR";
  return "Standard";
}

function scoringKey(settings: Record<string, unknown> | null | undefined): "std" | "half" | "ppr" {
  const rec = Number(settings?.["rec"] ?? 0);
  if (rec >= 1) return "ppr";
  if (rec > 0) return "half";
  return "std";
}

function slotCounts(positions: string[] | undefined): RosterSlotCounts {
  const roster: RosterSlotCounts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0, BENCH: 0 };
  for (const raw of positions ?? []) {
    const p = String(raw).toUpperCase();
    if (p === "QB") roster.QB++;
    else if (p === "RB") roster.RB++;
    else if (p === "WR") roster.WR++;
    else if (p === "TE") roster.TE++;
    else if (p === "K") roster.K++;
    else if (p === "DEF" || p === "DST") roster.DEF++;
    else if (p.includes("FLEX") || p === "SUPER_FLEX" || p === "REC_FLEX") roster.FLEX++;
    else if (p === "BN" || p === "TAXI") roster.BENCH++;
  }
  return roster;
}

/** List NFL leagues for a Sleeper username (browser → api.sleeper.app). */
export async function fetchUserLeaguesPreferred(username: string): Promise<LeagueSummary[]> {
  const clean = username.trim().replace(/^@/, "");
  if (!clean) return [];

  const key = `user-leagues-v1:${clean.toLowerCase()}`;
  const client = await getCached(key, USER_LEAGUES_TTL_MS, async () => {
    const user = await sleeperJson<{ user_id?: string }>(
      `${SLEEPER}/user/${encodeURIComponent(clean)}`,
    );
    if (!user?.user_id) return [] as LeagueSummary[];
    const state = await sleeperJson<{ league_season?: string }>(`${SLEEPER}/state/nfl`);
    const year = state?.league_season ?? String(new Date().getFullYear());
    const seasons = Array.from(new Set([year, String(Number(year) - 1)]));

    const out: LeagueSummary[] = [];
    for (const s of seasons) {
      const leagues = await sleeperJson<
        {
          league_id: string;
          name: string;
          season: string;
          total_rosters: number;
          status: string;
          scoring_settings?: Record<string, unknown>;
        }[]
      >(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${s}`);
      for (const l of leagues ?? []) {
        out.push({
          id: l.league_id,
          name: l.name,
          season: l.season,
          teams: l.total_rosters,
          status: l.status,
          scoring: scoringLabel(l.scoring_settings),
        });
      }
      if (out.length) break;
    }
    return out;
  }).catch(() => [] as LeagueSummary[]);

  if (client.length > 0) return client;
  if (!allowFluidFallback()) return [];

  const { getUserLeagues } = await import("@/lib/league.functions");
  return getUserLeagues({ data: { username: clean } });
}

/** Full War Room sync: settings + rostered players mapped to draft slots. */
export async function fetchLeagueSyncPreferred(input: {
  leagueId: string;
  username?: string;
}): Promise<LeagueSync | null> {
  let leagueId = String(input.leagueId ?? "").trim();
  const username = String(input.username ?? "")
    .trim()
    .replace(/^@/, "");
  if (!leagueId) return null;

  const resolved = await ensureSleeperNumericLeagueId(leagueId).catch(() => null);
  if (resolved) leagueId = resolved;
  else if (!/^\d{6,}$/.test(leagueId)) {
    if (!allowFluidFallback()) return null;
    const { getLeagueSync } = await import("@/lib/league.functions");
    return getLeagueSync({ data: { leagueId, username } });
  }

  const cacheKey = `league-sync-v1:${leagueId}:${username.toLowerCase() || "_"}`;
  const client = await getCached(cacheKey, LEAGUE_SYNC_TTL_MS, async () => {
    const [league, rosters, users] = await Promise.all([
      sleeperJson<{
        league_id: string;
        name: string;
        season: string;
        total_rosters: number;
        status: string;
        draft_id?: string;
        scoring_settings?: Record<string, unknown>;
        roster_positions?: string[];
        settings?: Record<string, number>;
      }>(`${SLEEPER}/league/${leagueId}`),
      sleeperJson<{ roster_id: number; owner_id: string | null; players?: string[] | null }[]>(
        `${SLEEPER}/league/${leagueId}/rosters`,
      ),
      sleeperJson<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(
        `${SLEEPER}/league/${leagueId}/users`,
      ),
    ]);
    if (!league || !rosters) return null;

    const draft = league.draft_id
      ? await sleeperJson<{
          type?: string;
          settings?: { rounds?: number };
          slot_to_roster_id?: Record<string, number>;
        }>(`${SLEEPER}/draft/${league.draft_id}`)
      : null;

    const slotByRoster = new Map<number, number>();
    const s2r = draft?.slot_to_roster_id ?? null;
    if (s2r) {
      for (const [slot, rosterId] of Object.entries(s2r)) {
        slotByRoster.set(Number(rosterId), Number(slot));
      }
    }
    const ordered = [...rosters].sort((a, b) => a.roster_id - b.roster_id);
    ordered.forEach((r, i) => {
      if (!slotByRoster.has(r.roster_id)) slotByRoster.set(r.roster_id, i + 1);
    });

    const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
    const teamNames: Record<string, string> = {};
    const picks: { playerId: string; team: number }[] = [];
    let myTeam: number | null = null;
    const wanted = username.toLowerCase();

    for (const r of ordered) {
      const slot = slotByRoster.get(r.roster_id) ?? r.roster_id;
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      teamNames[String(slot)] = u?.metadata?.team_name?.trim() || u?.display_name || `Team ${slot}`;
      if (wanted && u && u.display_name.toLowerCase() === wanted) myTeam = slot;
      for (const pid of r.players ?? []) picks.push({ playerId: String(pid), team: slot });
    }

    const roster = slotCounts(league.roster_positions);
    const total = Object.values(roster).reduce((a, b) => a + b, 0);
    const teams = league.total_rosters || ordered.length || 12;

    const sync: LeagueSync = {
      league: {
        id: league.league_id,
        name: league.name,
        season: league.season,
        teams,
        status: league.status,
        scoring: scoringLabel(league.scoring_settings),
      },
      teams,
      rounds: total || Number(draft?.settings?.rounds) || 15,
      snake: (draft?.type ?? "snake") !== "linear",
      playoffStartWeek: Number(league.settings?.["playoff_week_start"]) || 15,
      scoring: scoringKey(league.scoring_settings),
      roster,
      teamNames,
      myTeam,
      picks,
    };
    return sync;
  }).catch(() => null);

  if (client) return client;
  if (!allowFluidFallback()) return null;

  const { getLeagueSync } = await import("@/lib/league.functions");
  return getLeagueSync({ data: { leagueId, username } });
}

/**
 * Browser → Sleeper public standings (W/L/PF from roster settings).
 * Prefer this over Fluid getConnectionStandings so each visitor uses their
 * own rate-limit pool and Vercel stays idle.
 */

import type { Standings, StandingRow } from "@/lib/league.server";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";

const SLEEPER = "https://api.sleeper.app/v1";
const STANDINGS_TTL_MS = 5 * 60 * 1000;

function sleeperAvatar(id: string | null | undefined): string | null {
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
}

function normalizeStreak(raw: string | null | undefined): string | null {
  const match = /^\s*(\d+)\s*([WLT])/i.exec(raw ?? "");
  if (!match) return null;
  const count = Number(match[1]);
  return count > 0 ? `${count}${match[2]!.toUpperCase()}` : null;
}

function streakFromRecord(record: string | null | undefined): string | null {
  const results = (record ?? "").toUpperCase().replace(/[^WLT]/g, "");
  const last = results.at(-1);
  if (!last) return null;
  let count = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i -= 1) count += 1;
  return `${count}${last}`;
}

function scoringLabel(settings: Record<string, unknown> | null | undefined): string {
  const rec = Number(settings?.["rec"] ?? 0);
  if (rec >= 1) return "Full PPR";
  if (rec > 0) return "Half PPR";
  return "Standard";
}

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

/** True when standings can load without Fluid credentials. */
export function canFetchStandingsClient(platform: string, leagueId: string): boolean {
  return (
    String(platform ?? "")
      .trim()
      .toLowerCase() === "sleeper" && /^\d{6,}$/.test(String(leagueId ?? "").trim())
  );
}

/**
 * Public Sleeper league standings for a known league id.
 * Mirrors server `loadStandings` so Playbook / mobile stay populated without Fluid.
 */
export async function fetchSleeperStandingsClient(leagueId: string): Promise<Standings | null> {
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return null;

  return getCached<Standings | null>(`sleeper-standings-v1:${clean}`, STANDINGS_TTL_MS, async () => {
    const [league, rosters, users] = await Promise.all([
      sleeperJson<{
        league_id: string;
        name: string;
        season: string;
        total_rosters: number;
        status: string;
        scoring_settings?: Record<string, unknown>;
      }>(`${SLEEPER}/league/${clean}`),
      sleeperJson<
        {
          roster_id: number;
          owner_id: string | null;
          settings?: Record<string, number | string | undefined>;
          metadata?: { streak?: string | null; record?: string | null } | null;
        }[]
      >(`${SLEEPER}/league/${clean}/rosters`),
      sleeperJson<
        {
          user_id: string;
          display_name: string;
          avatar: string | null;
          metadata?: { team_name?: string; avatar?: string };
        }[]
      >(`${SLEEPER}/league/${clean}/users`),
    ]);

    if (!league || !rosters?.length) return null;
    const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));

    const rows: StandingRow[] = rosters.map((r) => {
      const s = r.settings ?? {};
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      const pf = Number(s["fpts"] ?? 0) + Number(s["fpts_decimal"] ?? 0) / 100;
      const pa = Number(s["fpts_against"] ?? 0) + Number(s["fpts_against_decimal"] ?? 0) / 100;
      const metaAvatar = u?.metadata?.avatar?.trim() || null;
      const avatar =
        (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
        sleeperAvatar(u?.avatar) ||
        null;
      return {
        rosterId: r.roster_id,
        team: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
        owner: u?.display_name ?? "Unclaimed",
        avatar,
        wins: Number(s["wins"] ?? 0),
        losses: Number(s["losses"] ?? 0),
        ties: Number(s["ties"] ?? 0),
        pointsFor: Math.round(pf * 10) / 10,
        pointsAgainst: Math.round(pa * 10) / 10,
        streak: normalizeStreak(r.metadata?.streak) ?? streakFromRecord(r.metadata?.record),
      };
    });

    rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor);

    return {
      league: {
        id: league.league_id,
        name: league.name,
        season: league.season,
        teams: league.total_rosters,
        status: league.status,
        scoring: scoringLabel(league.scoring_settings),
      },
      rows,
    };
  });
}

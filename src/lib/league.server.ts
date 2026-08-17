const BASE = "https://api.sleeper.app/v1";

export type LeagueSummary = {
  id: string;
  name: string;
  season: string;
  teams: number;
  status: string;
  scoring: string;
};

export type StandingRow = {
  rosterId: number;
  team: string;
  owner: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string | null;
};

export type Standings = {
  league: LeagueSummary;
  rows: StandingRow[];
};

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function scoringLabel(settings: Record<string, unknown> | null | undefined): string {
  const rec = Number(settings?.["rec"] ?? 0);
  if (rec >= 1) return "Full PPR";
  if (rec > 0) return "Half PPR";
  return "Standard";
}

export async function loadUserLeagues(username: string, season?: string): Promise<LeagueSummary[]> {
  const clean = username.trim().replace(/^@/, "");
  if (!clean) return [];
  const user = await json<{ user_id?: string }>(`${BASE}/user/${encodeURIComponent(clean)}`);
  if (!user?.user_id) return [];
  const state = await json<{ league_season?: string }>(`${BASE}/state/nfl`);
  const year = season ?? state?.league_season ?? String(new Date().getFullYear());
  const seasons = Array.from(new Set([year, String(Number(year) - 1)]));

  const out: LeagueSummary[] = [];
  for (const s of seasons) {
    const leagues = await json<
      { league_id: string; name: string; season: string; total_rosters: number; status: string; scoring_settings?: Record<string, unknown> }[]
    >(`${BASE}/user/${user.user_id}/leagues/nfl/${s}`);
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
}

export async function loadStandings(leagueId: string): Promise<Standings | null> {
  const id = leagueId.trim();
  if (!/^\d+$/.test(id)) return null;

  const [league, rosters, users] = await Promise.all([
    json<{
      league_id: string;
      name: string;
      season: string;
      total_rosters: number;
      status: string;
      scoring_settings?: Record<string, unknown>;
    }>(`${BASE}/league/${id}`),
    json<
      {
        roster_id: number;
        owner_id: string | null;
        settings?: Record<string, number | string | undefined>;
      }[]
    >(`${BASE}/league/${id}/rosters`),
    json<{ user_id: string; display_name: string; avatar: string | null; metadata?: { team_name?: string } }[]>(
      `${BASE}/league/${id}/users`,
    ),
  ]);

  if (!league || !rosters) return null;
  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));

  const rows: StandingRow[] = rosters.map((r) => {
    const s = r.settings ?? {};
    const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
    const pf = Number(s["fpts"] ?? 0) + Number(s["fpts_decimal"] ?? 0) / 100;
    const pa = Number(s["fpts_against"] ?? 0) + Number(s["fpts_against_decimal"] ?? 0) / 100;
    return {
      rosterId: r.roster_id,
      team: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
      owner: u?.display_name ?? "Unclaimed",
      avatar: u?.avatar ?? null,
      wins: Number(s["wins"] ?? 0),
      losses: Number(s["losses"] ?? 0),
      ties: Number(s["ties"] ?? 0),
      pointsFor: Math.round(pf * 10) / 10,
      pointsAgainst: Math.round(pa * 10) / 10,
      streak: (s["streak"] as string | undefined) ?? null,
    };
  });

  rows.sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor,
  );

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
}

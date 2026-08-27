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

// ---------------------------------------------------------------------------
// League sync: pull roster slots, scoring, team names and rostered players
// ---------------------------------------------------------------------------

export type RosterSlotCounts = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  K: number;
  DEF: number;
  BENCH: number;
};

export type LeagueSync = {
  league: LeagueSummary;
  teams: number;
  rounds: number;
  snake: boolean;
  scoring: "std" | "half" | "ppr";
  roster: RosterSlotCounts;
  /** 1-based draft slot -> team name */
  teamNames: Record<string, string>;
  /** 1-based draft slot for the linked user, if found */
  myTeam: number | null;
  /** rostered players, mapped to a 1-based draft slot */
  picks: { playerId: string; team: number }[];
};

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
    else if (p === "BN" || p === "TAXI" || p === "IR") roster.BENCH++;
  }
  return roster;
}

export async function loadLeagueSync(leagueId: string, username?: string): Promise<LeagueSync | null> {
  const id = leagueId.trim();
  if (!/^\d+$/.test(id)) return null;

  const [league, rosters, users] = await Promise.all([
    json<{
      league_id: string;
      name: string;
      season: string;
      total_rosters: number;
      status: string;
      draft_id?: string;
      scoring_settings?: Record<string, unknown>;
      roster_positions?: string[];
      settings?: Record<string, number>;
    }>(`${BASE}/league/${id}`),
    json<{ roster_id: number; owner_id: string | null; players?: string[] | null }[]>(
      `${BASE}/league/${id}/rosters`,
    ),
    json<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(
      `${BASE}/league/${id}/users`,
    ),
  ]);
  if (!league || !rosters) return null;

  const draft = league.draft_id
    ? await json<{
        type?: string;
        settings?: { rounds?: number };
        slot_to_roster_id?: Record<string, number>;
      }>(`${BASE}/draft/${league.draft_id}`)
    : null;

  // Map roster_id -> 1-based draft slot (fall back to roster order).
  const slotByRoster = new Map<number, number>();
  const s2r = draft?.slot_to_roster_id ?? null;
  if (s2r) {
    for (const [slot, rosterId] of Object.entries(s2r)) slotByRoster.set(Number(rosterId), Number(slot));
  }
  const ordered = [...rosters].sort((a, b) => a.roster_id - b.roster_id);
  ordered.forEach((r, i) => {
    if (!slotByRoster.has(r.roster_id)) slotByRoster.set(r.roster_id, i + 1);
  });

  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const teamNames: Record<string, string> = {};
  const picks: { playerId: string; team: number }[] = [];
  let myTeam: number | null = null;
  const wanted = (username ?? "").trim().replace(/^@/, "").toLowerCase();

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

  return {
    league: {
      id: league.league_id,
      name: league.name,
      season: league.season,
      teams,
      status: league.status,
      scoring: scoringLabel(league.scoring_settings),
    },
    teams,
    rounds: draft?.settings?.rounds ?? total ?? 15,
    snake: (draft?.type ?? "snake") !== "linear",
    scoring: scoringKey(league.scoring_settings),
    roster,
    teamNames,
    myTeam,
    picks,
  };
}

// ---------------------------------------------------------------------------
// Connection metadata: league title, the user's team name, avatar
// ---------------------------------------------------------------------------

export type ConnectionMeta = {
  leagueName: string | null;
  teamName: string | null;
  avatar: string | null;
  scoring: string | null;
  teams: number | null;
};

function sleeperAvatar(id: string | null | undefined) {
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null;
}

// ---------------------------------------------------------------------------
// ESPN public league metadata
// ---------------------------------------------------------------------------

type EspnTeam = {
  id?: number;
  name?: string;
  location?: string;
  nickname?: string;
  logo?: string;
  abbrev?: string;
  owners?: string[];
};

type EspnLeagueView = {
  settings?: { name?: string; size?: number; scoringSettings?: { scoringItems?: { statId?: number; points?: number }[] } };
  teams?: EspnTeam[];
  members?: { id?: string }[];
};

function espnTeamName(t: EspnTeam | undefined): string | null {
  if (!t) return null;
  const named = t.name?.trim();
  if (named) return named;
  const loc = t.location?.trim() ?? "";
  const nick = t.nickname?.trim() ?? "";
  const combined = `${loc} ${nick}`.trim();
  return combined || null;
}

function espnSwidCookie(swid: string | null | undefined): string | null {
  const raw = swid?.trim();
  if (!raw) return null;
  const bare = raw.replace(/[{}]/g, "");
  return `{${bare.toUpperCase()}}`;
}

async function espnJson<T>(url: string, s2?: string | null, swid?: string | null): Promise<T | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    };
    const cookieSwid = espnSwidCookie(swid);
    if (s2 || cookieSwid) {
      const parts: string[] = [];
      if (s2) parts.push(`espn_s2=${s2.trim()}`);
      if (cookieSwid) parts.push(`SWID=${cookieSwid}`);
      headers["Cookie"] = `${parts.join("; ")};`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadEspnConnectionMeta(
  leagueId: string,
  s2?: string | null,
  swid?: string | null,
): Promise<ConnectionMeta> {
  const empty: ConnectionMeta = { leagueName: null, teamName: null, avatar: null, scoring: null, teams: null };
  const id = leagueId.trim();
  if (!/^\d+$/.test(id)) return empty;
  const season = new Date().getFullYear();
  const swidGuid = swid?.trim().replace(/[{}]/g, "").toUpperCase() ?? null;

  for (const year of [season, season - 1]) {
    const league = await espnJson<EspnLeagueView>(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(id)}?view=mSettings&view=mTeam`,
      s2,
      swid,
    );
    const teams = league?.teams ?? [];
    if (!league?.settings || teams.length === 0) continue;

    // Identify the user's own team by matching the stored SWID guid against
    // every owner-ish identifier ESPN exposes on a team row.
    const matchesSwid = (t: EspnTeam) => {
      if (!swidGuid) return false;
      const candidates: (string | undefined)[] = [
        ...(t.owners ?? []),
        t.primaryOwner,
        t.swid,
      ];
      return candidates.some((c) => c && c.replace(/[{}]/g, "").toUpperCase() === swidGuid);
    };
    const mine = teams.find(matchesSwid) ?? teams[0];
    const rec = league.settings?.scoringSettings?.scoringItems?.find((s) => s.statId === 53)?.points ?? null;
    return {
      leagueName: league.settings?.name ?? null,
      teamName: espnTeamName(mine),
      avatar: mine?.logo ?? null,
      scoring: rec == null ? null : rec >= 1 ? "Full PPR" : rec > 0 ? "Half PPR" : "Standard",
      teams: league.settings?.size ?? teams.length,
    };
  }
  return empty;
}

export async function loadConnectionMeta(identifier: string): Promise<ConnectionMeta> {
  const clean = identifier.trim().replace(/^@/, "");
  const empty: ConnectionMeta = {
    leagueName: null,
    teamName: null,
    avatar: null,
    scoring: null,
    teams: null,
  };
  if (!clean) return empty;

  let leagueId: string | null = null;
  let userId: string | null = null;

  if (/^\d{6,}$/.test(clean)) {
    leagueId = clean;
  } else {
    const user = await json<{ user_id?: string; avatar?: string | null }>(
      `${BASE}/user/${encodeURIComponent(clean)}`,
    );
    if (!user?.user_id) return empty;
    userId = user.user_id;
    const leagues = await loadUserLeagues(clean);
    leagueId = leagues[0]?.id ?? null;
    if (!leagueId) return { ...empty, avatar: sleeperAvatar(user.avatar) };
  }

  const [league, users] = await Promise.all([
    json<{
      name: string;
      avatar?: string | null;
      total_rosters?: number;
      scoring_settings?: Record<string, unknown>;
    }>(`${BASE}/league/${leagueId}`),
    json<
      { user_id: string; display_name: string; avatar: string | null; metadata?: { team_name?: string; avatar?: string } }[]
    >(`${BASE}/league/${leagueId}/users`),
  ]);

  const me = userId ? (users ?? []).find((u) => u.user_id === userId) : undefined;

  return {
    leagueName: league?.name ?? null,
    teamName: me?.metadata?.team_name?.trim() || me?.display_name || null,
    avatar:
      me?.metadata?.avatar ||
      sleeperAvatar(me?.avatar) ||
      sleeperAvatar(league?.avatar) ||
      null,
    scoring: league ? scoringLabel(league.scoring_settings) : null,
    teams: league?.total_rosters ?? null,
  };
}

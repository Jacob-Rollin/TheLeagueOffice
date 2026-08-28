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
  /** First week of the fantasy playoffs. */
  playoffStartWeek: number;
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
    // Only standard bench / taxi slots count toward draft bench. IR is explicitly
    // excluded because injured-reserve spots are not picked during a draft.
    else if (p === "BN" || p === "TAXI") roster.BENCH++;
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
  // Draft rounds = starters + regular bench only. IR is already excluded from
  // the slot counts above, so this total is the correct draft capacity.
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
    rounds: total || Number(draft?.settings?.rounds) || 15,
    snake: (draft?.type ?? "snake") !== "linear",
    playoffStartWeek: Number(league.settings?.["playoff_week_start"]) || 15,
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
  primaryOwner?: string;
  swid?: string;
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

// ---------------------------------------------------------------------------
// Standings resolved straight from a saved league connection
// ---------------------------------------------------------------------------

/** Resolve the standings table for a stored connection identifier. */
export async function loadConnectionStandings(
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<Standings | null> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return null;

  if (platform === "espn") {
    const season = new Date().getFullYear();
    if (!/^\d+$/.test(clean)) return null;
    for (const year of [season, season - 1]) {
      type EspnRecordTeam = EspnTeam & {
        record?: {
          overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number };
        };
      };
      const league = await espnJson<{
        settings?: EspnLeagueView["settings"];
        teams?: EspnRecordTeam[];
      }>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mSettings&view=mTeam`,
        s2,
        swid,
      );
      const teams = league?.teams ?? [];
      if (!league?.settings || teams.length === 0) continue;
      const rows: StandingRow[] = teams.map((t, i) => {
        const o = t.record?.overall ?? {};
        return {
          rosterId: t.id ?? i + 1,
          team: espnTeamName(t) ?? `Team ${i + 1}`,
          owner: t.abbrev ?? "",
          avatar: t.logo ?? null,
          wins: Number(o.wins ?? 0),
          losses: Number(o.losses ?? 0),
          ties: Number(o.ties ?? 0),
          pointsFor: Math.round(Number(o.pointsFor ?? 0) * 10) / 10,
          pointsAgainst: Math.round(Number(o.pointsAgainst ?? 0) * 10) / 10,
          streak: null,
        };
      });
      rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor);
      return {
        league: {
          id: clean,
          name: league.settings?.name ?? "ESPN League",
          season: String(year),
          teams: league.settings?.size ?? teams.length,
          status: "in_season",
          scoring: "",
        },
        rows,
      };
    }
    return null;
  }

  // Sleeper: identifier may be a league id or a user id / username.
  if (/^\d{6,}$/.test(clean)) {
    const direct = await loadStandings(clean);
    if (direct) return direct;
    const leagues = await json<
      { league_id: string; name: string; season: string; total_rosters: number; status: string }[]
    >(`${BASE}/user/${clean}/leagues/nfl/${new Date().getFullYear()}`);
    const first = leagues?.[0]?.league_id;
    return first ? await loadStandings(first) : null;
  }
  const leagues = await loadUserLeagues(clean);
  const first = leagues[0]?.id;
  return first ? await loadStandings(first) : null;
}

// ---------------------------------------------------------------------------
// Draft settings resolved from a saved league connection
// ---------------------------------------------------------------------------

export type ConnectionSync = {
  teams: number;
  rounds: number;
  myTeam: number;
  scoring: "std" | "half" | "ppr";
  snake: boolean;
  roster: RosterSlotCounts;
  teamNames: Record<string, string>;
};

// ESPN lineup slot IDs. IR (21) is intentionally omitted from draft counts.
type EspnRosterSettings = {
  settings?: {
    rosterSettings?: {
      lineupSlotCounts?: Record<string, number>;
    };
  };
};

function espnSlotCounts(lineupSlotCounts: Record<string, number> | undefined): RosterSlotCounts {
  const roster: RosterSlotCounts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0, BENCH: 0 };
  if (!lineupSlotCounts) return roster;
  for (const [raw, count] of Object.entries(lineupSlotCounts)) {
    const id = Number(raw);
    const c = Number(count) || 0;
    if (id === 0) roster.QB += c;
    else if (id === 2) roster.RB += c;
    else if (id === 4) roster.WR += c;
    else if (id === 6) roster.TE += c;
    else if (id === 17) roster.K += c;
    else if (id === 16) roster.DEF += c;
    else if (id === 23) roster.FLEX += c;
    else if (id === 20) roster.BENCH += c;
    // id === 21 is IR; explicitly excluded because IR spots are not drafted.
  }
  return roster;
}

/** Resolve draft-room settings for a stored connection identifier. */
export async function loadConnectionSync(
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<ConnectionSync | null> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return null;

  if (platform === "espn") {
    const [standings, meta] = await Promise.all([
      loadConnectionStandings(clean, "espn", s2, swid),
      loadEspnConnectionMeta(clean, s2, swid),
    ]);
    const rows = standings?.rows ?? [];
    if (!rows.length) return null;
    const teamNames: Record<string, string> = {};
    rows.forEach((r, i) => {
      teamNames[String(i + 1)] = r.team;
    });
    const mineIdx = meta.teamName ? rows.findIndex((r) => r.team === meta.teamName) : -1;

    // Pull real roster slot counts from ESPN settings, excluding IR.
    const season = new Date().getFullYear();
    let roster: RosterSlotCounts = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 };
    for (const year of [season, season - 1]) {
      const settings = await espnJson<EspnRosterSettings>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mSettings`,
        s2,
        swid,
      );
      const counts = settings?.settings?.rosterSettings?.lineupSlotCounts;
      if (counts) {
        roster = espnSlotCounts(counts);
        break;
      }
    }

    const scoring =
      meta.scoring === "Full PPR" ? "ppr" : meta.scoring === "Half PPR" ? "half" : "std";
    return {
      teams: rows.length,
      rounds: Object.values(roster).reduce((a, b) => a + b, 0),
      myTeam: mineIdx === -1 ? 1 : mineIdx + 1,
      scoring,
      snake: true,
      roster,
      teamNames,
    };
  }

  // Sleeper: identifier may be a league id or a user id / username.
  let leagueId: string | null = null;
  let username: string | undefined;
  if (/^\d{6,}$/.test(clean)) {
    const direct = await loadStandings(clean);
    if (direct) leagueId = clean;
    else {
      const leagues = await json<{ league_id: string }[]>(
        `${BASE}/user/${clean}/leagues/nfl/${new Date().getFullYear()}`,
      );
      leagueId = leagues?.[0]?.league_id ?? null;
    }
  } else {
    username = clean;
    const leagues = await loadUserLeagues(clean);
    leagueId = leagues[0]?.id ?? null;
  }
  if (!leagueId) return null;

  const sync = await loadLeagueSync(leagueId, username);
  if (!sync) return null;
  return {
    teams: sync.teams,
    rounds: sync.rounds,
    myTeam: sync.myTeam ?? 1,
    scoring: sync.scoring,
    snake: sync.snake,
    roster: sync.roster,
    teamNames: sync.teamNames,
  };
}

// ---------------------------------------------------------------------------
// Full league rosters resolved from a saved connection
// ---------------------------------------------------------------------------

export type LeagueRosterTeam = {
  slot: number;
  team: string;
  owner: string;
  isMine: boolean;
  /** Sleeper player ids (empty for ESPN). */
  playerIds: string[];
  /** Player full names, used to resolve ESPN rosters against our registry. */
  playerNames: string[];
};

export type LeagueRosters = {
  myTeamName: string | null;
  teams: LeagueRosterTeam[];
};

type EspnRosterView = {
  settings?: { name?: string; size?: number };
  teams?: (EspnTeam & {
    roster?: {
      entries?: {
        playerId?: number;
        playerPoolEntry?: { player?: { fullName?: string } };
      }[];
    };
  })[];
};

/** Every team in the active league with its current roster. */
export async function loadConnectionRosters(
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<LeagueRosters | null> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return null;

  if (platform === "espn") {
    if (!/^\d+$/.test(clean)) return null;
    const season = new Date().getFullYear();
    const swidGuid = swid?.trim().replace(/[{}]/g, "").toUpperCase() ?? null;
    for (const year of [season, season - 1]) {
      const league = await espnJson<EspnRosterView>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mRoster&view=mTeam&view=mSettings`,
        s2,
        swid,
      );
      const rows = league?.teams ?? [];
      if (!rows.length) continue;
      const matchesSwid = (t: EspnTeam) => {
        if (!swidGuid) return false;
        const candidates: (string | undefined)[] = [...(t.owners ?? []), t.primaryOwner, t.swid];
        return candidates.some((c) => c && c.replace(/[{}]/g, "").toUpperCase() === swidGuid);
      };
      const mineId = (rows.find(matchesSwid) ?? rows[0])?.id;
      const teams: LeagueRosterTeam[] = rows.map((t, i) => ({
        slot: t.id ?? i + 1,
        team: espnTeamName(t) ?? `Team ${i + 1}`,
        owner: t.abbrev ?? "",
        isMine: (t.id ?? i + 1) === mineId,
        playerIds: [],
        playerNames: (t.roster?.entries ?? [])
          .map((e) => e.playerPoolEntry?.player?.fullName ?? "")
          .filter(Boolean),
      }));
      return {
        myTeamName: teams.find((t) => t.isMine)?.team ?? null,
        teams,
      };
    }
    return null;
  }

  // Sleeper: identifier may be a league id, a user id, or a username.
  let leagueId: string | null = null;
  let userId: string | null = null;
  if (/^\d{6,}$/.test(clean)) {
    const direct = await json<{ league_id?: string }>(`${BASE}/league/${clean}`);
    if (direct?.league_id) leagueId = clean;
    else {
      userId = clean;
      const leagues = await json<{ league_id: string }[]>(
        `${BASE}/user/${clean}/leagues/nfl/${new Date().getFullYear()}`,
      );
      leagueId = leagues?.[0]?.league_id ?? null;
    }
  } else {
    const user = await json<{ user_id?: string }>(`${BASE}/user/${encodeURIComponent(clean)}`);
    userId = user?.user_id ?? null;
    const leagues = await loadUserLeagues(clean);
    leagueId = leagues[0]?.id ?? null;
  }
  if (!leagueId) return null;

  const [rosters, users] = await Promise.all([
    json<{ roster_id: number; owner_id: string | null; players?: string[] | null }[]>(
      `${BASE}/league/${leagueId}/rosters`,
    ),
    json<
      { user_id: string; display_name: string; metadata?: { team_name?: string } }[]
    >(`${BASE}/league/${leagueId}/users`),
  ]);
  if (!rosters?.length) return null;

  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const ordered = [...rosters].sort((a, b) => a.roster_id - b.roster_id);
  const teams: LeagueRosterTeam[] = ordered.map((r, i) => {
    const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
    return {
      slot: r.roster_id ?? i + 1,
      team: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${i + 1}`,
      owner: u?.display_name ?? "",
      isMine: Boolean(userId && r.owner_id === userId),
      playerIds: (r.players ?? []).map((p) => String(p)),
      playerNames: [],
    };
  });

  return {
    myTeamName: teams.find((t) => t.isMine)?.team ?? null,
    teams,
  };
}

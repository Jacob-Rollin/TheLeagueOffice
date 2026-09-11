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
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
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
  /** First week of the fantasy playoffs in the synced league. */
  playoffStartWeek: number;
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
      playoffStartWeek: 15,
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
    playoffStartWeek: sync.playoffStartWeek,
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
  /** Host platform team logo / avatar URL when available. */
  logo: string | null;
  /** Sleeper player ids (empty for ESPN). */
  playerIds: string[];
  /** Player full names, used to resolve ESPN rosters against our registry. */
  playerNames: string[];
  /** Native starter order as configured by the manager on the host platform. */
  starterIds: string[];
  starterNames: string[];
  /** Players parked in a designated IR / IL slot on the host platform. */
  irIds: string[];
  irNames: string[];
};

export type LeagueRosters = {
  myTeamName: string | null;
  teams: LeagueRosterTeam[];
  /** Normalized starting-slot template (QB/RB/WR/TE/FLEX/K/DEF), in host order. */
  rosterPositions: string[];
};

type EspnRosterView = {
  settings?: {
    name?: string;
    size?: number;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  };
  teams?: (EspnTeam & {
    roster?: {
      entries?: {
        playerId?: number;
        lineupSlotId?: number;
        playerPoolEntry?: { player?: { fullName?: string } };
      }[];
    };
  })[];
};

/** Host platform slot token -> internal position tag. */
export function normalizeSlotToken(raw: string): string {
  const t = String(raw ?? "").toUpperCase().replace(/[^A-Z+/]/g, "");
  if (t === "QB") return "QB";
  if (t === "RB") return "RB";
  if (t === "WR") return "WR";
  if (t === "TE") return "TE";
  if (t === "K" || t === "PK") return "K";
  if (t === "DEF" || t === "DST" || t === "D/ST" || t === "DST/DEF" || t === "DEFENSE") return "DEF";
  if (t.startsWith("FLEX") || t === "WRRBTE" || t === "RBWRTE" || t === "WRRB" || t === "REC")
    return "FLEX";
  if (t === "IR" || t === "IL" || t === "IL+") return "IR";
  if (t === "BN" || t === "BE" || t === "BENCH") return "BN";
  return t;
}

const ESPN_SLOT_TOKEN: Record<number, string> = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  16: "DEF",
  17: "K",
  23: "FLEX",
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
      const teams: LeagueRosterTeam[] = rows.map((t, i) => {
        const entries = t.roster?.entries ?? [];
        const nameOf = (e: (typeof entries)[number]) =>
          e.playerPoolEntry?.player?.fullName ?? "";
        const logoRaw = t.logo?.trim() || null;
        return {
          slot: t.id ?? i + 1,
          team: espnTeamName(t) ?? `Team ${i + 1}`,
          owner: t.abbrev ?? "",
          isMine: (t.id ?? i + 1) === mineId,
          logo: logoRaw,
          playerIds: [],
          playerNames: entries.map(nameOf).filter(Boolean),
          starterIds: [],
          starterNames: entries
            .filter((e) => ESPN_SLOT_TOKEN[e.lineupSlotId ?? -1] !== undefined)
            .sort((a, b) => (a.lineupSlotId ?? 0) - (b.lineupSlotId ?? 0))
            .map(nameOf)
            .filter(Boolean),
          irIds: [],
          irNames: entries
            .filter((e) => e.lineupSlotId === 21)
            .map(nameOf)
            .filter(Boolean),
        };
      });
      // Build the starting-slot template from ESPN's lineup slot counts.
      const counts = league?.settings?.rosterSettings?.lineupSlotCounts ?? {};
      const rosterPositions: string[] = [];
      for (const [raw, count] of Object.entries(counts)) {
        const token = ESPN_SLOT_TOKEN[Number(raw)];
        if (!token) continue;
        for (let k = 0; k < (Number(count) || 0); k++) rosterPositions.push(token);
      }
      return {
        myTeamName: teams.find((t) => t.isMine)?.team ?? null,
        teams,
        rosterPositions,
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

  const [rosters, users, league] = await Promise.all([
    json<
      {
        roster_id: number;
        owner_id: string | null;
        players?: string[] | null;
        starters?: string[] | null;
        reserve?: string[] | null;
      }[]
    >(`${BASE}/league/${leagueId}/rosters`),
    json<
      {
        user_id: string;
        display_name: string;
        avatar?: string | null;
        metadata?: { team_name?: string; avatar?: string };
      }[]
    >(`${BASE}/league/${leagueId}/users`),
    json<{ roster_positions?: string[] }>(`${BASE}/league/${leagueId}`),
  ]);
  if (!rosters?.length) return null;

  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const ordered = [...rosters].sort((a, b) => a.roster_id - b.roster_id);
  const teams: LeagueRosterTeam[] = ordered.map((r, i) => {
    const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
    const reserve = (r.reserve ?? []).map((p) => String(p));
    const metaAvatar = u?.metadata?.avatar?.trim() || null;
    const logo =
      (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
      sleeperAvatar(u?.avatar) ||
      null;
    return {
      slot: r.roster_id ?? i + 1,
      team: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${i + 1}`,
      owner: u?.display_name ?? "",
      isMine: Boolean(userId && r.owner_id === userId),
      logo,
      playerIds: (r.players ?? []).map((p) => String(p)),
      playerNames: [],
      // Sleeper returns starters as an ordered array aligned to roster_positions;
      // "0" marks an intentionally empty slot and is preserved for alignment.
      starterIds: (r.starters ?? []).map((p) => String(p)),
      starterNames: [],
      irIds: reserve,
      irNames: [],
    };
  });

  const rosterPositions = (league?.roster_positions ?? [])
    .map((p) => normalizeSlotToken(String(p)))
    .filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI");

  return {
    myTeamName: teams.find((t) => t.isMine)?.team ?? null,
    teams,
    rosterPositions,

  };
}

// ---------------------------------------------------------------------------
// Weekly matchup table for the active synced league
// ---------------------------------------------------------------------------

export type WeeklyMatchupEntry = {
  rosterId: number;
  matchupId: number | null;
  /** Live / current fantasy points for the week (host platform). */
  points: number;
  /** Host-native live projection total (`custom_projections` / `matchup_projections` / ESPN live proj). */
  projectedPoints: number;
  /**
   * Host-native win probability for this side of the matchup (0–100).
   * Null only before pairing; stamped for every H2H pair before return.
   */
  winProbabilityPct: number | null;
  teamName: string;
  owner: string;
  logo: string | null;
  /** Host starter player ids for the week (Sleeper); empty when unavailable. */
  starters: string[];
  /** Per-player fantasy points scored so far this week. */
  playerPoints: Record<string, number>;
};

export type LeagueWeekMatchups = {
  week: number;
  entries: WeeklyMatchupEntry[];
  /** Where baseline projected values originated. */
  source: "sleeper" | "espn" | "yahoo";
};

function roundHundredths(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Provider-style win% from projected finals when the host omits raw odds. */
function hostWinPctFromProjected(mine: number, opp: number): number {
  if (!Number.isFinite(mine) || !Number.isFinite(opp)) return 50;
  if (mine <= 0 && opp <= 0) return 50;
  const p = 1 / (1 + Math.exp(-(mine - opp) / 12));
  return Math.round(Math.min(99, Math.max(1, p * 100)));
}

/** Stamp complementary win% onto each H2H pair using host projected totals. */
function stampMatchupWinProbabilities(entries: WeeklyMatchupEntry[]): void {
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

    if (a.winProbabilityPct != null && b.winProbabilityPct == null) {
      b.winProbabilityPct = Math.max(0, Math.min(100, 100 - a.winProbabilityPct));
      continue;
    }
    if (b.winProbabilityPct != null && a.winProbabilityPct == null) {
      a.winProbabilityPct = Math.max(0, Math.min(100, 100 - b.winProbabilityPct));
      continue;
    }
    if (a.winProbabilityPct != null && b.winProbabilityPct != null) continue;

    const minePct = hostWinPctFromProjected(a.projectedPoints, b.projectedPoints);
    a.winProbabilityPct = minePct;
    b.winProbabilityPct = 100 - minePct;
  }
}

function readNativeNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw == null) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
      return Number(raw);
    }
  }
  return null;
}

/**
 * Pull Sleeper-native live projection totals when present on the matchup row
 * (`custom_projections`, `matchup_projections`, or flat projected_* keys).
 */
function readNativeProjected(row: Record<string, unknown>): number | null {
  const direct = readNativeNumber(row, [
    "custom_projections",
    "matchup_projections",
    "projected_points",
    "points_projected",
    "proj_points",
    "projected",
  ]);
  if (direct != null) return direct;

  for (const key of ["custom_projections", "matchup_projections", "projections"]) {
    const val = row[key];
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const obj = val as Record<string, unknown>;
    const nested = readNativeNumber(obj, ["total", "points", "projected", "projected_points", "value"]);
    if (nested != null) return nested;
    let sum = 0;
    let touched = false;
    for (const v of Object.values(obj)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      sum += n;
      touched = true;
    }
    if (touched) return sum;
  }
  return null;
}

/** Pull Sleeper-native matchup win% when present (0–1 or 0–100). */
function readNativeWinPct(row: Record<string, unknown>): number | null {
  const direct = readNativeNumber(row, [
    "win_probability",
    "win_pct",
    "win_percentage",
    "chance_to_win",
    "probability",
    "matchup_win_pct",
  ]);
  if (direct != null) {
    return Math.round(Math.min(100, Math.max(0, direct <= 1 ? direct * 100 : direct)));
  }
  for (const key of ["matchup_projections", "custom_projections", "projections"]) {
    const val = row[key];
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const nested = readNativeNumber(val as Record<string, unknown>, [
      "win_probability",
      "win_pct",
      "win_percentage",
      "chance_to_win",
      "probability",
    ]);
    if (nested != null) {
      return Math.round(Math.min(100, Math.max(0, nested <= 1 ? nested * 100 : nested)));
    }
  }
  return null;
}

/** Sum Sleeper starter projections with the league's own scoring map (pre-game baseline). */
async function enrichSleeperProjectedPoints(
  leagueId: string,
  week: number,
  entries: WeeklyMatchupEntry[],
): Promise<void> {
  const needsEnrich = entries.some((e) => e.projectedPoints <= 0 && e.starters.length > 0);
  if (!needsEnrich) return;

  const state = await json<{ season?: string }>(`${BASE}/state/nfl`);
  const season = String(state?.season ?? new Date().getUTCFullYear());
  const { positionsQuery } = await import("./players-build");
  const { loadLeagueScoring } = await import("./scoring.server");
  const { scoreStats } = await import("./scoring-map");

  const [scoring, projRows] = await Promise.all([
    loadLeagueScoring(leagueId, "sleeper"),
    json<{ player_id?: string; stats?: Record<string, number> }[]>(
      `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`,
    ),
  ]);

  const projById = new Map<string, Record<string, number>>();
  for (const row of projRows ?? []) {
    if (row?.player_id && row.stats) projById.set(String(row.player_id), row.stats);
  }

  for (const entry of entries) {
    if (entry.projectedPoints > 0) continue;
    let sum = 0;
    for (const starterId of entry.starters) {
      const scored = scoreStats(projById.get(starterId), scoring.map);
      if (scored != null) sum += scored;
    }
    entry.projectedPoints = roundHundredths(sum);
  }
}

/** Load host-platform weekly matchup rows keyed by roster + matchup_id. */
export async function loadConnectionMatchups(
  identifier: string,
  platform: string,
  week: number,
  s2?: string | null,
  swid?: string | null,
  _connectionId?: string | null,
): Promise<LeagueWeekMatchups | null> {
  const clean = identifier.trim().replace(/^@/, "");
  const safeWeek = Math.max(1, Math.floor(Number(week) || 1));
  const plat = platform.trim().toLowerCase();
  if (!clean) return null;

  // No Supabase writes for live scoreboard shifts — client caches handle refresh.
  if (plat === "yahoo") {
    return null;
  }

  if (plat === "espn") {
    if (!/^\d+$/.test(clean)) return null;
    const season = new Date().getFullYear();
    for (const year of [season, season - 1]) {
      const league = await espnJson<{
        teams?: EspnTeam[];
        schedule?: {
          id?: number;
          matchupPeriodId?: number;
          home?: {
            teamId?: number;
            totalPoints?: number;
            totalPointsLive?: number;
            totalProjectedPoints?: number;
            totalProjectedPointsLive?: number;
          };
          away?: {
            teamId?: number;
            totalPoints?: number;
            totalPointsLive?: number;
            totalProjectedPoints?: number;
            totalProjectedPointsLive?: number;
          };
        }[];
      }>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mMatchupScore&view=mScoreboard&view=mTeam&scoringPeriodId=${safeWeek}`,
        s2,
        swid,
      );
      const teams = league?.teams ?? [];
      const byId = new Map(
        teams.map((t, i) => [
          Number(t.id ?? i + 1),
          {
            teamName: espnTeamName(t) ?? `Team ${i + 1}`,
            owner: t.abbrev ?? "",
            logo: t.logo?.trim() || null,
          },
        ]),
      );
      let schedule = (league?.schedule ?? []).filter(
        (row) => Number(row.matchupPeriodId ?? 0) === safeWeek,
      );
      if (!schedule.length && (league?.schedule?.length ?? 0) > 0) {
        schedule = league?.schedule ?? [];
      }
      if (!schedule.length) continue;

      const entries: WeeklyMatchupEntry[] = [];
      for (const row of schedule) {
        const matchupId = Number(row.id ?? 0) || null;
        const sides = [
          {
            rosterId: Number(row.home?.teamId ?? 0),
            points: Number(row.home?.totalPointsLive ?? row.home?.totalPoints ?? 0),
            projected: Number(
              row.home?.totalProjectedPointsLive ?? row.home?.totalProjectedPoints ?? 0,
            ),
          },
          {
            rosterId: Number(row.away?.teamId ?? 0),
            points: Number(row.away?.totalPointsLive ?? row.away?.totalPoints ?? 0),
            projected: Number(
              row.away?.totalProjectedPointsLive ?? row.away?.totalProjectedPoints ?? 0,
            ),
          },
        ];
        for (const side of sides) {
          if (!side.rosterId) continue;
          const meta = byId.get(side.rosterId);
          entries.push({
            rosterId: side.rosterId,
            matchupId,
            points: roundHundredths(side.points),
            projectedPoints: roundHundredths(side.projected),
            winProbabilityPct: null,
            teamName: meta?.teamName ?? `Team ${side.rosterId}`,
            owner: meta?.owner ?? "",
            logo: meta?.logo ?? null,
            starters: [],
            playerPoints: {},
          });
        }
      }
      if (!entries.length) continue;

      stampMatchupWinProbabilities(entries);
      return { week: safeWeek, entries, source: "espn" };
    }
    return null;
  }

  const leagueId = await resolveSleeperLeagueId(clean);
  if (!leagueId) return null;

  const [rows, rosters, users] = await Promise.all([
    json<Record<string, unknown>[]>(`${BASE}/league/${leagueId}/matchups/${safeWeek}`),
    json<{ roster_id: number; owner_id: string | null }[]>(`${BASE}/league/${leagueId}/rosters`),
    json<
      {
        user_id: string;
        display_name: string;
        avatar?: string | null;
        metadata?: { team_name?: string; avatar?: string };
      }[]
    >(`${BASE}/league/${leagueId}/users`),
  ]);
  if (!rows?.length) return null;

  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const metaByRoster = new Map<number, { teamName: string; owner: string; logo: string | null }>();
  for (const r of rosters ?? []) {
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
  }

  const entries: WeeklyMatchupEntry[] = rows
    .map((row) => {
      const rosterId = Number(row["roster_id"] ?? 0);
      const meta = metaByRoster.get(rosterId);
      const matchupRaw = row["matchup_id"];
      const matchupId =
        matchupRaw == null || matchupRaw === undefined || Number.isNaN(Number(matchupRaw))
          ? null
          : Number(matchupRaw);
      const playerPoints: Record<string, number> = {};
      const rawPoints = row["players_points"];
      if (rawPoints && typeof rawPoints === "object") {
        for (const [pid, pts] of Object.entries(rawPoints as Record<string, number>)) {
          playerPoints[String(pid)] = Number(pts) || 0;
        }
      }
      const starters = (Array.isArray(row["starters"]) ? (row["starters"] as (string | null)[]) : [])
        .map((id) => (id && id !== "0" ? String(id) : ""))
        .filter(Boolean);

      const nativeProjected = readNativeProjected(row);
      const nativeWin = readNativeWinPct(row);

      return {
        rosterId,
        matchupId,
        points: roundHundredths(Number(row["points"] ?? 0)),
        projectedPoints: nativeProjected != null ? roundHundredths(nativeProjected) : 0,
        winProbabilityPct: nativeWin,
        teamName: meta?.teamName ?? `Team ${rosterId}`,
        owner: meta?.owner ?? "",
        logo: meta?.logo ?? null,
        starters,
        playerPoints,
      };
    })
    .filter((e) => e.rosterId > 0);

  await enrichSleeperProjectedPoints(leagueId, safeWeek, entries);
  stampMatchupWinProbabilities(entries);

  return { week: safeWeek, entries, source: "sleeper" };
}

// ---------------------------------------------------------------------------
// Recent transaction feed for League HQ Activity
// ---------------------------------------------------------------------------

export type LeagueActivityMove = {
  /** Prefer Sleeper id so client avatars resolve against the CDN. */
  playerId: string;
  name: string;
  pos: string;
  team: string;
  action: "add" | "drop" | "ir";
};

export type LeagueActivityEvent = {
  id: string;
  at: number;
  kind: "waiver" | "free_agent" | "trade" | "ir";
  /** Fallback sentence when structured moves are unavailable. */
  text: string;
  /** Fantasy team that initiated the move (null for multi-side trades). */
  teamName: string | null;
  moves: LeagueActivityMove[];
};

type SleeperTxn = {
  transaction_id?: string;
  type?: string;
  status?: string;
  status_updated?: number;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  /** Slot / IR metadata when Sleeper encodes a pure roster move. */
  metadata?: { to_slot?: string; from_slot?: string; [key: string]: unknown } | null;
};

function playerChip(
  index: IdentityIndex,
  playerId: string,
): string {
  const hit = index.bySleeper.get(playerId);
  const name = hit?.name ?? `Player ${playerId}`;
  const pos = hit?.pos?.trim() || "FA";
  const team = hit?.team?.trim() || "FA";
  return `${name} (${pos} - ${team})`;
}

function sleeperMove(
  index: IdentityIndex,
  playerId: string,
  action: LeagueActivityMove["action"],
): LeagueActivityMove {
  const hit = index.bySleeper.get(playerId);
  return {
    playerId: hit?.id ?? playerId,
    name: hit?.name ?? `Player ${playerId}`,
    pos: hit?.pos?.trim() || "FA",
    team: hit?.team?.trim() || "FA",
    action,
  };
}

function espnMove(
  index: IdentityIndex,
  playerId: number | undefined,
  action: LeagueActivityMove["action"],
): LeagueActivityMove | null {
  if (playerId == null) return null;
  const hit = index.byEspn.get(String(playerId));
  return {
    playerId: hit?.id ?? String(playerId),
    name: hit?.name ?? `Player ${playerId}`,
    pos: hit?.pos?.trim() || "FA",
    team: hit?.team?.trim() || "FA",
    action,
  };
}

function teamLabel(map: Map<number, string>, rosterId: number | undefined): string {
  if (rosterId == null) return "Unknown Team";
  return map.get(rosterId) ?? `Team ${rosterId}`;
}

function formatSleeperTransaction(
  txn: SleeperTxn,
  teams: Map<number, string>,
  index: IdentityIndex,
): LeagueActivityEvent | null {
  const at = Number(txn.status_updated ?? txn.created ?? 0);
  if (!at) return null;

  // Root type codes only — never infer IR from a player's injury tag.
  const type = String(txn.type ?? "").toLowerCase();
  const isTrade = type === "trade";
  const isWaiver = type === "waiver";
  const isFreeAgent = type === "free_agent";
  const toSlot = String(txn.metadata?.to_slot ?? "").toUpperCase();
  const isActualIRMove =
    type === "injury" ||
    type === "ir" ||
    (!isWaiver && !isFreeAgent && !isTrade && toSlot === "IR");

  const status = String(txn.status ?? "").toLowerCase();
  const adds = Object.entries(txn.adds ?? {});
  const drops = Object.entries(txn.drops ?? {});
  const id = String(txn.transaction_id ?? `${type}-${at}-${adds.map(([p]) => p).join("-")}`);

  if (isTrade) {
    if (status && status !== "complete" && status !== "failed") return null;
    const byRoster = new Map<number, string[]>();
    const moves: LeagueActivityMove[] = [];
    for (const [playerId, rosterId] of adds) {
      const list = byRoster.get(rosterId) ?? [];
      list.push(playerChip(index, playerId));
      byRoster.set(rosterId, list);
      moves.push(sleeperMove(index, playerId, "add"));
    }
    for (const [playerId] of drops) {
      moves.push(sleeperMove(index, playerId, "drop"));
    }
    const parts = [...byRoster.entries()].map(
      ([rosterId, players]) =>
        `${teamLabel(teams, rosterId)} received ${players.join(", ")}`,
    );
    if (!parts.length) return null;
    const prefix = status === "failed" ? "TRADE REJECTED" : "TRADE COMPLETED";
    return {
      id,
      at,
      kind: "trade",
      text: `${prefix}: ${parts.join(", ")}`,
      teamName: null,
      moves,
    };
  }

  // Waivers / free agents are always ADD / DROP rows — never IR, even when
  // the involved player carries an IR injury designation on their card.
  if (isWaiver || isFreeAgent) {
    const primaryRoster =
      adds[0]?.[1] ?? drops[0]?.[1] ?? txn.roster_ids?.[0] ?? undefined;
    const team = teamLabel(teams, primaryRoster);
    const addMoves = adds.map(([pid]) => sleeperMove(index, pid, "add"));
    const dropMoves = drops.map(([pid]) => sleeperMove(index, pid, "drop"));
    const kind: LeagueActivityEvent["kind"] = isWaiver ? "waiver" : "free_agent";
    const addSource = isWaiver ? "from waivers" : "as a free agent";

    if (adds.length && drops.length) {
      const added = adds.map(([pid]) => playerChip(index, pid)).join(", ");
      const dropped = drops.map(([pid]) => playerChip(index, pid)).join(", ");
      return {
        id,
        at,
        kind,
        text: `${team} ADDED ${added} ${addSource}, DROPPED ${dropped}`,
        teamName: team,
        moves: [...addMoves, ...dropMoves],
      };
    }

    if (adds.length && !drops.length) {
      const added = adds.map(([pid]) => playerChip(index, pid)).join(", ");
      return {
        id,
        at,
        kind,
        text: `${team} ADDED ${added} ${addSource}`,
        teamName: team,
        moves: addMoves,
      };
    }

    if (!adds.length && drops.length) {
      const dropped = drops.map(([pid]) => playerChip(index, pid)).join(", ");
      return {
        id,
        at,
        kind,
        text: `${team} DROPPED ${dropped}`,
        teamName: team,
        moves: dropMoves,
      };
    }
  }

  if (isActualIRMove) {
    const primaryRoster =
      adds[0]?.[1] ?? drops[0]?.[1] ?? txn.roster_ids?.[0] ?? undefined;
    const team = teamLabel(teams, primaryRoster);
    const irPlayers = adds.length ? adds : drops;
    if (!irPlayers.length) return null;
    const labeled = irPlayers.map(([pid]) => playerChip(index, pid)).join(", ");
    return {
      id,
      at,
      kind: "ir",
      text: `${team} PLACED ${labeled} on Injured Reserve`,
      teamName: team,
      moves: irPlayers.map(([pid]) => sleeperMove(index, pid, "ir")),
    };
  }

  return null;
}

async function resolveSleeperLeagueId(clean: string): Promise<string | null> {
  if (/^\d{6,}$/.test(clean)) {
    const direct = await json<{ league_id?: string }>(`${BASE}/league/${clean}`);
    if (direct?.league_id) return clean;
    const leagues = await json<{ league_id: string }[]>(
      `${BASE}/user/${clean}/leagues/nfl/${new Date().getFullYear()}`,
    );
    return leagues?.[0]?.league_id ?? null;
  }
  const leagues = await loadUserLeagues(clean);
  return leagues[0]?.id ?? null;
}

/** Recent waiver, free-agent, trade, and IR activity for a synced league. */
export async function loadConnectionTransactions(
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<LeagueActivityEvent[]> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return [];

  if (platform === "espn") {
    if (!/^\d+$/.test(clean)) return [];
    const season = new Date().getFullYear();
    const index = await loadIdentityIndex();
    for (const year of [season, season - 1]) {
      const league = await espnJson<{
        teams?: { id?: number; abbrev?: string; name?: string; location?: string; nickname?: string }[];
        transactions?: {
          id?: number | string;
          proposedDate?: number;
          processDate?: number;
          type?: string;
          status?: string;
          members?: unknown[];
          items?: {
            type?: string;
            playerId?: number;
            fromTeamId?: number;
            toTeamId?: number;
          }[];
        }[];
      }>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mTeam&view=mTransactions2`,
        s2,
        swid,
      );
      const teams = league?.teams ?? [];
      if (!teams.length && !league?.transactions?.length) continue;
      const teamMap = new Map<number, string>();
      for (const t of teams) {
        const id = t.id ?? 0;
        teamMap.set(id, espnTeamName(t as never) ?? t.abbrev ?? `Team ${id}`);
      }
      const events: LeagueActivityEvent[] = [];
      for (const txn of league?.transactions ?? []) {
        const at = Number(txn.processDate ?? txn.proposedDate ?? 0);
        if (!at) continue;
        const status = String(txn.status ?? "").toLowerCase();
        const items = txn.items ?? [];
        const id = String(txn.id ?? `${at}`);
        const adds = items.filter((i) => String(i.type ?? "").toUpperCase().includes("ADD") || i.toTeamId != null);
        const drops = items.filter((i) => String(i.type ?? "").toUpperCase().includes("DROP") || (i.fromTeamId != null && i.toTeamId == null));
        const isTrade = String(txn.type ?? "").toUpperCase().includes("TRADE") || items.some((i) => String(i.type ?? "").toUpperCase().includes("TRADE"));

        const chipFor = (playerId: number | undefined) => {
          if (playerId == null) return "Unknown Player";
          const hit = index.byEspn.get(String(playerId));
          if (!hit) return `Player ${playerId}`;
          return `${hit.name} (${hit.pos ?? "FA"} - ${hit.team ?? "FA"})`;
        };

        if (isTrade) {
          const byTeam = new Map<number, string[]>();
          const moves: LeagueActivityMove[] = [];
          for (const item of items) {
            const to = item.toTeamId;
            if (to == null || item.playerId == null) continue;
            const list = byTeam.get(to) ?? [];
            list.push(chipFor(item.playerId));
            byTeam.set(to, list);
            const move = espnMove(index, item.playerId, "add");
            if (move) moves.push(move);
          }
          for (const item of drops) {
            const move = espnMove(index, item.playerId, "drop");
            if (move) moves.push(move);
          }
          const parts = [...byTeam.entries()].map(
            ([teamId, players]) => `${teamLabel(teamMap, teamId)} received ${players.join(", ")}`,
          );
          if (!parts.length) continue;
          const prefix = status.includes("reject") || status.includes("fail") ? "TRADE REJECTED" : "TRADE COMPLETED";
          events.push({
            id,
            at,
            kind: "trade",
            text: `${prefix}: ${parts.join(", ")}`,
            teamName: null,
            moves,
          });
          continue;
        }

        const primaryTeam =
          adds[0]?.toTeamId ?? drops[0]?.fromTeamId ?? undefined;
        const team = teamLabel(teamMap, primaryTeam);
        const espnType = String(txn.type ?? "").toLowerCase();
        const espnIsWaiver = espnType.includes("waiver");
        const espnIsFreeAgent =
          espnType.includes("freeagent") ||
          espnType.includes("free_agent") ||
          espnType.includes("add") ||
          espnType.includes("drop");
        const espnIsActualIR =
          espnType.includes("injury") ||
          espnType === "ir" ||
          espnType.includes("injured") ||
          (!espnIsWaiver && !espnIsFreeAgent && espnType.includes("ir"));

        if (adds.length && drops.length) {
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} ADDED ${adds.map((i) => chipFor(i.playerId)).join(", ")} from waivers, DROPPED ${drops.map((i) => chipFor(i.playerId)).join(", ")}`,
            teamName: team,
            moves: [
              ...adds.map((i) => espnMove(index, i.playerId, "add")).filter((m): m is LeagueActivityMove => Boolean(m)),
              ...drops.map((i) => espnMove(index, i.playerId, "drop")).filter((m): m is LeagueActivityMove => Boolean(m)),
            ],
          });
        } else if (adds.length) {
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} ADDED ${adds.map((i) => chipFor(i.playerId)).join(", ")} as a free agent`,
            teamName: team,
            moves: adds
              .map((i) => espnMove(index, i.playerId, "add"))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        } else if (drops.length && espnIsActualIR) {
          events.push({
            id,
            at,
            kind: "ir",
            text: `${team} PLACED ${drops.map((i) => chipFor(i.playerId)).join(", ")} on Injured Reserve`,
            teamName: team,
            moves: drops
              .map((i) => espnMove(index, i.playerId, "ir"))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        } else if (drops.length) {
          // Pure drop — free agency cut, not an IR placement.
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} DROPPED ${drops.map((i) => chipFor(i.playerId)).join(", ")}`,
            teamName: team,
            moves: drops
              .map((i) => espnMove(index, i.playerId, "drop"))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        }
      }
      if (events.length) {
        events.sort((a, b) => b.at - a.at);
        return events.slice(0, 80);
      }
      if (teams.length) return [];
    }
    return [];
  }

  const leagueId = await resolveSleeperLeagueId(clean);
  if (!leagueId) return [];

  const state = await json<{ week?: number }>(`${BASE}/state/nfl`);
  const week = Math.max(1, Number(state?.week ?? 1) || 1);
  const weeks = Array.from({ length: Math.min(week, 4) }, (_, i) => week - i).filter((w) => w >= 1);

  const [rosters, users, index, ...weekTxnLists] = await Promise.all([
    json<{ roster_id: number; owner_id: string | null }[]>(`${BASE}/league/${leagueId}/rosters`),
    json<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(
      `${BASE}/league/${leagueId}/users`,
    ),
    loadIdentityIndex(),
    ...weeks.map((w) => json<SleeperTxn[]>(`${BASE}/league/${leagueId}/transactions/${w}`)),
  ]);

  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const teamMap = new Map<number, string>();
  for (const r of rosters ?? []) {
    const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
    teamMap.set(
      r.roster_id,
      u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
    );
  }

  const events: LeagueActivityEvent[] = [];
  const seen = new Set<string>();
  for (const list of weekTxnLists) {
    for (const txn of list ?? []) {
      const event = formatSleeperTransaction(txn, teamMap, index);
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }

  events.sort((a, b) => b.at - a.at);
  return events.slice(0, 80);
}

// ---------------------------------------------------------------------------
// Unified multi-platform league ingestion (Sleeper / ESPN / Yahoo)
//
// Every foreign payload is translated into the UnifiedLeague schema below
// before it leaves the server, so the frontend never sees platform shapes.
// ---------------------------------------------------------------------------

export type UnifiedRosterPlayer = {
  /** Sleeper id when the identity layer can resolve it, else the native key. */
  player_id: string;
  /** The id as it came from the source platform. */
  source_player_id: string;
  player_name: string;
  position: string | null;
  nfl_team: string | null;
  /** true when the platform key was translated to a Sleeper anchor id. */
  resolved: boolean;
};

export type UnifiedRosterTeam = {
  team_id: string;
  team_name: string;
  owner_name: string;
  is_mine: boolean;
  roster_players_list: UnifiedRosterPlayer[];
};

export type UnifiedLeague = {
  platform: "sleeper" | "espn" | "yahoo";
  league_id: string;
  league_name: string;
  season: string;
  total_teams: number;
  playoff_start_week: number;
  scoring_format: "std" | "half" | "ppr";
  /** Starters + regular bench only; IR is excluded (not drafted). */
  draft_roster_slots: RosterSlotCounts;
  /** Full roster metadata including IR spots, for display only. */
  roster_metadata: { starters: number; bench: number; ir: number; total: number };
  teams: UnifiedRosterTeam[];
};

// --- Cross-platform player identity translation layer ----------------------

type IdentityIndex = {
  byEspn: Map<string, { id: string; name: string; pos: string | null; team: string | null }>;
  byYahoo: Map<string, { id: string; name: string; pos: string | null; team: string | null }>;
  byName: Map<string, { id: string; name: string; pos: string | null; team: string | null }>;
  bySleeper: Map<string, { id: string; name: string; pos: string | null; team: string | null }>;
};

let identityCache: { at: number; index: IdentityIndex } | null = null;
const IDENTITY_TTL = 12 * 60 * 60 * 1000;

const normalizeName = (s: string) =>
  s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z]/g, "");

async function loadIdentityIndex(): Promise<IdentityIndex> {
  const now = Date.now();
  if (identityCache && now - identityCache.at < IDENTITY_TTL) return identityCache.index;

  const index: IdentityIndex = {
    byEspn: new Map(),
    byYahoo: new Map(),
    byName: new Map(),
    bySleeper: new Map(),
  };

  const raw = await json<
    Record<
      string,
      {
        player_id?: string;
        full_name?: string;
        first_name?: string;
        last_name?: string;
        position?: string | null;
        team?: string | null;
        espn_id?: number | string | null;
        yahoo_id?: number | string | null;
      }
    >
  >(`${BASE}/players/nfl`);

  for (const [key, p] of Object.entries(raw ?? {})) {
    const name = (p?.full_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`).trim();
    if (!name) continue;
    const entry = {
      id: String(p?.player_id ?? key),
      name,
      pos: p?.position ?? null,
      team: p?.team ?? null,
    };
    index.bySleeper.set(entry.id, entry);
    if (p?.espn_id) index.byEspn.set(String(p.espn_id), entry);
    if (p?.yahoo_id) index.byYahoo.set(String(p.yahoo_id), entry);
    const nk = normalizeName(name);
    if (nk && !index.byName.has(nk)) index.byName.set(nk, entry);
  }

  identityCache = { at: now, index };
  return index;
}

/**
 * Translate a foreign platform player key (or name) onto its Sleeper anchor id
 * so the AI bots and local caches never mix identities across platforms.
 */
function translatePlayer(
  index: IdentityIndex,
  source: "sleeper" | "espn" | "yahoo",
  sourceId: string,
  fallbackName: string,
): UnifiedRosterPlayer {
  const direct =
    source === "sleeper"
      ? index.bySleeper.get(sourceId)
      : source === "espn"
        ? index.byEspn.get(sourceId)
        : index.byYahoo.get(sourceId);
  const hit = direct ?? (fallbackName ? index.byName.get(normalizeName(fallbackName)) : undefined);
  return {
    player_id: hit?.id ?? sourceId,
    source_player_id: sourceId,
    player_name: hit?.name ?? fallbackName ?? sourceId,
    position: hit?.pos ?? null,
    nfl_team: hit?.team ?? null,
    resolved: Boolean(hit),
  };
}

function rosterMetadata(draft: RosterSlotCounts, ir: number) {
  const bench = draft.BENCH;
  const starters = Object.values(draft).reduce((a, b) => a + b, 0) - bench;
  return { starters, bench, ir, total: starters + bench + ir };
}

// --- Sleeper ---------------------------------------------------------------

/** Fetch and normalize a public Sleeper league. */
export async function fetchSleeperLeague(leagueId: string): Promise<UnifiedLeague | null> {
  const id = leagueId.trim();
  if (!/^\d+$/.test(id)) return null;

  const [league, rosters, users, index] = await Promise.all([
    json<{
      league_id: string;
      name: string;
      season: string;
      total_rosters?: number;
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
    loadIdentityIndex(),
  ]);
  if (!league) return null;

  const positions = league.roster_positions ?? [];
  const draftSlots = slotCounts(positions);
  const ir = positions.filter((p) => String(p).toUpperCase() === "IR").length;
  const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
  const ordered = [...(rosters ?? [])].sort((a, b) => a.roster_id - b.roster_id);

  return {
    platform: "sleeper",
    league_id: league.league_id,
    league_name: league.name,
    season: String(league.season ?? ""),
    total_teams: league.total_rosters || ordered.length || 0,
    playoff_start_week: Number(league.settings?.["playoff_week_start"]) || 15,
    scoring_format: scoringKey(league.scoring_settings),
    draft_roster_slots: draftSlots,
    roster_metadata: rosterMetadata(draftSlots, ir),
    teams: ordered.map((r, i) => {
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      return {
        team_id: String(r.roster_id ?? i + 1),
        team_name: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${i + 1}`,
        owner_name: u?.display_name ?? "",
        is_mine: false,
        roster_players_list: (r.players ?? []).map((pid) =>
          translatePlayer(index, "sleeper", String(pid), ""),
        ),
      };
    }),
  };
}

// --- ESPN ------------------------------------------------------------------

type EspnUnifiedView = EspnRosterView &
  EspnRosterSettings & {
    seasonId?: number;
    settings?: {
      name?: string;
      size?: number;
      scheduleSettings?: { playoffMatchupPeriodId?: number; matchupPeriodCount?: number };
      scoringSettings?: { scoringItems?: { statId?: number; points?: number }[] };
      rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    };
  };

/** Fetch and normalize an ESPN league, injecting private cookie credentials. */
export async function fetchEspnLeague(
  leagueId: string,
  espnS2?: string | null,
  swid?: string | null,
): Promise<UnifiedLeague | null> {
  const id = leagueId.trim();
  if (!/^\d+$/.test(id)) return null;

  const season = new Date().getFullYear();
  const index = await loadIdentityIndex();

  for (const year of [season, season - 1]) {
    const league = await espnJson<EspnUnifiedView>(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(id)}?view=mSettings&view=mRoster&view=mTeam`,
      espnS2,
      swid,
    );
    const rows = league?.teams ?? [];
    if (!rows.length) continue;

    const counts = league?.settings?.rosterSettings?.lineupSlotCounts ?? {};
    const draftSlots = espnSlotCounts(counts);
    const ir = Number(counts["21"] ?? 0) || 0;

    const swidGuid = swid?.trim().replace(/[{}]/g, "").toUpperCase() ?? null;
    const matchesSwid = (t: EspnTeam) => {
      if (!swidGuid) return false;
      const candidates: (string | undefined)[] = [...(t.owners ?? []), t.primaryOwner, t.swid];
      return candidates.some((c) => c && c.replace(/[{}]/g, "").toUpperCase() === swidGuid);
    };
    const mineId = rows.find(matchesSwid)?.id ?? null;

    const scoringPpr = (league?.settings?.scoringSettings?.scoringItems ?? []).find(
      (s) => s.statId === 53,
    )?.points;
    const scoring: "std" | "half" | "ppr" =
      Number(scoringPpr) >= 1 ? "ppr" : Number(scoringPpr) > 0 ? "half" : "std";

    return {
      platform: "espn",
      league_id: id,
      league_name: league?.settings?.name ?? `League ${id}`,
      season: String(league?.seasonId ?? year),
      total_teams: league?.settings?.size ?? rows.length,
      playoff_start_week: Number(league?.settings?.scheduleSettings?.playoffMatchupPeriodId) || 15,
      scoring_format: scoring,
      // Draft capacity is starters + regular bench only; IR is tracked separately.
      draft_roster_slots: draftSlots,
      roster_metadata: rosterMetadata(draftSlots, ir),
      teams: rows.map((t, i) => ({
        team_id: String(t.id ?? i + 1),
        team_name: espnTeamName(t) ?? `Team ${i + 1}`,
        owner_name: t.abbrev ?? "",
        is_mine: (t.id ?? i + 1) === mineId,
        roster_players_list: (t.roster?.entries ?? []).map((e) =>
          translatePlayer(
            index,
            "espn",
            String(e.playerId ?? ""),
            e.playerPoolEntry?.player?.fullName ?? "",
          ),
        ),
      })),
    };
  }
  return null;
}

// --- Yahoo -----------------------------------------------------------------

type YahooNode = Record<string, unknown> | unknown[] | string | number | null;

/** Yahoo's fantasy JSON nests values in mixed object/array containers. */
function yahooFlatten(node: YahooNode, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) yahooFlatten(child as YahooNode, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") yahooFlatten(v as YahooNode, out);
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Depth-first search for a nested key inside Yahoo's mixed containers. */
function findNode(node: YahooNode, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child as YahooNode, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const rec = node as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const hit = findNode(v as YahooNode, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function yahooCollection(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const rec = node as Record<string, unknown>;
  const count = Number(rec["count"] ?? 0);
  const rows: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const row = rec[String(i)];
    if (row) rows.push(row);
  }
  return rows;
}

/** Fetch and normalize a Yahoo league using an OAuth access token. */
export async function fetchYahooLeague(
  leagueId: string,
  accessToken: string,
): Promise<UnifiedLeague | null> {
  const key = leagueId.trim();
  if (!key || !accessToken) return null;

  const request = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/${path}?format=json`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const [settingsRes, rostersRes, index] = await Promise.all([
    request<Record<string, unknown>>(`league/${encodeURIComponent(key)}/settings`),
    request<Record<string, unknown>>(`league/${encodeURIComponent(key)}/teams/roster`),
    loadIdentityIndex(),
  ]);
  if (!settingsRes) return null;

  const leagueFlat = yahooFlatten(settingsRes as YahooNode);
  const leagueNode = ((settingsRes["fantasy_content"] as Record<string, unknown>)?.["league"] ??
    null) as unknown;
  const leagueArr = Array.isArray(leagueNode) ? leagueNode : [];
  const teamsNode = ((rostersRes?.["fantasy_content"] as Record<string, unknown>)?.[
    "league"
  ] as unknown[] | undefined)?.find(
    (n) => n && typeof n === "object" && "teams" in (n as Record<string, unknown>),
  ) as Record<string, unknown> | undefined;

  const teams: UnifiedRosterTeam[] = yahooCollection(teamsNode?.["teams"]).map((row, i) => {
    const teamNode = (row as Record<string, unknown>)["team"];
    const flat = yahooFlatten(teamNode as YahooNode);
    const players = yahooCollection(findNode(teamNode as YahooNode, "players"));

    return {
      team_id: String(flat["team_key"] ?? flat["team_id"] ?? i + 1),
      team_name: String(flat["name"] ?? `Team ${i + 1}`),
      owner_name: String(flat["nickname"] ?? ""),
      is_mine: String(flat["is_owned_by_current_login"] ?? "") === "1",
      roster_players_list: players.map((p) => {
        const pf = yahooFlatten((p as Record<string, unknown>)["player"] as YahooNode);
        return translatePlayer(
          index,
          "yahoo",
          String(pf["player_id"] ?? ""),
          String(pf["full"] ?? pf["name"] ?? ""),
        );
      }),
    };
  });

  const draftSlots: RosterSlotCounts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0, BENCH: 0 };
  let ir = 0;
  const rosterPositions = findNode(leagueArr as YahooNode, "roster_positions");
  const positionRows = Array.isArray(rosterPositions) ? rosterPositions : [];
  for (const rp of positionRows) {
    const flat = yahooFlatten(rp as YahooNode);
    const pos = String(flat["position"] ?? "").toUpperCase();
    const count = Number(flat["count"] ?? 0) || 0;
    if (pos === "QB") draftSlots.QB += count;
    else if (pos === "RB") draftSlots.RB += count;
    else if (pos === "WR") draftSlots.WR += count;
    else if (pos === "TE") draftSlots.TE += count;
    else if (pos === "K") draftSlots.K += count;
    else if (pos === "DEF" || pos === "DST") draftSlots.DEF += count;
    else if (pos.includes("FLEX") || pos === "W/R/T" || pos === "W/R") draftSlots.FLEX += count;
    else if (pos === "BN") draftSlots.BENCH += count;
    else if (pos === "IR" || pos === "IL" || pos === "IL+") ir += count;
  }

  return {
    platform: "yahoo",
    league_id: key,
    league_name: String(leagueFlat["name"] ?? `League ${key}`),
    season: String(leagueFlat["season"] ?? ""),
    total_teams: Number(leagueFlat["num_teams"] ?? teams.length) || teams.length,
    playoff_start_week: Number(leagueFlat["playoff_start_week"] ?? 15) || 15,
    scoring_format: String(leagueFlat["scoring_type"] ?? "") === "point" ? "std" : "std",
    draft_roster_slots: draftSlots,
    roster_metadata: rosterMetadata(draftSlots, ir),
    teams,
  };
}

/** Single entry point: resolve any stored connection into the unified schema. */
export async function fetchUnifiedLeague(input: {
  platform: string;
  leagueId: string;
  espnS2?: string | null;
  swid?: string | null;
  accessToken?: string | null;
}): Promise<UnifiedLeague | null> {
  if (input.platform === "espn") {
    return await fetchEspnLeague(input.leagueId, input.espnS2, input.swid);
  }
  if (input.platform === "yahoo") {
    return input.accessToken ? await fetchYahooLeague(input.leagueId, input.accessToken) : null;
  }
  return await fetchSleeperLeague(input.leagueId);
}

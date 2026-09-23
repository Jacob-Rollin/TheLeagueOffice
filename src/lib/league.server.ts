import { winPctFromDisplayProjections } from "./rolling-live-projection";

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
    json<
      {
        user_id: string;
        display_name: string;
        avatar: string | null;
        metadata?: { team_name?: string; avatar?: string };
      }[]
    >(`${BASE}/league/${id}/users`),
  ]);

  if (!league || !rosters) return null;
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

async function espnJson<T>(
  url: string,
  s2?: string | null,
  swid?: string | null,
  extraHeaders?: Record<string, string>,
): Promise<T | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      ...(extraHeaders ?? {}),
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
  /** Normalized starting-slot template (QB/RB/WR/TE/FLEX/K/DEF), display order. */
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
  3: "FLEX", // RB/WR
  4: "WR",
  5: "FLEX", // WR/TE
  6: "TE",
  7: "FLEX", // OP / offensive player — treat as flex for display
  16: "DEF",
  17: "K",
  23: "FLEX",
};

/**
 * Canonical starter-slot display order (matches Sleeper). ESPN's native slot
 * ids put DEF/K before FLEX (16/17/23); we remap so UI rows stay FLX → K → DEF.
 */
const STARTER_SLOT_DISPLAY_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"] as const;

function starterSlotDisplayRank(token: string): number {
  const i = (STARTER_SLOT_DISPLAY_ORDER as readonly string[]).indexOf(token);
  return i === -1 ? STARTER_SLOT_DISPLAY_ORDER.length : i;
}

type EspnBoxscoreRosterEntry = {
  playerId?: number;
  lineupSlotId?: number;
  playerPoolEntry?: {
    appliedStatTotal?: number;
    player?: {
      fullName?: string;
      stats?: {
        scoringPeriodId?: number;
        statSourceId?: number;
        appliedTotal?: number;
      }[];
    };
  };
};

/**
 * Week-scoped ACTUAL fantasy points only (statSourceId 0).
 * Never use appliedStatTotal or projected stats here — before kickoff ESPN
 * often fills those with projections, which the matchup UI treats as live
 * scores and collapses win% to 99/1.
 */
function espnBoxEntryPoints(entry: EspnBoxscoreRosterEntry, week: number): number {
  for (const stat of entry.playerPoolEntry?.player?.stats ?? []) {
    if (Number(stat.scoringPeriodId) !== Number(week)) continue;
    if (Number(stat.statSourceId) === 0) {
      const actual = Number(stat.appliedTotal);
      return Number.isFinite(actual) ? actual : 0;
    }
  }
  return 0;
}


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
          // Keep one name per starter slot (including "") so index alignment with
          // rosterPositions never shifts when a name is missing.
          starterNames: entries
            .filter((e) => ESPN_SLOT_TOKEN[e.lineupSlotId ?? -1] !== undefined)
            .sort((a, b) => {
              const ta = ESPN_SLOT_TOKEN[a.lineupSlotId ?? -1] ?? "";
              const tb = ESPN_SLOT_TOKEN[b.lineupSlotId ?? -1] ?? "";
              return (
                starterSlotDisplayRank(ta) - starterSlotDisplayRank(tb) ||
                (a.lineupSlotId ?? 0) - (b.lineupSlotId ?? 0)
              );
            })
            .map((e) => nameOf(e) || ""),
          irIds: [],
          irNames: entries
            .filter((e) => e.lineupSlotId === 21)
            .map(nameOf)
            .filter(Boolean),
        };
      });
      // Build the starting-slot template from ESPN's lineup slot counts,
      // then normalize to Sleeper-style display order (FLEX before K/DEF).
      // Collapse RB/WR + WR/TE + OP counts into FLEX for the template.
      const counts = league?.settings?.rosterSettings?.lineupSlotCounts ?? {};
      const rosterPositions: string[] = [];
      for (const [raw, count] of Object.entries(counts)) {
        const token = ESPN_SLOT_TOKEN[Number(raw)];
        if (!token) continue;
        for (let k = 0; k < (Number(count) || 0); k++) rosterPositions.push(token);
      }
      rosterPositions.sort(
        (a, b) => starterSlotDisplayRank(a) - starterSlotDisplayRank(b),
      );
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
  /**
   * Full week roster player ids from the host matchup payload (Sleeper `players`).
   * Used to rebuild historical bench instead of the current roster.
   */
  playerIds: string[];
  /**
   * IR / reserve ids for this week when the host exposes them.
   * Sleeper: live `reserve` for current/future weeks; reconstructed from
   * IR slot transactions for past weeks (matchups omit historical reserve).
   */
  irIds: string[];
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
  return winPctFromDisplayProjections(mine, opp);
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
  const { projectionPoints } = await import("./scoring-map");

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
      const scored = projectionPoints(projById.get(starterId), scoring.map, scoring.format);
      if (scored != null) sum += scored;
    }
    entry.projectedPoints = roundHundredths(sum);
  }
}

/**
 * Replay Sleeper IR slot moves through `throughWeek` so past matchups can
 * place reserve players correctly (matchup payloads omit historical reserve).
 */
async function reconstructSleeperIrByRoster(
  leagueId: string,
  throughWeek: number,
): Promise<Map<number, string[]>> {
  const irByRoster = new Map<number, Set<string>>();
  const end = Math.max(1, Math.min(18, Math.floor(throughWeek) || 1));
  const weeks = Array.from({ length: end }, (_, i) => i + 1);

  const lists = await Promise.all(
    weeks.map((w) => json<SleeperTxn[]>(`${BASE}/league/${leagueId}/transactions/${w}`)),
  );

  const events: { at: number; rosterId: number; playerId: string; onIr: boolean }[] = [];
  for (const list of lists) {
    for (const txn of list ?? []) {
      const status = String(txn.status ?? "").toLowerCase();
      if (status && status !== "complete" && status !== "successful") continue;

      const type = String(txn.type ?? "").toLowerCase();
      const toSlot = String(txn.metadata?.to_slot ?? "").toUpperCase();
      const fromSlot = String(txn.metadata?.from_slot ?? "").toUpperCase();
      const isTrade = type === "trade";
      const isWaiver = type === "waiver";
      const isFreeAgent = type === "free_agent";
      const isIrType = type === "injury" || type === "ir";
      const placingOnIr =
        isIrType || (!isWaiver && !isFreeAgent && !isTrade && toSlot === "IR");
      const activatingOffIr = fromSlot === "IR" && toSlot !== "IR";

      const at = Number(txn.status_updated ?? txn.created ?? 0) || 0;
      const adds = Object.entries(txn.adds ?? {});
      const drops = Object.entries(txn.drops ?? {});

      if (placingOnIr) {
        const players = adds.length ? adds : drops;
        for (const [playerId, rosterRaw] of players) {
          const rosterId = Number(rosterRaw ?? txn.roster_ids?.[0] ?? 0);
          if (!playerId || !Number.isFinite(rosterId) || rosterId <= 0) continue;
          events.push({ at, rosterId, playerId: String(playerId), onIr: true });
        }
        continue;
      }

      if (activatingOffIr) {
        const players = adds.length ? adds : drops;
        for (const [playerId, rosterRaw] of players) {
          const rosterId = Number(rosterRaw ?? txn.roster_ids?.[0] ?? 0);
          if (!playerId || !Number.isFinite(rosterId) || rosterId <= 0) continue;
          events.push({ at, rosterId, playerId: String(playerId), onIr: false });
        }
      }

      // Dropped / traded-away players leave IR with the roster.
      if (isTrade || isWaiver || isFreeAgent) {
        for (const [playerId, rosterRaw] of drops) {
          const rosterId = Number(rosterRaw);
          if (!playerId || !Number.isFinite(rosterId) || rosterId <= 0) continue;
          // Same player in adds+drops on one roster is a slot shuffle, not a cut.
          if (adds.some(([pid, rid]) => pid === playerId && Number(rid) === rosterId)) {
            continue;
          }
          events.push({ at, rosterId, playerId: String(playerId), onIr: false });
        }
      }
    }
  }

  events.sort((a, b) => a.at - b.at || a.playerId.localeCompare(b.playerId));
  for (const event of events) {
    const set = irByRoster.get(event.rosterId) ?? new Set<string>();
    if (event.onIr) set.add(event.playerId);
    else set.delete(event.playerId);
    irByRoster.set(event.rosterId, set);
  }

  const out = new Map<number, string[]>();
  for (const [rosterId, set] of irByRoster) {
    out.set(rosterId, [...set]);
  }
  return out;
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
    const index = await loadIdentityIndex();
    for (const year of [season, season - 1]) {
      // mBoxscore carries per-player appliedStatTotal + lineup slots for the week.
      // Without it ESPN matchups ship empty starters/playerPoints and Press Room
      // waiver copy collapses to "a featured playmaker" / 0.00pts.
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
            rosterForCurrentScoringPeriod?: {
              entries?: EspnBoxscoreRosterEntry[];
            };
            rosterForMatchupPeriod?: {
              entries?: EspnBoxscoreRosterEntry[];
            };
          };
          away?: {
            teamId?: number;
            totalPoints?: number;
            totalPointsLive?: number;
            totalProjectedPoints?: number;
            totalProjectedPointsLive?: number;
            rosterForCurrentScoringPeriod?: {
              entries?: EspnBoxscoreRosterEntry[];
            };
            rosterForMatchupPeriod?: {
              entries?: EspnBoxscoreRosterEntry[];
            };
          };
        }[];
      }>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mBoxscore&view=mMatchupScore&view=mScoreboard&view=mTeam&scoringPeriodId=${safeWeek}`,
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

      // Batch-resolve ESPN ids that omit fullName onto the Sleeper catalog.
      const rawEspnIds: string[] = [];
      for (const row of schedule) {
        for (const side of [row.home, row.away]) {
          const boxEntries =
            side?.rosterForCurrentScoringPeriod?.entries ??
            side?.rosterForMatchupPeriod?.entries ??
            [];
          for (const e of boxEntries) {
            if (e.playerId != null) rawEspnIds.push(String(e.playerId));
          }
        }
      }
      const needMeta = [...new Set(rawEspnIds)].filter((id) => {
        const n = Number(id);
        if (Number.isFinite(n) && n < 0) return true;
        return !index.byEspn.has(id);
      });
      const espnMeta = needMeta.length ? await loadEspnPlayerMetaByIds(needMeta) : new Map();

      const resolveEspnBoxPlayer = (entry: EspnBoxscoreRosterEntry): string | null => {
        const espnId = entry.playerId;
        const name =
          entry.playerPoolEntry?.player?.fullName?.trim() ||
          (espnId != null ? espnMeta.get(String(espnId))?.name : undefined) ||
          "";
        const hit = resolvePlayerFromTransaction(index, espnId, {
          isEspnLeague: true,
          ...(name ? { playerNameText: name } : {}),
        });
        if (hit?.id) return hit.id;
        if (espnId != null) {
          const meta = espnMeta.get(String(espnId));
          if (meta?.team && (meta.pos === "DEF" || /d\/?\s*st/i.test(meta.name))) {
            const def = index.bySleeper.get(meta.team);
            if (def) return def.id;
          }
        }
        // Always try the display name — ESPN box scores usually include fullName
        // even when espn_id is missing from Sleeper's dump.
        if (name) {
          const byName = findIdentityBySanitizedName(index, name);
          if (byName) return byName.id;
        }
        return null;
      };

      const parseEspnSideRoster = (
        side:
          | {
              rosterForCurrentScoringPeriod?: { entries?: EspnBoxscoreRosterEntry[] };
              rosterForMatchupPeriod?: { entries?: EspnBoxscoreRosterEntry[] };
            }
          | undefined,
      ): { starters: string[]; playerIds: string[]; irIds: string[]; playerPoints: Record<string, number> } => {
        const boxEntries =
          side?.rosterForCurrentScoringPeriod?.entries ??
          side?.rosterForMatchupPeriod?.entries ??
          [];
        const starterRows: { rank: number; id: string; order: number }[] = [];
        const playerIds: string[] = [];
        const irIds: string[] = [];
        const playerPoints: Record<string, number> = {};
        const seen = new Set<string>();

        for (const entry of boxEntries) {
          const sleeperId = resolveEspnBoxPlayer(entry);
          const slot = entry.lineupSlotId ?? -1;
          const pts = sleeperId ? espnBoxEntryPoints(entry, safeWeek) : 0;

          if (sleeperId) {
            playerPoints[sleeperId] = roundHundredths(pts);
            if (!seen.has(sleeperId)) {
              seen.add(sleeperId);
              playerIds.push(sleeperId);
            }
          }

          if (slot === 21) {
            if (sleeperId) irIds.push(sleeperId);
            continue;
          }
          const token = ESPN_SLOT_TOKEN[slot];
          if (!token) continue;
          // Keep an empty starter slot when identity resolution misses so
          // index alignment with rosterPositions (FLX/K/DEF) stays intact.
          starterRows.push({
            rank: starterSlotDisplayRank(token),
            id: sleeperId ?? "",
            order: starterRows.length,
          });
        }

        starterRows.sort((a, b) => a.rank - b.rank || a.order - b.order);
        return {
          starters: starterRows.map((r) => r.id),
          playerIds,
          irIds,
          playerPoints,
        };
      };

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
            roster: row.home,
          },
          {
            rosterId: Number(row.away?.teamId ?? 0),
            points: Number(row.away?.totalPointsLive ?? row.away?.totalPoints ?? 0),
            projected: Number(
              row.away?.totalProjectedPointsLive ?? row.away?.totalProjectedPoints ?? 0,
            ),
            roster: row.away,
          },
        ];
        for (const side of sides) {
          if (!side.rosterId) continue;
          const meta = byId.get(side.rosterId);
          const lineup = parseEspnSideRoster(side.roster);
          entries.push({
            rosterId: side.rosterId,
            matchupId,
            points: roundHundredths(side.points),
            projectedPoints: roundHundredths(side.projected),
            winProbabilityPct: null,
            teamName: meta?.teamName ?? `Team ${side.rosterId}`,
            owner: meta?.owner ?? "",
            logo: meta?.logo ?? null,
            starters: lineup.starters,
            playerIds: lineup.playerIds,
            irIds: lineup.irIds,
            playerPoints: lineup.playerPoints,
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

  const [rows, rosters, users, nflState] = await Promise.all([
    json<Record<string, unknown>[]>(`${BASE}/league/${leagueId}/matchups/${safeWeek}`),
    json<
      {
        roster_id: number;
        owner_id: string | null;
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
    json<{ week?: number }>(`${BASE}/state/nfl`),
  ]);
  if (!rows?.length) return null;

  const currentNflWeek = Math.max(1, Number(nflState?.week ?? 0) || 0);
  // Current + future weeks: Sleeper matchups reuse the live roster, so attach
  // current reserve. Past weeks: reconstruct IR from slot transactions.
  const attachLiveReserve = currentNflWeek > 0 && Number(safeWeek) >= currentNflWeek;
  const historicalIrByRoster = attachLiveReserve
    ? new Map<number, string[]>()
    : await reconstructSleeperIrByRoster(leagueId, safeWeek);

  const reserveByRoster = new Map<number, string[]>();
  for (const r of rosters ?? []) {
    reserveByRoster.set(
      r.roster_id,
      (r.reserve ?? []).map((p) => String(p)).filter(Boolean),
    );
  }

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
      // Preserve empty starter slots ("0") so lineup positions stay aligned to
      // roster_positions — never filter them out or later slots shift left.
      const starters = (
        Array.isArray(row["starters"]) ? (row["starters"] as (string | null)[]) : []
      ).map((id) => (id && id !== "0" ? String(id) : ""));

      // Week roster from the matchup payload — historical source of truth for bench.
      const fromPlayers = (
        Array.isArray(row["players"]) ? (row["players"] as (string | null)[]) : []
      )
        .map((id) => (id && id !== "0" ? String(id) : ""))
        .filter(Boolean);
      const playerIdSet = new Set<string>([
        ...fromPlayers,
        ...starters.filter(Boolean),
        ...Object.keys(playerPoints),
      ]);
      const playerIds = [...playerIdSet];

      let irIds = attachLiveReserve
        ? (reserveByRoster.get(rosterId) ?? [])
        : (historicalIrByRoster.get(rosterId) ?? []);
      // Only keep IR players who were actually on this week's roster.
      if (irIds.length && playerIds.length) {
        const onRoster = new Set(playerIds);
        irIds = irIds.filter((id) => onRoster.has(id));
      }
      // Soft fallback: live reserve players who were on this week's roster and
      // not starting — covers IR moves that never emitted slot metadata.
      if (!attachLiveReserve && irIds.length === 0) {
        const liveReserve = reserveByRoster.get(rosterId) ?? [];
        const starterSet = new Set(starters.filter(Boolean));
        const onRoster = new Set(playerIds);
        irIds = liveReserve.filter((id) => onRoster.has(id) && !starterSet.has(id));
      }

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
        playerIds,
        irIds,
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
  metadata?: {
    to_slot?: string;
    from_slot?: string;
    is_draft?: boolean;
    [key: string]: unknown;
  } | null;
  action_type?: string;
  execution_type?: string;
  scoring_period?: number;
};

type IdentityPlayer = {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
};

/** Strip suffixes / punctuation so ESPN + Sleeper display names can match. */
function sanitizePlayerSearchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Linear name scan across the identity catalog when keyed lookups miss
 * (Sleeper's NFL dump often omits espn_id — name matching is the bridge).
 */
function defenseIdentityKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/d\s*\/?\s*st|dst|defense|special teams/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? sanitizePlayerSearchName(parts[parts.length - 1]!) : "";
}

function findIdentityBySanitizedName(
  index: IdentityIndex,
  playerNameText: string,
): IdentityPlayer | null {
  const cleanSearchName = sanitizePlayerSearchName(playerNameText);
  if (!cleanSearchName) return null;

  const keyed = index.byName.get(normalizeName(playerNameText));
  if (keyed) return keyed;

  const defKey = defenseIdentityKey(playerNameText);
  if (defKey) {
    for (const p of index.bySleeper.values()) {
      if ((p.pos ?? "").toUpperCase() !== "DEF") continue;
      if (sanitizePlayerSearchName(p.name) === defKey) return p;
      if (p.team && sanitizePlayerSearchName(p.team) === defKey) return p;
      if (sanitizePlayerSearchName(p.id) === defKey) return p;
    }
  }

  for (const p of index.bySleeper.values()) {
    if (sanitizePlayerSearchName(p.name) === cleanSearchName) return p;
  }
  return null;
}

/**
 * Platform-aware player resolution for activity / transaction feeds.
 * Keeps ESPN numeric ids from being treated as Sleeper ids (no data bleed),
 * and falls back to sanitized full-name matching when foreign ids miss.
 */
function resolvePlayerFromTransaction(
  index: IdentityIndex,
  rawId: string | number | null | undefined,
  opts?: { playerNameText?: string | null; isEspnLeague?: boolean },
): IdentityPlayer | null {
  const cleanId = rawId != null ? String(rawId).trim() : "";
  const isEspnLeague = Boolean(opts?.isEspnLeague);
  const playerNameText = opts?.playerNameText?.trim() || "";
  const asNum = cleanId ? Number(cleanId) : NaN;

  // PASS 1: Sleeper leagues resolve directly against the Sleeper id map.
  if (!isEspnLeague && cleanId) {
    const sleeperHit = index.bySleeper.get(cleanId);
    if (sleeperHit) return sleeperHit;
  }

  if (isEspnLeague && cleanId) {
    // PASS 2a: ESPN team defenses are NEGATIVE ids (-(16000 + proTeamId)).
    // Resolve these BEFORE any espn_id lookup — abs(-16027) is Jeremy Harris's
    // athlete espn_id, which must never win over Buccaneers D/ST.
    if (Number.isFinite(asNum) && asNum < 0) {
      const abbr = espnProTeamAbbr(Math.abs(asNum) - 16000);
      if (abbr) {
        const defHit = index.bySleeper.get(abbr);
        if (defHit && (defHit.pos ?? "").toUpperCase() === "DEF") return defHit;
      }
      // Name fallback for defenses when team map misses.
      if (playerNameText) {
        const nameHit = findIdentityBySanitizedName(index, playerNameText);
        if (nameHit && (nameHit.pos ?? "").toUpperCase() === "DEF") return nameHit;
      }
      return null;
    }

    // PASS 2b: Exact espn_id match only — never abs()/sign-flip athlete ids.
    const espnHit = index.byEspn.get(cleanId);
    if (espnHit) return espnHit;
  }

  // PASS 3: Cross-platform sanitized name fallback (keyed + linear scan).
  if (playerNameText) {
    const nameHit = findIdentityBySanitizedName(index, playerNameText);
    if (nameHit) return nameHit;
  }

  return null;
}

/** ESPN NFL pro-team id → abbreviation (used for D/ST playerIds). */
const ESPN_PRO_TEAM_ABBR: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

function espnProTeamAbbr(proTeamId: number): string | null {
  return ESPN_PRO_TEAM_ABBR[proTeamId] ?? null;
}

type EspnPlayerMeta = { name: string; pos?: string; team?: string };

/**
 * Resolve ESPN playerIds → display meta, then match into the Sleeper catalog.
 * Fantasy mTransactions2 items usually omit fullName; the public athlete API
 * fills the gap when Sleeper's espn_id field is null/missing.
 */
async function loadEspnPlayerMetaByIds(
  playerIds: string[],
): Promise<Map<string, EspnPlayerMeta>> {
  const out = new Map<string, EspnPlayerMeta>();
  const ids = [...new Set(playerIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return out;

  const fetchOne = async (id: string) => {
    const asNum = Number(id);
    // Team defenses: ESPN uses negative ids; athlete card 404s — map by team.
    if (Number.isFinite(asNum) && asNum < 0) {
      const abbr = espnProTeamAbbr(Math.abs(asNum) - 16000);
      if (abbr) {
        out.set(id, { name: `${abbr} D/ST`, pos: "DEF", team: abbr });
        out.set(String(asNum), { name: `${abbr} D/ST`, pos: "DEF", team: abbr });
      }
      return;
    }

    try {
      const res = await fetch(
        `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(id)}`,
        { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        athlete?: {
          id?: string | number;
          displayName?: string;
          fullName?: string;
          position?: { abbreviation?: string };
          team?: { abbreviation?: string };
        };
      };
      const athlete = data.athlete;
      const name = (athlete?.displayName ?? athlete?.fullName)?.trim();
      if (!name) return;
      const meta: EspnPlayerMeta = {
        name,
        ...(athlete?.position?.abbreviation
          ? { pos: athlete.position.abbreviation }
          : {}),
        ...(athlete?.team?.abbreviation ? { team: athlete.team.abbreviation } : {}),
      };
      out.set(id, meta);
      if (athlete?.id != null) out.set(String(athlete.id), meta);
    } catch {
      // Ignore individual athlete lookup failures.
    }
  };

  // Bound concurrency so a large waiver week doesn't stampede ESPN.
  const concurrency = 8;
  for (let i = 0; i < ids.length; i += concurrency) {
    await Promise.all(ids.slice(i, i + concurrency).map(fetchOne));
  }

  return out;
}

function activityMoveFromHit(
  hit: IdentityPlayer | null,
  rawId: string,
  action: LeagueActivityMove["action"],
  fallbackName?: string | null,
): LeagueActivityMove {
  return {
    playerId: hit?.id ?? rawId,
    name: hit?.name ?? (fallbackName?.trim() || `Player ${rawId}`),
    pos: hit?.pos?.trim() || "FA",
    team: hit?.team?.trim() || "FA",
    action,
  };
}

function playerChip(
  index: IdentityIndex,
  playerId: string,
  opts?: { playerNameText?: string | null; isEspnLeague?: boolean },
): string {
  const hit = resolvePlayerFromTransaction(index, playerId, opts);
  const name = hit?.name ?? opts?.playerNameText?.trim() ?? `Player ${playerId}`;
  const pos = hit?.pos?.trim() || "FA";
  const team = hit?.team?.trim() || "FA";
  return `${name} (${pos} - ${team})`;
}

function sleeperMove(
  index: IdentityIndex,
  playerId: string,
  action: LeagueActivityMove["action"],
): LeagueActivityMove {
  const hit = resolvePlayerFromTransaction(index, playerId, { isEspnLeague: false });
  return activityMoveFromHit(hit, playerId, action);
}

function espnItemPlayerName(item: {
  playerId?: number;
  playerName?: string;
  player?: { fullName?: string };
  playerPoolEntry?: { player?: { fullName?: string } };
}): string | undefined {
  const full =
    item.playerPoolEntry?.player?.fullName ??
    item.player?.fullName ??
    item.playerName;
  return typeof full === "string" && full.trim() ? full.trim() : undefined;
}

function espnMove(
  index: IdentityIndex,
  playerId: number | undefined,
  action: LeagueActivityMove["action"],
  playerNameText?: string | null,
): LeagueActivityMove | null {
  if (playerId == null && !playerNameText?.trim()) return null;
  const raw = playerId != null ? String(playerId) : playerNameText!.trim();
  const hit = resolvePlayerFromTransaction(index, playerId, {
    isEspnLeague: true,
    ...(playerNameText != null ? { playerNameText } : {}),
  });
  return activityMoveFromHit(hit, raw, action, playerNameText);
}

function teamLabel(map: Map<number, string>, rosterId: number | undefined): string {
  if (rosterId == null) return "Unknown Team";
  return map.get(rosterId) ?? `Team ${rosterId}`;
}

/**
 * Ban draft-board acquisitions from the League Activity timeline.
 * Only in-season waivers, free agents, trades, drops, and IR moves remain.
 */
function isDraftActivityTransaction(txn: {
  type?: string | null;
  action_type?: string | null;
  execution_type?: string | null;
  executionType?: string | null;
  scoring_period?: number | null;
  scoringPeriodId?: number | null;
  metadata?: { is_draft?: boolean; [key: string]: unknown } | null;
  items?: { type?: string | null }[] | null;
}): boolean {
  if (txn.metadata?.is_draft === true) return true;

  const type = String(txn.type ?? "").trim().toUpperCase();
  const actionType = String(txn.action_type ?? "").trim().toUpperCase();
  const executionType = String(txn.execution_type ?? txn.executionType ?? "")
    .trim()
    .toUpperCase();

  if (
    type === "DRAFT" ||
    type.includes("DRAFT") ||
    actionType === "DRAFT" ||
    actionType.includes("DRAFT") ||
    executionType === "DRAFT" ||
    executionType.includes("DRAFT")
  ) {
    return true;
  }

  // ESPN draft selections often land as ADD rows in scoring period 0 / preseason.
  const scoringPeriod = Number(txn.scoring_period ?? txn.scoringPeriodId);
  if (
    Number.isFinite(scoringPeriod) &&
    scoringPeriod <= 0 &&
    (type === "ADD" || type === "FREEAGENT" || type.includes("ADD"))
  ) {
    return true;
  }

  // Any item coded as a draft pick → entire transaction is draft noise.
  if ((txn.items ?? []).some((item) => String(item.type ?? "").toUpperCase().includes("DRAFT"))) {
    return true;
  }

  return false;
}

/** ESPN free-agent / waiver pool uses 0 or -1; real fantasy clubs are positive ids. */
function isEspnFantasyTeamId(id: number | null | undefined): id is number {
  return typeof id === "number" && Number.isFinite(id) && id > 0;
}

/**
 * Resolve the manager who executed an ESPN transaction.
 * Prefer transaction-level teamId; never treat FA pool (0 / -1) as a club.
 */
function resolveEspnActingTeamId(txn: {
  teamId?: number | null;
  items?: { type?: string; fromTeamId?: number; toTeamId?: number }[];
}): number | undefined {
  if (isEspnFantasyTeamId(txn.teamId)) return txn.teamId;

  const items = txn.items ?? [];
  for (const item of items) {
    const type = String(item.type ?? "").toUpperCase();
    if (type.includes("ADD") && isEspnFantasyTeamId(item.toTeamId)) return item.toTeamId;
    if (type.includes("DROP") && isEspnFantasyTeamId(item.fromTeamId)) return item.fromTeamId;
  }
  for (const item of items) {
    if (isEspnFantasyTeamId(item.toTeamId)) return item.toTeamId;
    if (isEspnFantasyTeamId(item.fromTeamId)) return item.fromTeamId;
  }
  return undefined;
}

function espnManagerTeamName(
  teamMap: Map<number, string>,
  teams: {
    id?: number;
    abbrev?: string;
    name?: string;
    location?: string;
    nickname?: string;
  }[],
  teamId: number | undefined,
): string {
  if (!isEspnFantasyTeamId(teamId)) return "Manager Team";

  const mapped = teamMap.get(teamId)?.trim();
  if (mapped && !/^Team\s+0$/i.test(mapped)) return mapped;

  const matched = teams.find((t) => Number(t.id) === teamId);
  const resolved =
    espnTeamName(matched as never)?.trim() ||
    matched?.abbrev?.trim() ||
    matched?.name?.trim() ||
    "";
  if (resolved) return resolved;

  return `Team ${teamId}`;
}

function formatSleeperTransaction(
  txn: SleeperTxn,
  teams: Map<number, string>,
  index: IdentityIndex,
): LeagueActivityEvent[] {
  // Forceful exclusion: draft-day picks never enter the activity feed.
  if (isDraftActivityTransaction(txn)) return [];

  const at = Number(txn.status_updated ?? txn.created ?? 0);
  if (!at) return [];

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

  // Only keep live in-season front-office activity.
  if (!isTrade && !isWaiver && !isFreeAgent && !isActualIRMove) return [];

  const status = String(txn.status ?? "").toLowerCase();
  const adds = Object.entries(txn.adds ?? {});
  const drops = Object.entries(txn.drops ?? {});
  const id = String(txn.transaction_id ?? `${type}-${at}-${adds.map(([p]) => p).join("-")}`);

  if (isTrade) {
    if (status && status !== "complete" && status !== "failed") return [];
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
    if (!parts.length) return [];
    const prefix = status === "failed" ? "TRADE REJECTED" : "TRADE COMPLETED";
    return [
      {
        id,
        at,
        kind: "trade",
        text: `${prefix}: ${parts.join(", ")}`,
        teamName: null,
        moves,
      },
    ];
  }

  // Waivers / free agents: group strictly by roster_id so Team A's open-bench
  // add never inherits Team B's drop from the same transaction payload.
  if (isWaiver || isFreeAgent) {
    // Block failed / losing blind bids — only successful executions reach the feed.
    if (status && status !== "complete" && status !== "successful") return [];

    const kind: LeagueActivityEvent["kind"] = isWaiver ? "waiver" : "free_agent";
    const addSource = isWaiver ? "from waivers" : "as a free agent";

    const rosterIds = new Set<number>();
    for (const [, rosterId] of adds) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }
    for (const [, rosterId] of drops) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }
    for (const rosterId of txn.roster_ids ?? []) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }

    const events: LeagueActivityEvent[] = [];
    for (const rosterId of rosterIds) {
      // Ironclad isolation: only players whose mapped roster_id matches this block.
      const rosterAdds = adds.filter(([, rid]) => Number(rid) === rosterId);
      const rosterDrops = drops.filter(([, rid]) => Number(rid) === rosterId);
      if (!rosterAdds.length && !rosterDrops.length) continue;

      const team = teamLabel(teams, rosterId);
      const addMoves = rosterAdds
        .map(([pid]) => sleeperMove(index, pid, "add"))
        .filter((m): m is LeagueActivityMove => Boolean(m));
      // Drop list is roster-scoped only — empty when the club filled an open slot.
      const dropMoves = rosterDrops
        .map(([pid]) => sleeperMove(index, pid, "drop"))
        .filter((m): m is LeagueActivityMove => Boolean(m));

      const eventId = `${id}-r${rosterId}`;
      if (rosterAdds.length && rosterDrops.length) {
        const added = rosterAdds.map(([pid]) => playerChip(index, pid)).join(", ");
        const dropped = rosterDrops.map(([pid]) => playerChip(index, pid)).join(", ");
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} ADDED ${added} ${addSource}, DROPPED ${dropped}`,
          teamName: team,
          moves: [...addMoves, ...dropMoves],
        });
        continue;
      }

      if (rosterAdds.length) {
        const added = rosterAdds.map(([pid]) => playerChip(index, pid)).join(", ");
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} ADDED ${added} ${addSource}`,
          teamName: team,
          moves: addMoves,
        });
        continue;
      }

      if (rosterDrops.length) {
        const dropped = rosterDrops.map(([pid]) => playerChip(index, pid)).join(", ");
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} DROPPED ${dropped}`,
          teamName: team,
          moves: dropMoves,
        });
      }
    }
    return events;
  }

  if (isActualIRMove) {
    // Mirror waiver gate: unfinished / failed IR moves stay off the feed.
    if (status && status !== "complete" && status !== "successful") return [];

    const primaryRoster =
      adds[0]?.[1] ?? drops[0]?.[1] ?? txn.roster_ids?.[0] ?? undefined;
    const team = teamLabel(teams, primaryRoster);
    const irPlayers = adds.length ? adds : drops;
    if (!irPlayers.length) return [];
    const labeled = irPlayers.map(([pid]) => playerChip(index, pid)).join(", ");
    return [
      {
        id,
        at,
        kind: "ir",
        text: `${team} PLACED ${labeled} on Injured Reserve`,
        teamName: team,
        moves: irPlayers.map(([pid]) => sleeperMove(index, pid, "ir")),
      },
    ];
  }

  return [];
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

/** ESPN mTransactions2 only returns rows when scoringPeriodId + filterType are set. */
const ESPN_ACTIVITY_TXN_TYPES = [
  "FREEAGENT",
  "WAIVER",
  "TRADE_ACCEPT",
  "TRADE_UPHOLD",
] as const;

type EspnActivityTxn = {
  id?: number | string;
  proposedDate?: number;
  processDate?: number;
  type?: string;
  status?: string;
  /** Acting fantasy team for waiver / FA / roster moves. */
  teamId?: number;
  executionType?: string;
  execution_type?: string;
  scoringPeriodId?: number;
  scoring_period?: number;
  action_type?: string;
  members?: unknown[];
  items?: {
    type?: string;
    playerId?: number;
    playerName?: string;
    fromTeamId?: number;
    toTeamId?: number;
    player?: { fullName?: string };
    playerPoolEntry?: { player?: { fullName?: string } };
  }[];
};

/** Pull FA / waiver / trade rows for one ESPN scoring period. */
async function loadEspnTransactionsForPeriod(
  leagueId: string,
  year: number,
  scoringPeriodId: number,
  s2?: string | null,
  swid?: string | null,
): Promise<EspnActivityTxn[]> {
  const filter = JSON.stringify({
    transactions: { filterType: { value: [...ESPN_ACTIVITY_TXN_TYPES] } },
  });
  const data = await espnJson<{ transactions?: EspnActivityTxn[] }>(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(leagueId)}?view=mTransactions2&scoringPeriodId=${scoringPeriodId}`,
    s2,
    swid,
    { "X-Fantasy-Filter": filter },
  );
  return data?.transactions ?? [];
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
      // Teams + status first — mTransactions2 needs scoringPeriodId or it
      // returns no `transactions` key at all (empty League Activity feed).
      const league = await espnJson<{
        status?: {
          latestScoringPeriod?: number;
          currentMatchupPeriod?: number;
          scoringPeriodId?: number;
        };
        teams?: {
          id?: number;
          abbrev?: string;
          name?: string;
          location?: string;
          nickname?: string;
          roster?: {
            entries?: {
              playerId?: number;
              playerPoolEntry?: { id?: number; player?: { fullName?: string } };
            }[];
          };
        }[];
      }>(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(clean)}?view=mTeam&view=mRoster&view=mStatus`,
        s2,
        swid,
      );
      const teams = league?.teams ?? [];
      if (!teams.length) continue;
      const teamMap = new Map<number, string>();
      for (const t of teams) {
        if (!isEspnFantasyTeamId(t.id)) continue;
        teamMap.set(t.id, espnTeamName(t as never) ?? t.abbrev ?? `Team ${t.id}`);
      }

      const latestPeriod = Math.max(
        1,
        Number(
          league?.status?.latestScoringPeriod ??
            league?.status?.scoringPeriodId ??
            league?.status?.currentMatchupPeriod ??
            1,
        ) || 1,
      );
      // Mirror Sleeper: recent weeks only (current + prior 3).
      const periods = Array.from({ length: Math.min(latestPeriod, 4) }, (_, i) => latestPeriod - i).filter(
        (w) => w >= 1,
      );
      const weekLists = await Promise.all(
        periods.map((period) => loadEspnTransactionsForPeriod(clean, year, period, s2, swid)),
      );
      const rawTxns: EspnActivityTxn[] = [];
      const seenTxnIds = new Set<string>();
      for (const list of weekLists) {
        for (const txn of list) {
          const key = String(txn.id ?? `${txn.processDate ?? txn.proposedDate ?? ""}-${txn.type ?? ""}`);
          if (seenTxnIds.has(key)) continue;
          seenTxnIds.add(key);
          rawTxns.push(txn);
        }
      }

      // ESPN transaction items usually omit fullName — seed names from live
      // rosters, then resolve remaining ESPN ids via the public athlete API
      // and map them onto the Sleeper identity catalog (same pool as the UI cache).
      const espnMetaById = new Map<string, EspnPlayerMeta>();
      for (const t of teams) {
        for (const e of t.roster?.entries ?? []) {
          const pid = e.playerId ?? e.playerPoolEntry?.id;
          const name = e.playerPoolEntry?.player?.fullName?.trim();
          if (pid != null && name) espnMetaById.set(String(pid), { name });
        }
      }

      const txnPlayerIds: string[] = [];
      for (const txn of rawTxns) {
        for (const item of txn.items ?? []) {
          if (item.playerId != null) txnPlayerIds.push(String(item.playerId));
          const inline = espnItemPlayerName(item);
          if (item.playerId != null && inline) {
            espnMetaById.set(String(item.playerId), {
              name: inline,
              ...(espnMetaById.get(String(item.playerId)) ?? {}),
            });
          }
        }
      }

      const missingMeta = [...new Set(txnPlayerIds)].filter((id) => {
        if (!espnMetaById.get(id)?.name) return true;
        // D/ST negative ids need the team-abbr bridge even when a label exists.
        const n = Number(id);
        return Number.isFinite(n) && n < 0;
      });
      if (missingMeta.length) {
        const fetched = await loadEspnPlayerMetaByIds(missingMeta);
        for (const [id, meta] of fetched) {
          const prev = espnMetaById.get(id);
          espnMetaById.set(id, {
            name: meta.name || prev?.name || "",
            pos: meta.pos ?? prev?.pos,
            team: meta.team ?? prev?.team,
          });
        }
      }

      const nameForEspnItem = (item: {
        playerId?: number;
        playerName?: string;
        player?: { fullName?: string };
        playerPoolEntry?: { player?: { fullName?: string } };
      }): string | undefined =>
        espnItemPlayerName(item) ??
        (item.playerId != null ? espnMetaById.get(String(item.playerId))?.name : undefined);

      const events: LeagueActivityEvent[] = [];
      for (const txn of rawTxns) {
        // Forceful exclusion: draft-board records never enter the activity feed.
        if (isDraftActivityTransaction(txn)) continue;

        const at = Number(txn.processDate ?? txn.proposedDate ?? 0);
        if (!at) continue;
        const status = String(txn.status ?? "").toLowerCase();
        const items = txn.items ?? [];
        const id = String(txn.id ?? `${at}`);
        const adds = items.filter((i) => {
          const type = String(i.type ?? "").toUpperCase();
          if (type.includes("DRAFT")) return false;
          return (
            type.includes("ADD") ||
            (isEspnFantasyTeamId(i.toTeamId) && !isEspnFantasyTeamId(i.fromTeamId))
          );
        });
        const drops = items.filter((i) => {
          const type = String(i.type ?? "").toUpperCase();
          if (type.includes("DRAFT")) return false;
          return (
            type.includes("DROP") ||
            (isEspnFantasyTeamId(i.fromTeamId) && !isEspnFantasyTeamId(i.toTeamId))
          );
        });
        const isTrade = String(txn.type ?? "").toUpperCase().includes("TRADE") || items.some((i) => String(i.type ?? "").toUpperCase().includes("TRADE"));

        const chipFor = (item: (typeof items)[number]) => {
          if (item.playerId == null && !nameForEspnItem(item)) return "Unknown Player";
          const raw = item.playerId != null ? String(item.playerId) : "unknown";
          const nameText = nameForEspnItem(item);
          return playerChip(index, raw, {
            isEspnLeague: true,
            ...(nameText ? { playerNameText: nameText } : {}),
          });
        };

        if (isTrade) {
          const byTeam = new Map<number, string[]>();
          const moves: LeagueActivityMove[] = [];
          for (const item of items) {
            const itemType = String(item.type ?? "").toUpperCase();
            if (itemType.includes("DRAFT")) continue;
            const to = item.toTeamId;
            if (!isEspnFantasyTeamId(to) || item.playerId == null) continue;
            const list = byTeam.get(to) ?? [];
            list.push(chipFor(item));
            byTeam.set(to, list);
            const move = espnMove(index, item.playerId, "add", nameForEspnItem(item));
            if (move) moves.push(move);
          }
          for (const item of drops) {
            const move = espnMove(index, item.playerId, "drop", nameForEspnItem(item));
            if (move) moves.push(move);
          }
          const parts = [...byTeam.entries()].map(
            ([teamId, players]) =>
              `${espnManagerTeamName(teamMap, teams, teamId)} received ${players.join(", ")}`,
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

        // Non-trade moves: skip failed / losing / cancelled bids.
        if (
          status &&
          (status === "failed" ||
            status === "pre_executed" ||
            status.includes("fail") ||
            status.includes("reject") ||
            status.includes("unsuccessful") ||
            status.includes("cancel"))
        ) {
          continue;
        }

        const primaryTeam = resolveEspnActingTeamId(txn);
        const team = espnManagerTeamName(teamMap, teams, primaryTeam);
        const espnType = String(txn.type ?? "").toLowerCase();
        // Skip residual draft / commissioner noise that slipped past the gate.
        if (espnType.includes("draft") || espnType.includes("keeper")) continue;

        const espnIsWaiver = espnType.includes("waiver");
        const espnIsFreeAgent =
          espnType.includes("freeagent") ||
          espnType.includes("free_agent") ||
          espnType === "add" ||
          espnType === "drop" ||
          espnType.includes("free agent");
        const espnIsActualIR =
          espnType.includes("injury") ||
          espnType === "ir" ||
          espnType.includes("injured") ||
          (!espnIsWaiver && !espnIsFreeAgent && espnType.includes("ir"));

        // Only emit known in-season activity kinds.
        if (!espnIsWaiver && !espnIsFreeAgent && !espnIsActualIR && !adds.length && !drops.length) {
          continue;
        }

        // Scope adds/drops to the acting fantasy club only — never borrow
        // another team's drop when this club filled an open roster slot.
        const rosterAdds = isEspnFantasyTeamId(primaryTeam)
          ? adds.filter((i) => Number(i.toTeamId) === primaryTeam)
          : adds;
        const rosterDrops = isEspnFantasyTeamId(primaryTeam)
          ? drops.filter((i) => Number(i.fromTeamId) === primaryTeam)
          : [];

        if (rosterAdds.length && rosterDrops.length) {
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} ADDED ${rosterAdds.map((i) => chipFor(i)).join(", ")} from waivers, DROPPED ${rosterDrops.map((i) => chipFor(i)).join(", ")}`,
            teamName: team,
            moves: [
              ...rosterAdds
                .map((i) => espnMove(index, i.playerId, "add", nameForEspnItem(i)))
                .filter((m): m is LeagueActivityMove => Boolean(m)),
              ...rosterDrops
                .map((i) => espnMove(index, i.playerId, "drop", nameForEspnItem(i)))
                .filter((m): m is LeagueActivityMove => Boolean(m)),
            ],
          });
        } else if (rosterAdds.length) {
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} ADDED ${rosterAdds.map((i) => chipFor(i)).join(", ")} as a free agent`,
            teamName: team,
            moves: rosterAdds
              .map((i) => espnMove(index, i.playerId, "add", nameForEspnItem(i)))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        } else if (rosterDrops.length && espnIsActualIR) {
          events.push({
            id,
            at,
            kind: "ir",
            text: `${team} PLACED ${rosterDrops.map((i) => chipFor(i)).join(", ")} on Injured Reserve`,
            teamName: team,
            moves: rosterDrops
              .map((i) => espnMove(index, i.playerId, "ir", nameForEspnItem(i)))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        } else if (rosterDrops.length) {
          // Pure drop — free agency cut, not an IR placement.
          events.push({
            id,
            at,
            kind: espnIsWaiver ? "waiver" : "free_agent",
            text: `${team} DROPPED ${rosterDrops.map((i) => chipFor(i)).join(", ")}`,
            teamName: team,
            moves: rosterDrops
              .map((i) => espnMove(index, i.playerId, "drop", nameForEspnItem(i)))
              .filter((m): m is LeagueActivityMove => Boolean(m)),
          });
        } else if (espnIsActualIR && drops.length) {
          events.push({
            id,
            at,
            kind: "ir",
            text: `${team} PLACED ${drops.map((i) => chipFor(i)).join(", ")} on Injured Reserve`,
            teamName: team,
            moves: drops
              .map((i) => espnMove(index, i.playerId, "ir", nameForEspnItem(i)))
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
      for (const event of formatSleeperTransaction(txn, teamMap, index)) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        events.push(event);
      }
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

let identityCache: { at: number; index: IdentityIndex; version: number } | null = null;
const IDENTITY_TTL = 12 * 60 * 60 * 1000;
/** Bump when espn_id indexing rules change so hot servers drop poisoned maps. */
const IDENTITY_INDEX_VERSION = 2;

const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

async function loadIdentityIndex(): Promise<IdentityIndex> {
  const now = Date.now();
  if (
    identityCache &&
    identityCache.version === IDENTITY_INDEX_VERSION &&
    now - identityCache.at < IDENTITY_TTL
  ) {
    return identityCache.index;
  }

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
    // Exact espn_id key only. Never register abs()/negated variants — ESPN
    // D/ST ids are negative and collide with athlete espn_ids
    // (-16027 Buccaneers vs 16027 Jeremy Harris).
    if (p?.espn_id != null && String(p.espn_id).trim() !== "") {
      index.byEspn.set(String(p.espn_id).trim(), entry);
    }
    if (p?.yahoo_id) index.byYahoo.set(String(p.yahoo_id), entry);
    const nk = normalizeName(name);
    if (nk && !index.byName.has(nk)) index.byName.set(nk, entry);
    // Defense nickname / team-abbr aliases for ESPN "Buccaneers D/ST" labels.
    if ((entry.pos ?? "").toUpperCase() === "DEF") {
      const defKey = defenseIdentityKey(name);
      if (defKey && !index.byName.has(defKey)) index.byName.set(defKey, entry);
      if (entry.team) {
        const teamKey = normalizeName(entry.team);
        if (teamKey && !index.byName.has(teamKey)) index.byName.set(teamKey, entry);
      }
    }
  }

  identityCache = { at: now, index, version: IDENTITY_INDEX_VERSION };
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

import {
  emptyRoster,
  type DraftOrderEntry,
  type LeagueSettingsDetail,
  type RosterSlotKey,
} from "./league-settings";
import { espnJson, espnTeamName, loadUserLeagues, sleeperAvatar, type EspnTeam } from "./league.server";
import { loadLeagueScoring } from "./scoring.server";

const SLEEPER = "https://api.sleeper.app/v1";

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function titleCase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function emptyDetail(platform: string): LeagueSettingsDetail {
  return {
    platform,
    hostLeagueId: null,
    leagueName: null,
    teamName: null,
    avatar: null,
    season: null,
    status: null,
    leagueType: null,
    teams: null,
    playoffTeams: null,
    playoffStartWeek: null,
    waiverType: null,
    waiverBudget: null,
    tradeDeadlineWeek: null,
    tradeDeadlineDate: null,
    roster: emptyRoster(),
    scoring: {},
    draft: { type: null, status: null, rounds: null, position: null, date: null, budget: null, order: [] },
  };
}

// ---------------------------------------------------------------------------
// Sleeper
// ---------------------------------------------------------------------------

/** Sleeper roster tokens -> settings slot keys. IDP tokens (DL/LB/DB/IDP_FLEX) are dropped. */
const SLEEPER_SLOT: Record<string, RosterSlotKey> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "WRRB",
  REC_FLEX: "WRTE",
  SUPER_FLEX: "SFLEX",
  K: "K",
  DEF: "DEF",
  BN: "BN",
};

const SLEEPER_STATUS: Record<string, string> = {
  pre_draft: "Pre-Draft",
  drafting: "Drafting",
  in_season: "In Season",
  post_season: "Playoffs",
  complete: "Complete",
};

type SleeperLeague = {
  league_id: string;
  name?: string;
  season?: string;
  status?: string;
  avatar?: string | null;
  total_rosters?: number;
  draft_id?: string | null;
  roster_positions?: string[];
  scoring_settings?: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

type SleeperUser = {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string; avatar?: string };
};

type SleeperDraft = {
  type?: string;
  status?: string;
  start_time?: number | null;
  settings?: { rounds?: number; budget?: number };
  draft_order?: Record<string, number> | null;
  slot_to_roster_id?: Record<string, number> | null;
};

async function resolveSleeper(identifier: string): Promise<{ leagueId: string | null; userId: string | null }> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return { leagueId: null, userId: null };
  const season = new Date().getFullYear();

  if (/^\d{6,}$/.test(clean)) {
    const direct = await json<{ league_id?: string }>(`${SLEEPER}/league/${clean}`);
    if (direct?.league_id) return { leagueId: clean, userId: null };
    for (const year of [season, season - 1]) {
      const leagues = await json<{ league_id: string }[]>(`${SLEEPER}/user/${clean}/leagues/nfl/${year}`);
      if (leagues?.[0]?.league_id) return { leagueId: leagues[0].league_id, userId: clean };
    }
    return { leagueId: null, userId: clean };
  }

  const user = await json<{ user_id?: string }>(`${SLEEPER}/user/${encodeURIComponent(clean)}`);
  if (!user?.user_id) return { leagueId: null, userId: null };
  const leagues = await loadUserLeagues(clean);
  return { leagueId: leagues[0]?.id ?? null, userId: user.user_id };
}

async function loadSleeperSettings(identifier: string): Promise<LeagueSettingsDetail> {
  const out = emptyDetail("sleeper");
  const { leagueId, userId } = await resolveSleeper(identifier);
  if (!leagueId) return out;

  const [league, users, rosters] = await Promise.all([
    json<SleeperLeague>(`${SLEEPER}/league/${leagueId}`),
    json<SleeperUser[]>(`${SLEEPER}/league/${leagueId}/users`),
    json<{ roster_id: number; owner_id: string | null }[]>(`${SLEEPER}/league/${leagueId}/rosters`),
  ]);
  if (!league) return out;
  const draft = league.draft_id ? await json<SleeperDraft>(`${SLEEPER}/draft/${league.draft_id}`) : null;

  const s = league.settings ?? {};
  const userById = new Map((users ?? []).map((u) => [u.user_id, u]));
  const me = userId ? userById.get(userId) : undefined;
  const teamLabel = (u: SleeperUser | undefined, fallback: string) =>
    u?.metadata?.team_name?.trim() || u?.display_name || fallback;

  out.hostLeagueId = leagueId;
  out.leagueName = league.name ?? null;
  out.teamName = me ? teamLabel(me, "") || null : null;
  out.avatar = me?.metadata?.avatar || sleeperAvatar(me?.avatar) || sleeperAvatar(league.avatar) || null;
  out.season = league.season ?? null;
  out.status = league.status ? (SLEEPER_STATUS[league.status] ?? titleCase(league.status)) : null;

  const type = num(s["type"]);
  const bestBall = num(s["best_ball"]) === 1;
  const baseType = type === 2 ? "Dynasty" : type === 1 ? "Keeper" : "Redraft";
  out.leagueType = bestBall ? `Best Ball ${baseType}` : baseType;
  out.teams = league.total_rosters ?? num(s["num_teams"]);
  out.playoffTeams = num(s["playoff_teams"]);
  out.playoffStartWeek = num(s["playoff_week_start"]);

  const waiver = num(s["waiver_type"]);
  out.waiverType = waiver === 2 ? "FAAB" : waiver === 1 ? "Reverse Standings" : "Rolling";
  out.waiverBudget = waiver === 2 ? num(s["waiver_budget"]) : null;
  const deadline = num(s["trade_deadline"]);
  out.tradeDeadlineWeek = deadline && deadline < 99 ? deadline : null;

  for (const pos of league.roster_positions ?? []) {
    const key = SLEEPER_SLOT[String(pos).toUpperCase()];
    if (key) out.roster[key] += 1;
  }
  out.roster.IR = num(s["reserve_slots"]) ?? 0;
  out.roster.TAXI = num(s["taxi_slots"]) ?? 0;

  for (const [k, v] of Object.entries(league.scoring_settings ?? {})) {
    const n = num(v);
    if (n != null) out.scoring[k] = n;
  }

  if (draft) {
    out.draft.type = titleCase(draft.type ?? null);
    out.draft.status = draft.status ? (SLEEPER_STATUS[draft.status] ?? titleCase(draft.status)) : null;
    out.draft.rounds = num(draft.settings?.rounds);
    out.draft.date = draft.start_time ? Number(draft.start_time) : null;
    out.draft.budget = draft.type === "auction" ? num(draft.settings?.budget) : null;

    const ownerByRoster = new Map((rosters ?? []).map((r) => [r.roster_id, r.owner_id]));
    const order: DraftOrderEntry[] = [];
    if (draft.slot_to_roster_id && Object.keys(draft.slot_to_roster_id).length) {
      for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id)) {
        const ownerId = ownerByRoster.get(Number(rosterId)) ?? null;
        const u = ownerId ? userById.get(ownerId) : undefined;
        order.push({ pick: Number(slot), team: teamLabel(u, `Team ${rosterId}`), isMine: !!userId && ownerId === userId });
      }
    } else if (draft.draft_order) {
      for (const [uid, slot] of Object.entries(draft.draft_order)) {
        order.push({ pick: Number(slot), team: teamLabel(userById.get(uid), `Slot ${slot}`), isMine: uid === userId });
      }
    }
    order.sort((a, b) => a.pick - b.pick);
    out.draft.order = order;
    out.draft.position =
      (userId ? num(draft.draft_order?.[userId]) : null) ?? order.find((o) => o.isMine)?.pick ?? null;
  }

  return out;
}

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

/** ESPN lineup slot ids -> settings slot keys. IDP (8-15), P (18) and HC (19) are dropped. */
const ESPN_SLOT: Record<number, RosterSlotKey> = {
  0: "QB",
  2: "RB",
  3: "WRRB",
  4: "WR",
  5: "WRTE",
  6: "TE",
  7: "SFLEX",
  16: "DEF",
  17: "K",
  20: "BN",
  21: "IR",
  23: "FLEX",
};

type EspnSettingsView = {
  seasonId?: number;
  status?: { isActive?: boolean; currentMatchupPeriod?: number };
  draftDetail?: { drafted?: boolean; inProgress?: boolean };
  settings?: {
    name?: string;
    size?: number;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scheduleSettings?: { playoffTeamCount?: number; matchupPeriodCount?: number };
    draftSettings?: {
      type?: string;
      date?: number;
      pickOrder?: number[];
      keeperCount?: number;
      auctionBudget?: number;
    };
    acquisitionSettings?: {
      isUsingAcquisitionBudget?: boolean;
      acquisitionBudget?: number;
      waiverOrderReset?: boolean;
    };
    tradeSettings?: { deadlineDate?: number };
  };
  teams?: EspnTeam[];
};

async function loadEspnSettings(
  identifier: string,
  s2?: string | null,
  swid?: string | null,
): Promise<LeagueSettingsDetail> {
  const out = emptyDetail("espn");
  const id = identifier.trim();
  if (!/^\d+$/.test(id)) return out;
  const season = new Date().getFullYear();
  const swidGuid = swid?.trim().replace(/[{}]/g, "").toUpperCase() ?? null;

  let view: EspnSettingsView | null = null;
  for (const year of [season, season - 1]) {
    const res = await espnJson<EspnSettingsView>(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${encodeURIComponent(id)}?view=mSettings&view=mTeam&view=mStatus&view=mDraftDetail`,
      s2,
      swid,
    );
    if (res?.settings && (res.teams ?? []).length) {
      view = res;
      break;
    }
  }
  if (!view?.settings) return out;

  const set = view.settings;
  const teams = view.teams ?? [];
  const isMine = (t: EspnTeam) => {
    if (!swidGuid) return false;
    return [...(t.owners ?? []), t.primaryOwner, t.swid].some(
      (c) => c && c.replace(/[{}]/g, "").toUpperCase() === swidGuid,
    );
  };
  const mine = teams.find(isMine);

  out.hostLeagueId = id;
  out.leagueName = set.name ?? null;
  out.teamName = espnTeamName(mine);
  out.avatar = mine?.logo ?? null;
  out.season = view.seasonId ? String(view.seasonId) : null;
  out.status = view.draftDetail?.inProgress
    ? "Drafting"
    : !view.draftDetail?.drafted
      ? "Pre-Draft"
      : view.status?.isActive === false
        ? "Complete"
        : "In Season";

  const draftSet = set.draftSettings ?? {};
  out.leagueType = (draftSet.keeperCount ?? 0) > 0 ? "Keeper" : "Redraft";
  out.teams = set.size ?? teams.length;
  out.playoffTeams = num(set.scheduleSettings?.playoffTeamCount);
  const regWeeks = num(set.scheduleSettings?.matchupPeriodCount);
  out.playoffStartWeek = regWeeks ? regWeeks + 1 : null;

  const acq = set.acquisitionSettings ?? {};
  out.waiverType = acq.isUsingAcquisitionBudget ? "FAAB" : acq.waiverOrderReset ? "Reverse Standings" : "Rolling";
  out.waiverBudget = acq.isUsingAcquisitionBudget ? num(acq.acquisitionBudget) : null;
  out.tradeDeadlineDate = num(set.tradeSettings?.deadlineDate) || null;

  let rounds = 0;
  for (const [raw, count] of Object.entries(set.rosterSettings?.lineupSlotCounts ?? {})) {
    const slotId = Number(raw);
    const c = Number(count) || 0;
    if (slotId !== 21) rounds += c;
    const key = ESPN_SLOT[slotId];
    if (key) out.roster[key] += c;
  }

  const scoring = await loadLeagueScoring(id, "espn", s2, swid);
  out.scoring = { ...scoring.map };

  const teamById = new Map(teams.map((t) => [t.id, t]));
  out.draft.order = (draftSet.pickOrder ?? []).map((teamId, i) => {
    const t = teamById.get(teamId);
    return { pick: i + 1, team: espnTeamName(t) ?? `Team ${teamId}`, isMine: !!mine && t?.id === mine.id };
  });
  out.draft.type = titleCase(draftSet.type ?? null);
  out.draft.status = out.status === "Pre-Draft" || out.status === "Drafting" ? out.status : "Complete";
  out.draft.rounds = rounds || null;
  out.draft.position = out.draft.order.find((o) => o.isMine)?.pick ?? null;
  out.draft.date = num(draftSet.date) || null;
  out.draft.budget = draftSet.type === "AUCTION" ? num(draftSet.auctionBudget) : null;

  return out;
}

/** Normalized league settings for a saved connection (Sleeper or ESPN). */
export async function loadConnectionSettings(
  identifier: string,
  platform: string,
  s2?: string | null,
  swid?: string | null,
): Promise<LeagueSettingsDetail> {
  if (platform === "espn") return loadEspnSettings(identifier, s2, swid);
  if (platform === "sleeper") return loadSleeperSettings(identifier);
  return emptyDetail(platform);
}

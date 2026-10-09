/**
 * Map native TiDB league payloads onto the synced-league contracts
 * (LeagueRosters, LeagueWeekMatchups, Standings, settings, activity)
 * so mobile / playbook hooks work without UI changes.
 *
 * All calls use existing createServerFn wrappers (auth + linkId). Never Fluid
 * host pulls or Sleeper league APIs for native.
 */

import type {
  LeagueActivityEvent,
  LeagueActivityMove,
  LeagueRosters,
  LeagueRosterTeam,
  LeagueTransactionLog,
  LeagueWeekMatchups,
  Standings,
  WeeklyMatchupEntry,
} from "@/lib/league.server";
import {
  emptyRoster,
  ROSTER_SLOT_KEYS,
  type LeagueSettingsDetail,
  type RosterSlotKey,
} from "@/lib/league-settings";
import {
  getNativeLeagueBoard,
  getNativeMatchupWeek,
  getNativeStandings,
  listNativeTransactions,
} from "@/lib/native-league.functions";
import {
  fetchNativeLiveWeekStats,
  overlayNativeLiveMatchupScores,
} from "@/lib/native-live-scoring";
import { defaultScoringMap, type ScoringFormat, type ScoringMap } from "@/lib/scoring-map";
import type { LeagueScoring } from "@/lib/scoring.server";

const RESERVE_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Expand commissioner slot counts into a starter-slot template (Sleeper-style). */
export function nativeRosterSlotsToPositions(slots: Record<string, number> | null | undefined): string[] {
  const out: string[] = [];
  for (const key of ROSTER_SLOT_KEYS) {
    if (RESERVE_SLOTS.has(key)) continue;
    const n = Math.max(0, Math.floor(Number(slots?.[key] ?? 0)));
    for (let i = 0; i < n; i += 1) out.push(key);
  }
  return out;
}

function rosterRecord(slots: Record<string, number> | null | undefined): Record<RosterSlotKey, number> {
  const base = emptyRoster();
  for (const key of ROSTER_SLOT_KEYS) {
    const n = Math.floor(Number(slots?.[key] ?? 0));
    if (Number.isFinite(n) && n > 0) base[key] = n;
  }
  return base;
}

function formatFromRec(rec: number): ScoringFormat {
  return rec >= 1 ? "ppr" : rec > 0 ? "half" : "std";
}

function waiverTypeLabel(raw: string): string {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "faab") return "FAAB";
  if (t === "reverse") return "Reverse Standings";
  return "Rolling Waivers";
}

function tradeReviewLabel(vetoMode: string): string | null {
  const m = String(vetoMode ?? "").trim().toLowerCase();
  if (m === "commissioner") return "Commissioner veto";
  if (m === "none") return "No veto";
  return null;
}

function mapTxnKind(type: string): LeagueActivityEvent["kind"] {
  const t = String(type ?? "").toLowerCase();
  if (t.includes("trade")) return "trade";
  if (t.includes("waiver")) return "waiver";
  if (t.includes("ir")) return "ir";
  return "free_agent";
}

function stubMove(playerId: string, action: LeagueActivityMove["action"]): LeagueActivityMove {
  return {
    playerId,
    name: `Player ${playerId}`,
    pos: "FA",
    team: "FA",
    action,
  };
}

type NativeBoard = NonNullable<Awaited<ReturnType<typeof getNativeLeagueBoard>>>;
type NativeMatchupWeek = NonNullable<Awaited<ReturnType<typeof getNativeMatchupWeek>>>;
type NativeStandingsPayload = NonNullable<Awaited<ReturnType<typeof getNativeStandings>>>;
type NativeTxn = Awaited<ReturnType<typeof listNativeTransactions>>[number];

export function nativeBoardToLeagueRosters(
  board: NativeBoard,
  startersByTeamId: Record<string, string[]> = {},
): LeagueRosters {
  const myTeamId = board.summary.teamId;
  const rosterByTeam = new Map(board.rosters.map((r) => [r.teamId, r]));
  const rosterPositions = nativeRosterSlotsToPositions(board.rosterSlots);

  const teams: LeagueRosterTeam[] = board.teams.map((t) => {
    const roster = rosterByTeam.get(t.id);
    const playerIds = (roster?.playerIds ?? []).map((id) => String(id));
    const irIds = (roster?.irPlayerIds ?? []).map((id) => String(id));
    const starters = (startersByTeamId[String(t.id)] ?? []).map((id) => String(id ?? "").trim());
    // Pad/truncate to starter template length so mobile slot alignment works.
    const starterIds =
      rosterPositions.length > 0
        ? rosterPositions.map((_, i) => starters[i] ?? "")
        : starters;
    return {
      slot: t.id,
      team: t.teamName || `Team ${t.id}`,
      owner: t.isAi ? "AI" : "",
      isMine: myTeamId != null && t.id === myTeamId,
      logo: t.avatarUrl,
      playerIds,
      playerNames: [],
      starterIds,
      starterNames: [],
      irIds,
      irNames: [],
    };
  });

  const mine = teams.find((t) => t.isMine);
  return {
    myTeamName: mine?.team ?? null,
    teams,
    rosterPositions,
  };
}

export function nativeMatchupWeekToLeagueWeekMatchups(
  payload: NativeMatchupWeek,
  board: NativeBoard | null,
): LeagueWeekMatchups {
  const rosterByTeam = new Map((board?.rosters ?? []).map((r) => [r.teamId, r]));
  const logoByTeam = new Map((board?.teams ?? []).map((t) => [t.id, t.avatarUrl]));
  const rosterPositions = nativeRosterSlotsToPositions(board?.rosterSlots);
  const starterLen = rosterPositions.length;

  const entries: WeeklyMatchupEntry[] = [];
  for (const m of payload.matchups) {
    for (const side of [m.home, m.away] as const) {
      const startersRaw = (payload.startersByTeamId[String(side.teamId)] ?? [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean);
      const roster = rosterByTeam.get(side.teamId);
      const rosterIds = (roster?.playerIds ?? []).map(String);
      // When no saved lineup for this week, paint roster ids so Matchup isn't empty
      // (Team page seeds + persists; Matchup must not depend on visiting Team first).
      const source = startersRaw.length ? startersRaw : rosterIds;
      const starters =
        starterLen > 0
          ? Array.from({ length: starterLen }, (_, i) => source[i] ?? "")
          : source.slice();
      entries.push({
        rosterId: side.teamId,
        matchupId: m.matchupId,
        points: Number(side.points) || 0,
        projectedPoints: 0,
        winProbabilityPct: null,
        teamName: side.teamName,
        owner: "",
        logo: logoByTeam.get(side.teamId) ?? null,
        starters,
        playerIds: rosterIds,
        irIds: (roster?.irPlayerIds ?? []).map(String),
        playerPoints: { ...side.playerPoints },
      });
    }
  }

  return { week: payload.week, entries, source: "sleeper" };
}

export function nativeStandingsToStandings(
  payload: NativeStandingsPayload,
  board: NativeBoard,
): Standings {
  const avatarById = new Map(board.teams.map((t) => [t.id, t.avatarUrl]));
  const sorted = [...payload.standings].sort(
    (a, b) =>
      a.rank - b.rank ||
      b.wins - a.wins ||
      b.pointsFor - a.pointsFor ||
      a.teamId - b.teamId,
  );
  return {
    league: {
      id: board.summary.leagueId,
      name: board.summary.name,
      season: String(board.summary.seasonYear),
      teams: board.summary.teamCount,
      status: board.summary.status,
      scoring: board.summary.scoringPreset || "half",
    },
    rows: sorted.map((r) => ({
      rosterId: r.teamId,
      team: r.teamName,
      owner: "",
      avatar: avatarById.get(r.teamId) ?? null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      streak: null,
    })),
  };
}

export function nativeBoardToLeagueSettings(board: NativeBoard): LeagueSettingsDetail {
  const c = board.commissioner;
  const myTeamId = board.summary.teamId;
  const mineTeam = board.teams.find((t) => t.id === myTeamId);
  const ordered = [...board.teams].sort((a, b) => a.waiverPriority - b.waiverPriority);
  const reviewDays =
    c.tradeReviewHours > 0 ? Math.round((c.tradeReviewHours / 24) * 10) / 10 : null;

  return {
    platform: "native",
    hostLeagueId: board.summary.leagueId,
    leagueName: c.name || board.summary.name,
    teamName: mineTeam?.teamName ?? null,
    avatar: mineTeam?.avatarUrl ?? null,
    season: String(c.seasonYear || board.summary.seasonYear),
    status: board.summary.status,
    leagueType: board.summary.leagueType,
    teams: c.teamCount || board.summary.teamCount,
    playoffTeams: c.playoffTeams,
    playoffStartWeek: board.playoffStartWeek,
    waiverType: waiverTypeLabel(c.waiverType),
    waiverBudget: c.waiverBudget,
    tradeDeadlineWeek: c.tradeDeadlineWeek,
    tradeDeadlineDate: null,
    waiverPeriodDays: c.waiverPeriodDays,
    waiverOrder: ordered.map((t, i) => ({
      priority: i + 1,
      team: t.teamName,
      isMine: myTeamId != null && t.id === myTeamId,
    })),
    tradeReviewDays: reviewDays,
    maxTrades: c.maxTradesPerSeason,
    tradeReviewType: tradeReviewLabel(c.tradeVetoMode),
    roster: rosterRecord(c.rosterSlots ?? board.rosterSlots),
    scoring: { ...(c.scoringSettings ?? {}) },
    draft: {
      type: c.draftFormat || board.summary.draftMode,
      status: board.summary.draftStatus,
      rounds: null,
      position: mineTeam?.draftSlot ?? null,
      date: null,
      budget: null,
      order: board.teams
        .slice()
        .sort((a, b) => a.draftSlot - b.draftSlot)
        .map((t) => ({
          pick: t.draftSlot,
          team: t.teamName,
          isMine: myTeamId != null && t.id === myTeamId,
        })),
    },
  };
}

export function nativeBoardToLeagueScoring(board: NativeBoard): LeagueScoring {
  const map = { ...(board.commissioner.scoringSettings ?? {}) } as ScoringMap;
  const format = formatFromRec(Number(map["rec"] ?? 0));
  if (Object.keys(map).length === 0) {
    return { format: "half", map: defaultScoringMap("half"), source: "default" };
  }
  return {
    format,
    map,
    source: "sleeper",
    resolvedId: board.summary.leagueId,
  };
}

export function nativeTransactionsToLeagueTransactionLog(
  rows: NativeTxn[],
  board: NativeBoard,
): LeagueTransactionLog {
  const teamNames = board.teams.map((t) => t.teamName);
  const events: LeagueActivityEvent[] = rows.map((r) => {
    const kind = mapTxnKind(r.type);
    const team = r.teamName?.trim() || null;
    const moves: LeagueActivityMove[] = [];
    if (r.addPlayerId) moves.push(stubMove(r.addPlayerId, "add"));
    if (r.dropPlayerId) {
      moves.push(stubMove(r.dropPlayerId, kind === "ir" ? "ir" : "drop"));
    }
    const addBit = r.addPlayerId ? `added ${r.addPlayerId}` : "";
    const dropBit = r.dropPlayerId ? `dropped ${r.dropPlayerId}` : "";
    const action = [addBit, dropBit].filter(Boolean).join(", ") || r.type;
    const text = team ? `${team} ${action}` : action;
    const at = Date.parse(r.createdAt);
    return {
      id: `native-txn-${r.id}`,
      at: Number.isFinite(at) ? at : Date.now(),
      kind,
      text,
      teamName: team,
      moves,
    };
  });
  return {
    events,
    teams: teamNames,
    currentWeek: board.currentWeek,
  };
}

/** Board fetch for adapters (soft-empty on miss). */
export async function fetchNativeBoardForLink(linkId: string): Promise<NativeBoard | null> {
  const clean = String(linkId ?? "").trim();
  if (!clean) return null;
  try {
    return (await getNativeLeagueBoard({ data: { linkId: clean } })) ?? null;
  } catch {
    return null;
  }
}

export async function fetchNativeLeagueRosters(linkId: string): Promise<LeagueRosters | null> {
  const board = await fetchNativeBoardForLink(linkId);
  if (!board) return null;
  let startersByTeamId: Record<string, string[]> = {};
  try {
    const week = await getNativeMatchupWeek({
      data: { linkId, week: board.currentWeek },
    });
    startersByTeamId = week?.startersByTeamId ?? {};
  } catch {
    /* starters optional — roster ids still paint the team */
  }
  return nativeBoardToLeagueRosters(board, startersByTeamId);
}

export async function fetchNativeWeekMatchups(
  linkId: string,
  week: number,
  currentWeek: number | null,
): Promise<LeagueWeekMatchups | null> {
  const clean = String(linkId ?? "").trim();
  if (!clean || week < 1) return null;

  let payload: NativeMatchupWeek | null = null;
  try {
    payload = (await getNativeMatchupWeek({ data: { linkId: clean, week } })) ?? null;
  } catch {
    return null;
  }
  if (!payload) return null;

  const board = await fetchNativeBoardForLink(clean);
  // Overlay when viewing the NFL current week or the league's own current week
  // (commissioners may advance for testing while NFL week is unchanged).
  const boardWeek = board?.currentWeek ?? null;
  const isLiveWeek =
    (currentWeek != null && week === currentWeek) ||
    (boardWeek != null && week === boardWeek);

  if (isLiveWeek && payload.matchups.length) {
    const seasonYear = payload.seasonYear || board?.summary.seasonYear || new Date().getUTCFullYear();
    const live = await fetchNativeLiveWeekStats(seasonYear, week).catch(() => null);
    const stats = live?.stats;
    if (stats && Object.keys(stats).length > 0) {
      const scoring = (payload.scoringSettings ?? {}) as ScoringMap;
      const overlaid = overlayNativeLiveMatchupScores(
        payload.matchups,
        payload.startersByTeamId,
        stats,
        scoring,
      );
      payload = { ...payload, matchups: overlaid };
    }
  }

  return nativeMatchupWeekToLeagueWeekMatchups(payload, board);
}

export async function fetchNativeStandings(linkId: string): Promise<Standings | null> {
  const board = await fetchNativeBoardForLink(linkId);
  if (!board) return null;
  let payload: NativeStandingsPayload | null = null;
  try {
    payload = (await getNativeStandings({ data: { linkId } })) ?? null;
  } catch {
    return null;
  }
  if (!payload) return null;
  return nativeStandingsToStandings(payload, board);
}

export async function fetchNativeLeagueSettings(linkId: string): Promise<LeagueSettingsDetail | null> {
  const board = await fetchNativeBoardForLink(linkId);
  if (!board) return null;
  return nativeBoardToLeagueSettings(board);
}

export async function fetchNativeLeagueScoring(linkId: string): Promise<LeagueScoring> {
  const board = await fetchNativeBoardForLink(linkId);
  if (!board) {
    return { format: "half", map: defaultScoringMap("half"), source: "default" };
  }
  return nativeBoardToLeagueScoring(board);
}

export async function fetchNativeTransactionLog(linkId: string): Promise<LeagueTransactionLog> {
  const empty: LeagueTransactionLog = { events: [], teams: [], currentWeek: 1 };
  const board = await fetchNativeBoardForLink(linkId);
  if (!board) return empty;
  let rows: NativeTxn[] = [];
  try {
    rows = (await listNativeTransactions({ data: { linkId, limit: 60 } })) ?? [];
  } catch {
    return {
      events: [],
      teams: board.teams.map((t) => t.teamName),
      currentWeek: board.currentWeek,
    };
  }
  return nativeTransactionsToLeagueTransactionLog(rows, board);
}

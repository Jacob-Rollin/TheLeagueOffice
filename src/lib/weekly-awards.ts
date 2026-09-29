import { hydrateActivityMove } from "@/components/dashboard/ActivityFeed";
import type { Player } from "@/lib/draft";
import type { LeagueActivityEvent } from "@/lib/league.functions";
import type { WeeklyMatchupEntry } from "@/lib/league.server";
import { starterRequirements } from "@/lib/power-rankings";

/** Deterministic editorial phrasing banks — continuations after the lead identity. */
export const HIGH_SCORE_LINES = [
  "led the league this week with an impressive [PTS]",
  "completely set the scoreboard on fire, posting a massive [PTS] to lead the league",
  "delivered an absolute masterclass performance, dominant from kickoff to lead all scorers with [PTS]",
] as const;

export const BOTTOM_OF_THE_PILE_LINES = [
  "was left in the dust this week with a lowly [PTS]",
  "found themselves stuck in neutral this week, failing to generate momentum and finishing at the bottom with just [PTS]",
] as const;

export const BRAGGING_RIGHTS_LINES = [
  "blew out [LOSER] by [MARGIN] ([W_PTS] to [L_PTS])",
  "left zero room for doubt, delivering a massive [MARGIN] blowout victory over [LOSER] ([W_PTS] to [L_PTS])",
] as const;

export const BAD_BEAT_LINES = [
  "fell to [WINNER] by a razor thin margin of just [MARGIN]. Keep an eye on those stat corrections.",
  "came up short against [WINNER] by only [MARGIN] in a heartbreaker that could swing on a single correction.",
] as const;

export const LUCKY_BREAK_LINES = [
  "owes a gift to whoever made the schedule. They stole a W this week despite [LOSER] being the only team they would have beaten!",
  "caught every break on the schedule, escaping with a win against [LOSER] as the only club they outscored this week.",
] as const;

export const NOT_SO_LUCKY_LINES = [
  "posted a stout [PTS] and still took the loss to [WINNER]. Sometimes the box score is cruel.",
  "piled up [PTS] only to fall to [WINNER] in a tough draw.",
] as const;

export const MANAGER_OF_THE_WEEK_LINES = [
  "ran the sharpest desk of the week at [EFF] coaching efficiency.",
  "maximized the roster board, posting [EFF] coaching efficiency to earn Gridiron Genius.",
] as const;

export const WAIVER_WIRE_GEM_LINES = [
  "paid off immediately for [TEAM], putting up [PTS] after coming off the wire.",
  "delivered [PTS] for [TEAM] in the first look after coming off the wire.",
] as const;

export function pickPhrase(templates: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return templates[hash % templates.length] ?? templates[0] ?? "";
}

export function fillPhrase(template: string, vars: Record<string, string>): string {
  return template.replace(/\[([A-Z_]+)\]/g, (_match, key: string) => vars[key] ?? "");
}

export function pts2(value: number): string {
  return (Number(value) || 0).toFixed(2);
}

export function eff1(value: number): string {
  return Number(value).toFixed(1);
}

/** Wrap a metric token so the narrative renderer can bold it. */
export function metric(value: string): string {
  return `«${value}»`;
}

/** Wrap a team identity so the narrative renderer can bold it (non-interactive). */
export function nameToken(value: string): string {
  return `‹${value}›`;
}

export type BriefPlayer = {
  id: string;
  name: string;
  points: number;
  rosterId: number | null;
  teamName: string;
};

/** Soft franchise label when roster ownership cannot be resolved. */
export const UNNAMED_FRANCHISE = "An Unnamed Franchise";

export type RosterOwnership = {
  rosterId: number;
  teamName: string;
};

/** Map every rostered player id → verified fantasy club from leagueRosters. */
export function buildRosterOwnership(teams: { slot: number; team: string; players: Player[] }[]): Map<
  string,
  RosterOwnership
> {
  const map = new Map<string, RosterOwnership>();
  for (const team of teams) {
    const teamName = team.team?.trim() || UNNAMED_FRANCHISE;
    for (const player of team.players ?? []) {
      if (!player?.id) continue;
      map.set(String(player.id), { rosterId: team.slot, teamName });
    }
  }
  return map;
}

/**
 * Cross-reference a player id against verified leagueRosters ownership.
 * Never invents mock franchise names — only real roster labels or a soft fallback.
 */
export function getTrueRosterName(
  playerId: string,
  ownership: Map<string, RosterOwnership>,
  matchupTeamName?: string | null,
): string {
  const owned = ownership.get(String(playerId));
  if (owned?.teamName?.trim()) return owned.teamName.trim();
  const fromMatchup = matchupTeamName?.trim();
  if (fromMatchup) return fromMatchup;
  return UNNAMED_FRANCHISE;
}

export function getTrueRosterId(
  playerId: string,
  ownership: Map<string, RosterOwnership>,
  matchupRosterId?: number | null,
): number | null {
  const owned = ownership.get(String(playerId));
  if (owned?.rosterId != null) return owned.rosterId;
  if (matchupRosterId != null && matchupRosterId > 0) return matchupRosterId;
  return null;
}

export type EditorialBrief = {
  week: number;
  apexTeam: string;
  apexPoints: number;
  apexLogo: string | null;
  stalledTeam: string;
  stalledPoints: number;
  woodshedWinner: string;
  woodshedLoser: string;
  woodshedMargin: number;
  razorWinner: string;
  razorLoser: string;
  razorMargin: number;
  geniusTeam: string;
  geniusEfficiency: number;
  waiverPlayer: string;
  waiverTeam: string;
  waiverPoints: number;
  waiverLogo: string | null;
  waiverPlayerId: string | null;
  previewFocusTeam: string;
  previewFocusLogo: string | null;
  /** Apex team's top started scorer (roster-locked to the week-high club). */
  mvpPlayer: BriefPlayer | null;
  /** Highest confirmed bench explosion (roster-tagged for win/loss narrative). */
  benchBustPlayer: BriefPlayer | null;
  /**
   * Bench-blame framing for the explosion owner:
   * - won_anyway: club still won despite the leave-in
   * - cost_matchup: club lost and the bench points exceed the loss margin
   */
  benchBustNarrative: "won_anyway" | "cost_matchup" | null;
  /** Matchup-advantage weapon for the preview focus side (started players only). */
  previewStarPlayer: BriefPlayer | null;
  previewPairs: {
    home: string;
    away: string;
    homeProj: number;
    awayProj: number;
    homeLogo: string | null;
    awayLogo: string | null;
  }[];
};

export type RosterPlayerPts = { pos: string; points: number; playerId: string };

export function normalizePos(pos: string): string {
  const p = pos.trim().toUpperCase();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  return p;
}

export function takeTopPoints(rows: RosterPlayerPts[], count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += rows[i]?.points ?? 0;
  return sum;
}

export function coachingEfficiency(
  rosterPlayers: RosterPlayerPts[],
  scoredPoints: number,
  rosterPositions: string[],
): number | null {
  if (!rosterPlayers.length || scoredPoints <= 0) return null;
  const req = starterRequirements(rosterPositions);
  const qbSlots = Math.max(1, req["QB"] ?? 1);
  const rbSlots = Math.max(1, req["RB"] ?? 2);
  const wrSlots = Math.max(1, req["WR"] ?? 2);
  const teSlots = Math.max(1, req["TE"] ?? 1);
  const flexSlots = Math.max(0, req["FLEX"] ?? 1);
  const defSlots = Math.max(1, req["DEF"] ?? 1);
  const kSlots = Math.max(1, req["K"] ?? 1);

  const byPos = (pos: string) =>
    rosterPlayers.filter((p) => p.pos === pos).sort((a, b) => b.points - a.points);

  const qbs = byPos("QB");
  const rbs = byPos("RB");
  const wrs = byPos("WR");
  const tes = byPos("TE");
  const defs = byPos("DEF");
  const ks = byPos("K");

  const remainingFlex = [...rbs.slice(rbSlots), ...wrs.slice(wrSlots), ...tes.slice(teSlots)].sort(
    (a, b) => b.points - a.points,
  );

  const optimal =
    takeTopPoints(qbs, qbSlots) +
    takeTopPoints(rbs, rbSlots) +
    takeTopPoints(wrs, wrSlots) +
    takeTopPoints(tes, teSlots) +
    takeTopPoints(remainingFlex, flexSlots) +
    takeTopPoints(defs, defSlots) +
    takeTopPoints(ks, kSlots);

  if (optimal <= 0) return null;
  return Math.min(100, (scoredPoints / optimal) * 100);
}

export type AwardRow = {
  id: string;
  title: string;
  /** Identity woven into the lead of the narrative sentence. */
  leadName: string;
  /** Continuations after leadName (no duplicated identity). */
  sentence: string;
  rosterId: number | null;
  teamName: string;
  owner: string;
  logo: string | null;
  playerId?: string | null;
  player?: Player | null;
};

/** Suffix-insensitive name → player lookup (D/ST also keyed by nickname and team). */
export function buildPlayersByName(players: Player[]): Map<string, Player> {
  const map = new Map<string, Player>();
  const sanitize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  const defenseKey = (raw: string) => {
    const cleaned = raw
      .toLowerCase()
      .replace(/d\s*\/?\s*st|dst|defense|special teams/g, " ")
      .trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return parts.length ? sanitize(parts[parts.length - 1]!) : "";
  };
  for (const p of players) {
    const key = sanitize(p.name);
    if (key && !map.has(key)) map.set(key, p);
    if (p.pos === "DEF") {
      const defKey = defenseKey(p.name);
      if (defKey && !map.has(defKey)) map.set(defKey, p);
      const teamKey = sanitize(p.team);
      if (teamKey && !map.has(teamKey)) map.set(teamKey, p);
    }
  }
  return map;
}

/** Strip narrative render tokens (bold metrics, team names, player links) to plain text. */
export function plainSentence(sentence: string): string {
  return sentence
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/«([^»]+)»/g, "$1")
    .replace(/‹([^›]+)›/g, "$1")
    .replace(/⟦[^¦⟧]*¦([^⟧]+)⟧/g, "$1")
    .replace(/⟦([^⟧]+)⟧/g, "$1");
}

/** Awards earned by one fantasy team (matched by roster slot, then team name). */
export function awardsForTeam(
  awards: AwardRow[],
  team: { rosterId: number | null; teamName: string | null },
): AwardRow[] {
  const norm = (value: string | null | undefined) =>
    (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const name = norm(team.teamName);
  return awards.filter((award) => {
    if (team.rosterId != null && award.rosterId != null) {
      return Number(award.rosterId) === Number(team.rosterId);
    }
    return Boolean(name) && norm(award.teamName) === name;
  });
}

export type WeekReportTeam = {
  slot: number;
  team: string;
  owner: string;
  logo: string | null;
  players: Player[];
};

export type WeekReportInput = {
  week: number;
  entries: WeeklyMatchupEntry[];
  /** Next week's matchups, used only by the preview article. */
  previewEntries?: WeeklyMatchupEntry[];
  playersById: Map<string, Player>;
  playersByName: Map<string, Player>;
  rosterPositions: string[];
  events: LeagueActivityEvent[];
  teams: WeekReportTeam[];
};

/** Weekly awards + editorial brief for one completed week (Press Room right column). */
export function buildWeekReport(input: WeekReportInput): { awards: AwardRow[]; brief: EditorialBrief } {
  const { week: selectedWeek, playersById, playersByName, rosterPositions, events, teams } = input;
  const matchups = { entries: input.entries };
  const previewMatchups = { entries: input.previewEntries ?? [] };
  const logoBySlot = new Map<number, string | null>();
  for (const team of teams) logoBySlot.set(team.slot, team.logo);

  const emptyBrief: EditorialBrief = {
    week: selectedWeek,
    apexTeam: "",
    apexPoints: 0,
    apexLogo: null,
    stalledTeam: "",
    stalledPoints: 0,
    woodshedWinner: "",
    woodshedLoser: "",
    woodshedMargin: 0,
    razorWinner: "",
    razorLoser: "",
    razorMargin: 0,
    geniusTeam: "",
    geniusEfficiency: 0,
    waiverPlayer: "",
    waiverTeam: "",
    waiverPoints: 0,
    waiverLogo: null,
    waiverPlayerId: null,
    previewFocusTeam: "",
    previewFocusLogo: null,
    mvpPlayer: null,
    benchBustPlayer: null,
    benchBustNarrative: null,
    previewStarPlayer: null,
    previewPairs: [],
  };

  const entries = matchups?.entries ?? [];
  if (entries.length < 2) {
    return {
      awards: [] as AwardRow[],
      brief: emptyBrief,
    };
  }

  const scored = [...entries].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
  const high = scored[0]!;
  const low = scored[scored.length - 1]!;

  const pairs: {
    winner: (typeof entries)[0];
    loser: (typeof entries)[0];
    margin: number;
  }[] = [];

  const byMatchup = new Map<number, typeof entries>();
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
    const aPts = Number(a.points) || 0;
    const bPts = Number(b.points) || 0;
    if (aPts === bPts) continue;
    const winner = aPts > bPts ? a : b;
    const loser = aPts > bPts ? b : a;
    pairs.push({
      winner,
      loser,
      margin: Math.abs(aPts - bPts),
    });
  }

  const blowout = [...pairs].sort((a, b) => b.margin - a.margin)[0] ?? null;
  const badBeat = [...pairs].sort((a, b) => a.margin - b.margin)[0] ?? null;

  const winners = pairs.map((p) => p.winner);
  const losers = pairs.map((p) => p.loser);
  const luckyBreak =
    winners.length > 0
      ? [...winners].sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0))[0]!
      : null;
  const notSoLucky =
    losers.length > 0
      ? [...losers].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))[0]!
      : null;

  let managerOfWeek: {
    entry: (typeof entries)[0];
    efficiency: number;
  } | null = null;

  for (const entry of entries) {
    const rosterPlayers: RosterPlayerPts[] = Object.entries(entry.playerPoints ?? {}).map(
      ([id, pts]) => {
        const player = playersById.get(id);
        return {
          playerId: id,
          pos: normalizePos(player?.pos ?? ""),
          points: Number(pts) || 0,
        };
      },
    );
    const efficiency = coachingEfficiency(
      rosterPlayers,
      Number(entry.points) || 0,
      rosterPositions,
    );
    if (efficiency == null) continue;
    if (!managerOfWeek || efficiency > managerOfWeek.efficiency) {
      managerOfWeek = { entry, efficiency };
    }
  }

  const waiverAddIds = new Set<string>();
  for (const event of events) {
    if (event.kind !== "waiver" && event.kind !== "free_agent") continue;
    for (const move of event.moves ?? []) {
      if (move.action !== "add" || !move.playerId) continue;
      // Map ESPN ids / ghost labels onto the Sleeper catalog before matching
      // boxscore playerPoints (which now use Sleeper anchors).
      const hydrated = hydrateActivityMove(move, playersById, playersByName);
      waiverAddIds.add(String(hydrated.playerId));
      if (hydrated.name) {
        const byName = playersByName.get(
          hydrated.name
            .toLowerCase()
            .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
            .replace(/[^a-z0-9]/g, "")
            .trim(),
        );
        if (byName) waiverAddIds.add(byName.id);
      }
    }
  }

  let waiverGem: {
    player: Player;
    points: number;
    teamName: string;
    owner: string;
    logo: string | null;
  } | null = null;

  for (const entry of entries) {
    // Prefer started adds; when ESPN lineup slots are missing, fall back to
    // any scored rostered waiver add so the article still features a real gem.
    const starterIds = new Set((entry.starters ?? []).map(String).filter(Boolean));
    const rosteredIds = new Set<string>([
      ...starterIds,
      ...(entry.playerIds ?? []).map(String).filter(Boolean),
      ...Object.keys(entry.playerPoints ?? {}),
    ]);
    if (rosteredIds.size === 0) continue;

    for (const [playerId, pts] of Object.entries(entry.playerPoints ?? {})) {
      if (!waiverAddIds.has(playerId)) continue;
      if (starterIds.size > 0 && !starterIds.has(playerId)) continue;
      if (starterIds.size === 0 && !rosteredIds.has(playerId)) continue;
      const player = playersById.get(playerId);
      if (!player) continue;
      const points = Number(pts) || 0;
      if (!waiverGem || points > waiverGem.points) {
        waiverGem = {
          player,
          points,
          teamName: entry.teamName,
          owner: entry.owner,
          logo: entry.logo ?? logoBySlot.get(entry.rosterId) ?? null,
        };
      }
    }
  }

  // Last resort: activity add currently on a league roster (no week points yet).
  if (!waiverGem && waiverAddIds.size && teams.length) {
    for (const team of teams) {
      for (const player of team.players ?? []) {
        if (!waiverAddIds.has(player.id)) continue;
        waiverGem = {
          player,
          points: 0,
          teamName: team.team,
          owner: team.owner,
          logo: team.logo ?? logoBySlot.get(team.slot) ?? null,
        };
        break;
      }
      if (waiverGem) break;
    }
  }

  const previewPairs: EditorialBrief["previewPairs"] = [];
  const previewEntries = previewMatchups?.entries ?? [];
  const previewByMatchup = new Map<number, typeof previewEntries>();
  for (const entry of previewEntries) {
    if (entry.matchupId == null) continue;
    const bucket = previewByMatchup.get(entry.matchupId) ?? [];
    bucket.push(entry);
    previewByMatchup.set(entry.matchupId, bucket);
  }
  for (const pair of previewByMatchup.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    if (!a || !b) continue;
    previewPairs.push({
      home: a.teamName,
      away: b.teamName,
      homeProj: Number(a.projectedPoints) || Number(a.points) || 0,
      awayProj: Number(b.projectedPoints) || Number(b.points) || 0,
      homeLogo: a.logo ?? logoBySlot.get(a.rosterId) ?? null,
      awayLogo: b.logo ?? logoBySlot.get(b.rosterId) ?? null,
    });
  }
  previewPairs.sort(
    (x, y) => Math.max(y.homeProj, y.awayProj) - Math.max(x.homeProj, x.awayProj),
  );

  const previewFocusPair = previewPairs[0] ?? null;
  const previewFocusTeam = previewFocusPair?.away || previewFocusPair?.home || "";
  const previewFocusLogo =
    previewFocusPair?.awayLogo ?? previewFocusPair?.homeLogo ?? null;

  /** Verified fantasy ownership from leagueRosters (player id → club). */
  const rosterOwnership = buildRosterOwnership(teams);

  /** Build scored player rows tagged by verified roster ownership + starter / bench. */
  type LineupTaggedPlayer = BriefPlayer & {
    isStarter: boolean;
    hasLineup: boolean;
  };
  const playersPool: LineupTaggedPlayer[] = [];

  for (const entry of entries) {
    const starterIds = (entry.starters ?? []).map(String).filter(Boolean);
    const starterSet = new Set(starterIds);
    const hasLineup = starterSet.size > 0;
    for (const [playerId, pts] of Object.entries(entry.playerPoints ?? {})) {
      const player = playersById.get(playerId);
      if (!player?.name) continue;
      const rosterId = getTrueRosterId(playerId, rosterOwnership, entry.rosterId);
      const teamName = getTrueRosterName(playerId, rosterOwnership, entry.teamName);
      const isStarter = hasLineup && starterSet.has(playerId);
      playersPool.push({
        id: playerId,
        name: player.name,
        points: Number(pts) || 0,
        rosterId,
        teamName,
        isStarter,
        hasLineup,
      });
    }
  }

  // Isolate the highest scoring STARTER on the apex team's verified roster only.
  const apexRosterId = high.rosterId;
  const topTeamPlayers = playersPool.filter(
    (p) => p.rosterId != null && p.rosterId === apexRosterId,
  );
  const topTeamStarters = topTeamPlayers.filter((p) => p.hasLineup && p.isStarter);
  const teamMvpPlayer =
    [...topTeamStarters].sort((a, b) => b.points - a.points)[0] ?? null;

  // Highest confirmed bench explosion — outcome judged against THAT player's true club.
  const benchPlayers = playersPool.filter((p) => p.hasLineup && !p.isStarter);
  const topBenchExplosion =
    [...benchPlayers].sort((a, b) => b.points - a.points)[0] ?? null;

  const toBriefPlayer = (p: LineupTaggedPlayer | null): BriefPlayer | null =>
    p
      ? {
          id: p.id,
          name: p.name,
          points: p.points,
          rosterId: p.rosterId,
          teamName: p.teamName || UNNAMED_FRANCHISE,
        }
      : null;

  const mvpPlayer = toBriefPlayer(teamMvpPlayer);

  let benchBustPlayer: BriefPlayer | null = null;
  let benchBustNarrative: EditorialBrief["benchBustNarrative"] = null;

  if (topBenchExplosion?.rosterId != null) {
    const benchRosterId = topBenchExplosion.rosterId;
    const benchPair = pairs.find(
      (p) => p.winner.rosterId === benchRosterId || p.loser.rosterId === benchRosterId,
    );
    if (benchPair) {
      const wonAnyway = benchPair.winner.rosterId === benchRosterId;
      if (wonAnyway) {
        benchBustPlayer = toBriefPlayer(topBenchExplosion);
        benchBustNarrative = "won_anyway";
      } else if (benchPair.margin < topBenchExplosion.points) {
        benchBustPlayer = toBriefPlayer(topBenchExplosion);
        benchBustNarrative = "cost_matchup";
      }
    }
  }

  /** Preview focus club's top STARTED weapon, ownership-verified. */
  const resolveTopStartedPlayerOnTeam = (
    teamName: string,
    rosterIdHint?: number | null,
  ): BriefPlayer | null => {
    const hintId =
      rosterIdHint ??
      entries.find((e) => e.teamName === teamName)?.rosterId ??
      teams.find((t) => t.team === teamName)?.slot ??
      null;
    const pool = playersPool.filter((p) => {
      if (!p.hasLineup || !p.isStarter) return false;
      if (hintId != null && p.rosterId === hintId) return true;
      return Boolean(teamName) && p.teamName === teamName;
    });
    const best = [...pool].sort((a, b) => b.points - a.points)[0] ?? null;
    return toBriefPlayer(best);
  };

  const previewFocusRosterId =
    previewEntries.find((e) => e.teamName === previewFocusTeam)?.rosterId ??
    teams.find((t) => t.team === previewFocusTeam)?.slot ??
    null;

  const previewStarPlayer =
    resolveTopStartedPlayerOnTeam(previewFocusTeam, previewFocusRosterId) ||
    resolveTopStartedPlayerOnTeam(high.teamName, high.rosterId) ||
    mvpPlayer;

  const brief: EditorialBrief = {
    week: selectedWeek,
    apexTeam: high.teamName || UNNAMED_FRANCHISE,
    apexPoints: Number(high.points) || 0,
    apexLogo: high.logo ?? logoBySlot.get(high.rosterId) ?? null,
    stalledTeam: low.teamName || UNNAMED_FRANCHISE,
    stalledPoints: Number(low.points) || 0,
    woodshedWinner: blowout?.winner.teamName ?? "",
    woodshedLoser: blowout?.loser.teamName ?? "",
    woodshedMargin: blowout?.margin ?? 0,
    razorWinner: badBeat?.winner.teamName ?? "",
    razorLoser: badBeat?.loser.teamName ?? "",
    razorMargin: badBeat?.margin ?? 0,
    geniusTeam: managerOfWeek?.entry.teamName ?? "",
    geniusEfficiency: managerOfWeek?.efficiency ?? 0,
    waiverPlayer: waiverGem?.player.name ?? "",
    waiverTeam:
      (waiverGem
        ? getTrueRosterName(
            waiverGem.player.id,
            rosterOwnership,
            waiverGem.teamName,
          )
        : "") || "",
    waiverPoints: waiverGem?.points ?? 0,
    waiverLogo: waiverGem?.logo ?? null,
    waiverPlayerId: waiverGem?.player.id ?? null,
    previewFocusTeam,
    previewFocusLogo,
    mvpPlayer,
    benchBustPlayer,
    benchBustNarrative,
    previewStarPlayer,
    previewPairs,
  };

  const awards: AwardRow[] = [
    {
      id: "high-score",
      title: "Apex Performance",
      leadName: high.teamName,
      sentence: fillPhrase(pickPhrase(HIGH_SCORE_LINES, `${selectedWeek}:high:${high.rosterId}`), {
        PTS: metric(`${pts2(Number(high.points) || 0)}pts`),
        TEAM: high.teamName,
      }),
      rosterId: high.rosterId,
      teamName: high.teamName,
      owner: high.owner,
      logo: high.logo ?? logoBySlot.get(high.rosterId) ?? null,
    },
    {
      id: "bottom",
      title: "Stalled Out",
      leadName: low.teamName,
      sentence: fillPhrase(
        pickPhrase(BOTTOM_OF_THE_PILE_LINES, `${selectedWeek}:bottom:${low.rosterId}`),
        {
          PTS: metric(`${pts2(Number(low.points) || 0)}pts`),
          TEAM: low.teamName,
        },
      ),
      rosterId: low.rosterId,
      teamName: low.teamName,
      owner: low.owner,
      logo: low.logo ?? logoBySlot.get(low.rosterId) ?? null,
    },
  ];

  if (blowout) {
    awards.push({
      id: "bragging",
      title: "The Woodshed Award",
      leadName: blowout.winner.teamName,
      sentence: fillPhrase(
        pickPhrase(BRAGGING_RIGHTS_LINES, `${selectedWeek}:brag:${blowout.winner.rosterId}`),
        {
          WINNER: blowout.winner.teamName,
          LOSER: blowout.loser.teamName,
          MARGIN: metric(`${pts2(blowout.margin)}pts`),
          W_PTS: metric(`${pts2(Number(blowout.winner.points) || 0)}pts`),
          L_PTS: metric(`${pts2(Number(blowout.loser.points) || 0)}pts`),
        },
      ),
      rosterId: blowout.winner.rosterId,
      teamName: blowout.winner.teamName,
      owner: blowout.winner.owner,
      logo: blowout.winner.logo ?? logoBySlot.get(blowout.winner.rosterId) ?? null,
    });
  }

  if (badBeat) {
    awards.push({
      id: "bad-beat",
      title: "Razor's Edge",
      leadName: badBeat.loser.teamName,
      sentence: fillPhrase(
        pickPhrase(BAD_BEAT_LINES, `${selectedWeek}:badbeat:${badBeat.loser.rosterId}`),
        {
          WINNER: badBeat.winner.teamName,
          LOSER: badBeat.loser.teamName,
          MARGIN: metric(`${pts2(Number(badBeat.margin))}pts`),
        },
      ),
      rosterId: badBeat.loser.rosterId,
      teamName: badBeat.loser.teamName,
      owner: badBeat.loser.owner,
      logo: badBeat.loser.logo ?? logoBySlot.get(badBeat.loser.rosterId) ?? null,
    });
  }

  if (luckyBreak) {
    const luckyPair =
      pairs.find((p) => Number(p.winner.rosterId) === Number(luckyBreak.rosterId)) ?? null;
    awards.push({
      id: "lucky",
      title: "Houdini Act",
      leadName: luckyBreak.teamName,
      sentence: fillPhrase(
        pickPhrase(LUCKY_BREAK_LINES, `${selectedWeek}:lucky:${luckyBreak.rosterId}`),
        {
          WINNER: luckyBreak.teamName,
          LOSER: luckyPair?.loser.teamName ?? "their opponent",
          PTS: metric(`${pts2(Number(luckyBreak.points) || 0)}pts`),
        },
      ),
      rosterId: luckyBreak.rosterId,
      teamName: luckyBreak.teamName,
      owner: luckyBreak.owner,
      logo: luckyBreak.logo ?? logoBySlot.get(luckyBreak.rosterId) ?? null,
    });
  }

  if (notSoLucky) {
    const nslPair =
      pairs.find((p) => Number(p.loser.rosterId) === Number(notSoLucky.rosterId)) ?? null;
    awards.push({
      id: "not-lucky",
      title: "Tough Pill to Swallow",
      leadName: notSoLucky.teamName,
      sentence: fillPhrase(
        pickPhrase(NOT_SO_LUCKY_LINES, `${selectedWeek}:nsl:${notSoLucky.rosterId}`),
        {
          LOSER: notSoLucky.teamName,
          WINNER: nslPair?.winner.teamName ?? "their opponent",
          PTS: metric(`${pts2(Number(notSoLucky.points) || 0)}pts`),
        },
      ),
      rosterId: notSoLucky.rosterId,
      teamName: notSoLucky.teamName,
      owner: notSoLucky.owner,
      logo: notSoLucky.logo ?? logoBySlot.get(notSoLucky.rosterId) ?? null,
    });
  }

  if (managerOfWeek) {
    awards.push({
      id: "motw",
      title: "Gridiron Genius",
      leadName: managerOfWeek.entry.teamName,
      sentence: fillPhrase(
        pickPhrase(
          MANAGER_OF_THE_WEEK_LINES,
          `${selectedWeek}:motw:${managerOfWeek.entry.rosterId}`,
        ),
        {
          TEAM: managerOfWeek.entry.teamName,
          EFF: metric(`${eff1(managerOfWeek.efficiency)}%`),
        },
      ),
      rosterId: managerOfWeek.entry.rosterId,
      teamName: managerOfWeek.entry.teamName,
      owner: managerOfWeek.entry.owner,
      logo:
        managerOfWeek.entry.logo ??
        logoBySlot.get(managerOfWeek.entry.rosterId) ??
        null,
    });
  }

  if (waiverGem) {
    const gemRoster =
      entries.find((e) => e.teamName === waiverGem.teamName)?.rosterId ??
      teams.find((t) => t.team === waiverGem.teamName)?.slot ??
      null;
    awards.push({
      id: "waiver-gem",
      title: "Waiver Wire Gem",
      leadName: waiverGem.player.name,
      sentence: fillPhrase(
        pickPhrase(WAIVER_WIRE_GEM_LINES, `${selectedWeek}:gem:${waiverGem.player.id}`),
        {
          PLAYER: waiverGem.player.name,
          TEAM: waiverGem.teamName,
          PTS: metric(`${pts2(waiverGem.points)}pts`),
        },
      ),
      rosterId: gemRoster,
      teamName: waiverGem.teamName,
      owner: waiverGem.owner,
      logo: waiverGem.logo,
      playerId: waiverGem.player.id,
      player: waiverGem.player,
    });
  }

  return {
    awards,
    brief,
  };
}

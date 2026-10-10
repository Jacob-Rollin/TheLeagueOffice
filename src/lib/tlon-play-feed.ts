/**
 * The League Network (TLN) Plan A feed: detect fantasy-point jumps between
 * matchup polls and optionally enrich copy from box-score stat deltas.
 * No play-by-play API — field arcs are approximate theater from existing polls.
 */

import type { NflGameProgress } from "@/lib/rolling-live-projection";

export const TLON_MIN_DELTA = 0.5;
export const TLON_MAX_EVENTS = 40;
/** Other-matchup Scoring Update threshold (fantasy points). */
export const TLON_SCORING_UPDATE_MIN = 6;

export type TlonFeedSide = "left" | "right";

export type TlonFeedEvent = {
  id: string;
  at: number;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
  delta: number;
  /** Inferred play / scoring line for the card body. */
  headline: string;
  /** Optional NFL game clock label from the scoreboard. */
  gameLabel?: string | null;
  /** Best-effort yard gain from box-score deltas (rush/rec/pass). */
  yardGain?: number | null;
  kind?: "rush" | "rec" | "pass" | "td" | "other";
};

export type TlonPlayArc = {
  id: string;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
  /** Yard line 0–100 from the left goal (mapped onto grass in TlonField). */
  startPct: number;
  endPct: number;
  yardGain: number;
  headline: string;
  delta: number;
  /** When false, render a center pulse instead of a yard arc. */
  hasSpot: boolean;
};

export type TlonScoringUpdate = {
  id: string;
  at: number;
  matchupId: string;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
  delta: number;
  headline: string;
  leftName: string;
  rightName: string;
  leftFrom: number;
  leftTo: number;
  rightFrom: number;
  rightTo: number;
  leftLogo?: string | null;
  rightLogo?: string | null;
};

type StatLine = Record<string, number>;

const STAT_KEYS = [
  "pass_td",
  "rush_td",
  "rec_td",
  "pass_yd",
  "rush_yd",
  "rec_yd",
  "pass_int",
  "fum_lost",
  "rec",
  "rush_att",
  "pass_cmp",
  "fgm",
  "xpm",
  "sack",
  "int",
  "fum_rec",
  "def_td",
  "safe",
] as const;

function num(stats: StatLine | null | undefined, key: string): number {
  const v = Number(stats?.[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function deltaStat(prev: StatLine | null | undefined, next: StatLine | null | undefined, key: string): number {
  return num(next, key) - num(prev, key);
}

export function extractYardPlay(
  prevStats: StatLine | null | undefined,
  nextStats: StatLine | null | undefined,
): { yards: number; kind: TlonFeedEvent["kind"] } {
  if (!nextStats) return { yards: 0, kind: "other" };
  const rushYd = deltaStat(prevStats, nextStats, "rush_yd");
  const recYd = deltaStat(prevStats, nextStats, "rec_yd");
  const passYd = deltaStat(prevStats, nextStats, "pass_yd");
  const rushTd = deltaStat(prevStats, nextStats, "rush_td");
  const recTd = deltaStat(prevStats, nextStats, "rec_td");
  const passTd = deltaStat(prevStats, nextStats, "pass_td");
  const defTd = deltaStat(prevStats, nextStats, "def_td");

  if (rushYd >= 1 || rushTd > 0) {
    return { yards: Math.max(rushYd, rushTd > 0 ? 1 : 0), kind: rushTd > 0 ? "td" : "rush" };
  }
  if (recYd >= 1 || recTd > 0) {
    return { yards: Math.max(recYd, recTd > 0 ? 1 : 0), kind: recTd > 0 ? "td" : "rec" };
  }
  if (passYd >= 1 || passTd > 0) {
    return { yards: Math.max(passYd, passTd > 0 ? 1 : 0), kind: passTd > 0 ? "td" : "pass" };
  }
  if (defTd > 0) return { yards: 0, kind: "td" };
  return { yards: 0, kind: "other" };
}

/** Build a short inferred headline from box-score deltas between polls. */
export function inferPlayHeadline(
  prevStats: StatLine | null | undefined,
  nextStats: StatLine | null | undefined,
  fantasyDelta: number,
): string {
  if (!nextStats) {
    return fantasyDelta >= 0 ? "Scoring update" : "Points adjustment";
  }

  const parts: string[] = [];
  const passTd = deltaStat(prevStats, nextStats, "pass_td");
  const rushTd = deltaStat(prevStats, nextStats, "rush_td");
  const recTd = deltaStat(prevStats, nextStats, "rec_td");
  const defTd = deltaStat(prevStats, nextStats, "def_td");
  const passYd = deltaStat(prevStats, nextStats, "pass_yd");
  const rushYd = deltaStat(prevStats, nextStats, "rush_yd");
  const recYd = deltaStat(prevStats, nextStats, "rec_yd");
  const rec = deltaStat(prevStats, nextStats, "rec");
  const ints = deltaStat(prevStats, nextStats, "pass_int");
  const fum = deltaStat(prevStats, nextStats, "fum_lost");
  const fgm = deltaStat(prevStats, nextStats, "fgm");
  const xpm = deltaStat(prevStats, nextStats, "xpm");
  const sack = deltaStat(prevStats, nextStats, "sack");
  const defInt = deltaStat(prevStats, nextStats, "int");
  const fumRec = deltaStat(prevStats, nextStats, "fum_rec");
  const safe = deltaStat(prevStats, nextStats, "safe");

  if (passTd > 0) parts.push(passTd === 1 ? "Pass TD" : `${passTd} pass TDs`);
  if (rushTd > 0) parts.push(rushTd === 1 ? "Rush TD" : `${rushTd} rush TDs`);
  if (recTd > 0) parts.push(recTd === 1 ? "Receiving TD" : `${recTd} receiving TDs`);
  if (defTd > 0) parts.push(defTd === 1 ? "Defensive TD" : `${defTd} defensive TDs`);
  if (fgm > 0) parts.push(fgm === 1 ? "Field goal" : `${fgm} field goals`);
  if (xpm > 0) parts.push(xpm === 1 ? "XP made" : `${xpm} XPs`);
  if (sack > 0) parts.push(sack === 1 ? "Sack" : `${sack} sacks`);
  if (defInt > 0) parts.push(defInt === 1 ? "INT" : `${defInt} INTs`);
  if (fumRec > 0) parts.push(fumRec === 1 ? "Fumble recovery" : `${fumRec} fumble recoveries`);
  if (safe > 0) parts.push("Safety");
  if (passYd >= 5) parts.push(`+${Math.round(passYd)} pass yds`);
  if (rushYd >= 3) parts.push(`+${Math.round(rushYd)} rush yds`);
  if (recYd >= 3 || rec > 0) {
    if (recYd >= 3 && rec > 0) parts.push(`+${Math.round(recYd)} rec yds (${rec} rec)`);
    else if (recYd >= 3) parts.push(`+${Math.round(recYd)} rec yds`);
    else parts.push(rec === 1 ? "Reception" : `${rec} receptions`);
  }
  if (ints > 0) parts.push(ints === 1 ? "Interception" : `${ints} interceptions`);
  if (fum > 0) parts.push(fum === 1 ? "Fumble lost" : `${fum} fumbles lost`);

  if (parts.length) return parts.slice(0, 3).join(" · ");
  return fantasyDelta >= 0 ? "Scoring update" : "Points adjustment";
}

export type TlonStarterSnapshot = {
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
  points: number;
  stats?: StatLine | null;
  gameLabel?: string | null;
  matchupId?: string;
};

/**
 * Diff prior vs next starter point maps into feed events (newest first when prepended).
 */
export function diffStarterPoints(
  prev: Map<string, TlonStarterSnapshot> | null,
  next: TlonStarterSnapshot[],
  opts?: { minDelta?: number; now?: number },
): TlonFeedEvent[] {
  const minDelta = opts?.minDelta ?? TLON_MIN_DELTA;
  const now = opts?.now ?? Date.now();
  if (!prev || prev.size === 0) return [];

  const events: TlonFeedEvent[] = [];
  for (const row of next) {
    const before = prev.get(row.playerId);
    if (!before) continue;
    const delta = Math.round((row.points - before.points) * 10) / 10;
    if (Math.abs(delta) < minDelta) continue;

    const yard = extractYardPlay(before.stats ?? null, row.stats ?? null);
    const headline = inferPlayHeadline(before.stats ?? null, row.stats ?? null, delta);
    events.push({
      id: `${row.playerId}-${now}-${delta}`,
      at: now,
      playerId: row.playerId,
      playerName: row.playerName,
      pos: row.pos,
      team: row.team,
      side: row.side,
      delta,
      headline,
      ...(row.gameLabel != null ? { gameLabel: row.gameLabel } : {}),
      ...(yard.yards > 0 ? { yardGain: Math.round(yard.yards) } : {}),
      ...(yard.kind ? { kind: yard.kind } : {}),
    });
  }

  events.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return events;
}

export function snapshotsToMap(rows: TlonStarterSnapshot[]): Map<string, TlonStarterSnapshot> {
  const map = new Map<string, TlonStarterSnapshot>();
  for (const row of rows) map.set(row.playerId, row);
  return map;
}

/** Prepend new events and cap the list. */
export function mergeFeedEvents(existing: TlonFeedEvent[], incoming: TlonFeedEvent[]): TlonFeedEvent[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const next = [...incoming.filter((e) => !seen.has(e.id)), ...existing];
  return next.slice(0, TLON_MAX_EVENTS);
}

/** Approximate ESPN-app style start/end arc from yard gain + scoreboard spot. */
export function buildPlayArc(
  event: TlonFeedEvent,
  progress: NflGameProgress | null | undefined,
): TlonPlayArc {
  const yards = Math.max(0, Number(event.yardGain ?? 0) || 0);
  const team = (event.team || "").trim().toUpperCase();
  const hasPossession =
    Boolean(progress?.possessionAbbr) &&
    progress!.possessionAbbr === team &&
    progress?.phase === "in";
  const yardLine = Number(progress?.yardLine);
  const hasSpot = hasPossession && Number.isFinite(yardLine) && yardLine > 0 && yards >= 1;

  let endPct = 50;
  let startPct = 50;
  if (hasSpot) {
    // Theater: treat scoreboard yardLine as end spot; start = end − gain.
    endPct = Math.max(2, Math.min(98, yardLine));
    startPct = Math.max(2, Math.min(98, endPct - yards));
    // Home teams often drive right→left on TV bugs; flip when home for variety.
    if (progress?.isHome) {
      endPct = 100 - endPct;
      startPct = 100 - startPct;
    }
  }

  return {
    id: `arc-${event.id}`,
    playerId: event.playerId,
    playerName: event.playerName,
    pos: event.pos,
    team: event.team,
    side: event.side,
    startPct,
    endPct,
    yardGain: yards,
    headline: event.headline,
    delta: event.delta,
    hasSpot,
  };
}

export type LeagueMatchupScoreSnap = {
  matchupId: string;
  leftName: string;
  rightName: string;
  leftPoints: number;
  rightPoints: number;
  leftLogo?: string | null;
  rightLogo?: string | null;
  starters: TlonStarterSnapshot[];
};

/** Detect ≥6 pt starter spikes on boards other than the watched matchup. */
export function diffLeagueScoringUpdates(
  prev: Map<string, TlonStarterSnapshot> | null,
  prevScores: Map<string, { left: number; right: number }> | null,
  boards: LeagueMatchupScoreSnap[],
  watchedMatchupId: string | null,
  opts?: { minDelta?: number; now?: number },
): TlonScoringUpdate[] {
  const minDelta = opts?.minDelta ?? TLON_SCORING_UPDATE_MIN;
  const now = opts?.now ?? Date.now();
  if (!prev || prev.size === 0) return [];

  const updates: TlonScoringUpdate[] = [];
  for (const board of boards) {
    if (watchedMatchupId && board.matchupId === watchedMatchupId) continue;
    const prevScore = prevScores?.get(board.matchupId);
    for (const row of board.starters) {
      const before = prev.get(`${board.matchupId}:${row.playerId}`);
      if (!before) continue;
      const delta = Math.round((row.points - before.points) * 10) / 10;
      if (delta < minDelta) continue;
      const headline = inferPlayHeadline(before.stats ?? null, row.stats ?? null, delta);
      const leftFrom = prevScore?.left ?? board.leftPoints - (row.side === "left" ? delta : 0);
      const rightFrom = prevScore?.right ?? board.rightPoints - (row.side === "right" ? delta : 0);
      updates.push({
        id: `su-${board.matchupId}-${row.playerId}-${now}`,
        at: now,
        matchupId: board.matchupId,
        playerId: row.playerId,
        playerName: row.playerName,
        pos: row.pos,
        team: row.team,
        side: row.side,
        delta,
        headline,
        leftName: board.leftName,
        rightName: board.rightName,
        leftFrom: Math.max(0, Math.round(leftFrom * 10) / 10),
        leftTo: Math.round(board.leftPoints * 10) / 10,
        rightFrom: Math.max(0, Math.round(rightFrom * 10) / 10),
        rightTo: Math.round(board.rightPoints * 10) / 10,
        leftLogo: board.leftLogo ?? null,
        rightLogo: board.rightLogo ?? null,
      });
    }
  }
  updates.sort((a, b) => b.delta - a.delta);
  return updates;
}

export function leagueStarterKey(matchupId: string, playerId: string): string {
  return `${matchupId}:${playerId}`;
}

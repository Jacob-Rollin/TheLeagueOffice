/**
 * The League Network (TLN) Plan A feed: detect fantasy-point jumps between
 * matchup polls and optionally enrich copy from box-score stat deltas.
 * No play-by-play API.
 */

export const TLON_MIN_DELTA = 0.5;
export const TLON_MAX_EVENTS = 40;

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
      gameLabel: row.gameLabel ?? null,
    });
  }

  // Larger swings first within the same poll tick.
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

/** True when any watched starter still has meaningful box-score keys changing. */
export function statsTouchRelevantKeys(stats: StatLine | null | undefined): boolean {
  if (!stats) return false;
  return STAT_KEYS.some((k) => num(stats, k) !== 0);
}

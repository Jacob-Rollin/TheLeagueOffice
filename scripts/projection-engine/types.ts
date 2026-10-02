export type Stats = Record<string, number>;

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/** Published projection feeds plus our two nflverse-derived tracks. */
export type SourceKey = "sleeper" | "espn" | "cbs" | "model" | "baseline";

/** Everything the accuracy audit grades. */
export type TrackKey = "engine" | SourceKey;

/** Fantasy points as [standard, half PPR, full PPR]. */
export type Pts = [number, number, number];

export type SourceStatus = "ok" | "fallback" | "down";

export interface SourceHealth {
  status: SourceStatus;
  players: number;
  lastOkAt: string | null;
  note?: string;
}

export interface SourceResult {
  ok: boolean;
  lines: Map<string, Stats>;
  ms: number;
  note?: string;
  /** For sources fetched per position (CBS): positions that came back healthy. */
  okPositions?: Set<Pos>;
}

export interface PlayerEntry {
  name: string;
  pos: Pos;
  team: string;
  opp: string | null;
  kickoff: string | null;
  injury: string | null;
  /** Blended engine stat line in Sleeper stat keys. */
  engine: Stats;
  pts: Partial<Record<TrackKey, Pts>>;
  lines: Partial<Record<SourceKey, Stats>>;
  /** Sources blended into the engine line for this player. */
  used: SourceKey[];
  /** Sources whose line was carried over from an earlier run this week. */
  stale?: SourceKey[];
}

export interface ProjectionFile {
  version: 1;
  season: number;
  week: number;
  generatedAt: string;
  hash: string;
  weights: Record<Pos, Partial<Record<SourceKey, number>>>;
  sources: Record<SourceKey, SourceHealth>;
  players: Record<string, PlayerEntry>;
}

export interface LockedPlayer {
  name: string;
  pos: Pos;
  team: string;
  opp: string | null;
  kickoff: string;
  pts: Partial<Record<TrackKey, Pts>>;
}

export interface LocksFile {
  version: 1;
  season: number;
  hash: string;
  updatedAt: string;
  weeks: Record<string, Record<string, LockedPlayer>>;
}

export interface Game {
  home: string;
  away: string;
  kickoff: string;
  state: "pre" | "in" | "post";
  /** Expected points for each team from the betting lines, when available. */
  implied: Record<string, number> | null;
  /** Home margin from the spread (positive = home favored). */
  homeSpread: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

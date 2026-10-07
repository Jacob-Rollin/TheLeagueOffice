/**
 * Read-only client for the projection engine's public Gist (scripts/projection-engine).
 * Only /admin/projection-analytics uses this; the rest of the site still runs on Sleeper projections.
 *
 * Browser → gist.githubusercontent.com only. Never calls ESPN, Sleeper, TiDB, or
 * FantasyCalc, and never creates Fluid invocations. The engine itself runs on
 * GitHub Actions (not Vercel). Observability spikes while this page is open come
 * from the shared root layout (ESPN league delta, CDN warm, cron) — not this module.
 */

const GIST_RAW = "https://gist.githubusercontent.com/Jacob-Rollin/7cfcd891dc32297b05b3b6b29a73c443/raw";

export type EnginePos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
export type SourceKey = "sleeper" | "espn" | "cbs" | "model" | "baseline";
export type TrackKey = "engine" | SourceKey;
export type Format = "std" | "half" | "ppr";
export type Pts = [number, number, number];

export const ENGINE_POSITIONS: EnginePos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const TRACKS: TrackKey[] = ["engine", "sleeper", "espn", "cbs", "model", "baseline"];
export const SOURCES: SourceKey[] = ["sleeper", "espn", "cbs", "model", "baseline"];
export const FORMATS: Format[] = ["std", "half", "ppr"];
export const FORMAT_INDEX: Record<Format, 0 | 1 | 2> = { std: 0, half: 1, ppr: 2 };

export const FORMAT_LABEL: Record<Format, string> = { std: "Standard", half: "Half PPR", ppr: "Full PPR" };

export const TRACK_LABEL: Record<TrackKey, string> = {
  engine: "Our Custom API",
  sleeper: "Sleeper App",
  espn: "ESPN Fantasy",
  cbs: "CBS Sports",
  model: "nflverse Model",
  baseline: "Recent-Form Baseline",
};

export const TRACK_SHORT: Record<TrackKey, string> = {
  engine: "Ours",
  sleeper: "Sleeper",
  espn: "ESPN",
  cbs: "CBS",
  model: "Model",
  baseline: "Baseline",
};

export const TRACK_COLOR: Record<TrackKey, string> = {
  engine: "#1d3a8a",
  sleeper: "#0d9488",
  espn: "#dc2626",
  cbs: "#2563eb",
  model: "#d97706",
  baseline: "#94a3b8",
};

export interface SourceHealth {
  status: "ok" | "fallback" | "down";
  players: number;
  lastOkAt: string | null;
  note?: string;
}

export interface PlayerEntry {
  name: string;
  pos: EnginePos;
  team: string;
  opp: string | null;
  kickoff: string | null;
  injury: string | null;
  pts: Partial<Record<TrackKey, Pts>>;
  used: SourceKey[];
  stale?: SourceKey[];
}

export interface ProjectionFile {
  season: number;
  week: number;
  generatedAt: string;
  weights: Record<EnginePos, Partial<Record<SourceKey, number>>>;
  sources: Record<SourceKey, SourceHealth>;
  players: Record<string, PlayerEntry>;
}

export interface TrackSummary {
  mae: number;
  bias: number;
  n: number;
}
export type Summary = Record<Format, Record<TrackKey, TrackSummary>>;

export interface WeekReport {
  gradedAt: string;
  players: number;
  scoringCheck: { checked: number; mismatches: number };
  overall: Summary;
  byPos: Partial<Record<EnginePos, Summary>>;
}

/** [week, id, name, pos, team, actual, ...one Pts per track in TRACKS order] */
export type AccuracyRow = [number, string, string, EnginePos, string, Pts, ...Pts[]];

export interface AccuracyFile {
  season: number;
  updatedAt: string;
  tracks: TrackKey[];
  weeks: Record<string, WeekReport>;
  season_overall: Summary | null;
  season_byPos: Partial<Record<EnginePos, Summary>>;
  ticker: {
    engineVsSleeper: { engine: number; sleeper: number; ties: number };
    beatBaseline: Partial<Record<TrackKey, number>>;
  };
  rows: AccuracyRow[];
}

/** Null when the file hasn't been published yet. */
async function fetchGistFile<T>(name: string): Promise<T | null> {
  // The raw CDN caches for about five minutes; a per-minute key keeps refreshes current.
  const res = await fetch(`${GIST_RAW}/${name}?v=${Math.floor(Date.now() / 60_000)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}).`);
  const text = await res.text();
  if (!text.trim() || text.trim() === "{}") return null;
  return JSON.parse(text) as T;
}

export function fetchProjectionFile(): Promise<ProjectionFile | null> {
  return fetchGistFile<ProjectionFile>("projections-current.json");
}

export function fetchAccuracyFile(season: number): Promise<AccuracyFile | null> {
  return fetchGistFile<AccuracyFile>(`accuracy-${season}.json`);
}

/** Projected points for a track within an accuracy row. */
export function rowTrackPts(row: AccuracyRow, track: TrackKey): Pts {
  return row[6 + TRACKS.indexOf(track)] as Pts;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

export function biasLabel(bias: number): string {
  if (bias > 0.05) return `${bias.toFixed(2)} high`;
  if (bias < -0.05) return `${Math.abs(bias).toFixed(2)} low`;
  return "No lean";
}

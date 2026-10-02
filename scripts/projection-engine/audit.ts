import { GIST_FILES, POOL, POSITIONS, PUBLISHED } from "./config";
import { renderDashboard } from "./dashboard";
import { readFiles, writeFiles } from "./gist";
import { loadIdentity } from "./identity";
import { loadWeekGames } from "./schedule";
import { points } from "./scoring";
import { fetchSleeperActuals } from "./source-sleeper";
import type { LocksFile, Pos, Pts, TrackKey } from "./types";
import { parseJson, sha1 } from "./update";

export const TRACKS: TrackKey[] = ["engine", "sleeper", "espn", "cbs", "model", "baseline"];
export const FORMATS = ["std", "half", "ppr"] as const;
export type Format = (typeof FORMATS)[number];

/** [week, id, name, pos, team, actual, ...one Pts per track in TRACKS order] */
export type AccuracyRow = [number, string, string, Pos, string, Pts, ...Pts[]];

export interface TrackSummary {
  mae: number;
  bias: number;
  n: number;
}
export type Summary = Record<Format, Record<TrackKey, TrackSummary>>;

export interface WeekReport {
  gradedAt: string;
  players: number;
  /** Players whose actual points (our rules) differ from Sleeper's own total by over 0.1. */
  scoringCheck: { checked: number; mismatches: number };
  overall: Summary;
  byPos: Partial<Record<Pos, Summary>>;
}

export interface AccuracyFile {
  version: 1;
  season: number;
  updatedAt: string;
  hash: string;
  tracks: TrackKey[];
  columns: string[];
  weeks: Record<string, WeekReport>;
  season_overall: Summary | null;
  season_byPos: Partial<Record<Pos, Summary>>;
  /** Weeks each track's half-PPR MAE beat Sleeper's / the recent-form baseline's. */
  ticker: { engineVsSleeper: { engine: number; sleeper: number; ties: number }; beatBaseline: Partial<Record<TrackKey, number>> };
  rows: AccuracyRow[];
}

const FORMAT_INDEX: Record<Format, 0 | 1 | 2> = { std: 0, half: 1, ppr: 2 };
const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarize(rows: AccuracyRow[]): Summary {
  const out = {} as Summary;
  for (const f of FORMATS) {
    const i = FORMAT_INDEX[f];
    out[f] = {} as Record<TrackKey, TrackSummary>;
    TRACKS.forEach((track, t) => {
      let abs = 0;
      let signed = 0;
      for (const row of rows) {
        const err = (row[6 + t] as Pts)[i] - row[5][i];
        abs += Math.abs(err);
        signed += err;
      }
      out[f][track] = { mae: rows.length ? round2(abs / rows.length) : 0, bias: rows.length ? round2(signed / rows.length) : 0, n: rows.length };
    });
  }
  return out;
}

function byPosition(rows: AccuracyRow[]): Partial<Record<Pos, Summary>> {
  const out: Partial<Record<Pos, Summary>> = {};
  for (const pos of POSITIONS) {
    const list = rows.filter((r) => r[3] === pos);
    if (list.length) out[pos] = summarize(list);
  }
  return out;
}

export async function runAudit(opts: { season: number; dryRun: boolean; week?: number }): Promise<void> {
  const { season, dryRun } = opts;
  const nowIso = new Date().toISOString();
  const locksName = GIST_FILES.locks(season);
  const accName = GIST_FILES.accuracy(season);
  const [identity, stored] = await Promise.all([loadIdentity(), readFiles([locksName, accName], dryRun)]);
  const locks = parseJson<LocksFile>(stored[locksName] ?? null);
  const acc: AccuracyFile = parseJson<AccuracyFile>(stored[accName] ?? null) ?? {
    version: 1,
    season,
    updatedAt: nowIso,
    hash: "",
    tracks: TRACKS,
    columns: ["week", "id", "name", "pos", "team", "actual", ...TRACKS],
    weeks: {},
    season_overall: null,
    season_byPos: {},
    ticker: { engineVsSleeper: { engine: 0, sleeper: 0, ties: 0 }, beatBaseline: {} },
    rows: [],
  };
  if (!locks) {
    console.log("[audit] no kickoff locks yet; nothing to grade");
    return;
  }

  const weeks = Object.keys(locks.weeks)
    .map(Number)
    .filter((w) => opts.week == null || w === opts.week)
    .sort((a, b) => a - b);
  const graded: number[] = [];

  for (const week of weeks) {
    const games = await loadWeekGames(season, week, []);
    const list = [...new Set(games.values())];
    if (!list.length || list.some((g) => g.state !== "post")) {
      console.log(`[audit] week ${week}: games not all final yet, skipping`);
      continue;
    }
    const actuals = await fetchSleeperActuals(season, week, identity);
    if (!actuals?.size) {
      console.log(`[audit] week ${week}: Sleeper stats unavailable, skipping`);
      continue;
    }

    // Pool: consensus top N per position among players every track projected.
    const locked = Object.entries(locks.weeks[String(week)] ?? {});
    const rows: AccuracyRow[] = [];
    let checked = 0;
    let mismatches = 0;
    for (const pos of POSITIONS) {
      const eligible = locked
        .filter(([, l]) => l.pos === pos && TRACKS.every((t) => l.pts[t]))
        .map(([id, l]) => ({
          id,
          l,
          consensus: PUBLISHED.reduce((s, src) => s + l.pts[src]![1], 0) / PUBLISHED.length,
        }))
        .sort((a, b) => b.consensus - a.consensus)
        .slice(0, POOL[pos]);
      for (const { id, l } of eligible) {
        const stats = actuals.get(id);
        const actual: Pts = points(stats) ?? [0, 0, 0];
        if (stats && pos !== "K" && pos !== "DEF" && Number.isFinite(stats._pts_half)) {
          checked++;
          if (Math.abs(actual[1] - stats._pts_half!) > 0.1) mismatches++;
        }
        rows.push([week, id, l.name, pos, l.team, actual, ...TRACKS.map((t) => l.pts[t]!)]);
      }
    }
    if (!rows.length) {
      console.log(`[audit] week ${week}: no players covered by every track`);
      continue;
    }

    acc.rows = [...acc.rows.filter((r) => r[0] !== week), ...rows].sort((a, b) => a[0] - b[0] || a[3].localeCompare(b[3]));
    acc.weeks[String(week)] = {
      gradedAt: nowIso,
      players: rows.length,
      scoringCheck: { checked, mismatches },
      overall: summarize(rows),
      byPos: byPosition(rows),
    };
    graded.push(week);
    const half = acc.weeks[String(week)]!.overall.half;
    console.log(
      `[audit] week ${week}: ${rows.length} players graded; half-PPR MAE ${TRACKS.map((t) => `${t} ${half[t].mae}`).join(", ")}; scoring check ${mismatches}/${checked} off`,
    );
  }

  if (!graded.length) return;

  acc.season_overall = summarize(acc.rows);
  acc.season_byPos = byPosition(acc.rows);
  const ticker: AccuracyFile["ticker"] = { engineVsSleeper: { engine: 0, sleeper: 0, ties: 0 }, beatBaseline: {} };
  for (const report of Object.values(acc.weeks)) {
    const h = report.overall.half;
    if (h.engine.mae < h.sleeper.mae) ticker.engineVsSleeper.engine++;
    else if (h.sleeper.mae < h.engine.mae) ticker.engineVsSleeper.sleeper++;
    else ticker.engineVsSleeper.ties++;
    for (const t of TRACKS) {
      if (t !== "baseline" && h[t].mae < h.baseline.mae) ticker.beatBaseline[t] = (ticker.beatBaseline[t] ?? 0) + 1;
    }
  }
  acc.ticker = ticker;
  acc.updatedAt = nowIso;
  acc.hash = sha1({ weeks: acc.weeks, rows: acc.rows });

  // Keep the latest graded week's locks so Friday's re-grade can pick up stat corrections.
  const latest = Math.max(...Object.keys(acc.weeks).map(Number));
  let locksChanged = false;
  for (const key of Object.keys(locks.weeks)) {
    if (Number(key) < latest) {
      delete locks.weeks[key];
      locksChanged = true;
    }
  }
  const files: Record<string, string> = {
    [accName]: JSON.stringify(acc),
    [GIST_FILES.dashboard]: renderDashboard(acc),
  };
  if (locksChanged) {
    const hash = sha1(locks.weeks);
    files[locksName] = JSON.stringify({ ...locks, hash, updatedAt: nowIso });
  }
  await writeFiles(files, dryRun);
  console.log(`[audit] wrote: ${Object.keys(files).join(", ")}`);
}

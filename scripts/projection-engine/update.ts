import { createHash } from "node:crypto";

import { blendLine, buildVocabulary } from "./blend";
import { ALL_SOURCES, GIST_FILES, PUBLISHED, WEIGHTS } from "./config";
import { readFiles, writeFiles } from "./gist";
import { buildHistory } from "./history";
import { loadIdentity } from "./identity";
import { AnalyticsModel } from "./model-analytics";
import { baselineLine } from "./model-baseline";
import { loadNflverse } from "./nflverse";
import { hasStarted, loadWeekGames } from "./schedule";
import { points } from "./scoring";
import { fetchCbsProjections } from "./source-cbs";
import { fetchEspnProjections } from "./source-espn";
import { fetchSleeperProjections } from "./source-sleeper";
import type {
  LocksFile,
  PlayerEntry,
  ProjectionFile,
  SourceHealth,
  SourceKey,
  SourceResult,
  Stats,
  TrackKey,
} from "./types";

export interface RunOptions {
  season: number;
  week: number;
  dryRun: boolean;
  now?: number;
}

export const sha1 = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");

export function parseJson<T extends { version?: number }>(text: string | null): T | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as T;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function runUpdate(opts: RunOptions): Promise<void> {
  const { season, week, dryRun } = opts;
  const now = opts.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  console.log(`[update] ${season} week ${week}${dryRun ? " (dry run)" : ""}`);

  const locksName = GIST_FILES.locks(season);
  const [identity, stored] = await Promise.all([
    loadIdentity(),
    readFiles([GIST_FILES.projections, locksName], dryRun),
  ]);
  const prev = parseJson<ProjectionFile>(stored[GIST_FILES.projections] ?? null);
  const samePrev = prev && prev.season === season && prev.week === week ? prev : null;
  const locks: LocksFile = parseJson<LocksFile>(stored[locksName] ?? null) ?? {
    version: 1,
    season,
    hash: "",
    updatedAt: nowIso,
    weeks: {},
  };

  const [sleeper, espn, cbs, nfl] = await Promise.all([
    fetchSleeperProjections(season, week, identity),
    fetchEspnProjections(season, week, identity),
    fetchCbsProjections(season, week, identity),
    loadNflverse(season),
  ]);
  const games = await loadWeekGames(season, week, nfl.games, now);
  const posOf = (id: string) => identity.players.get(id)?.pos;

  /** Rule 1: a failed feed reuses this week's last good lines instead of zeros. */
  const previousLines = (source: SourceKey, filter?: (id: string) => boolean) => {
    const out = new Map<string, Stats>();
    if (!samePrev) return out;
    for (const [id, entry] of Object.entries(samePrev.players)) {
      const line = entry.lines[source];
      if (line && (!filter || filter(id))) out.set(id, line);
    }
    return out;
  };

  const health = {} as Record<SourceKey, SourceHealth>;
  const lines = {} as Record<SourceKey, Map<string, Stats>>;
  const stale = new Map<string, Set<SourceKey>>();
  const markStale = (source: SourceKey, ids: Iterable<string>) => {
    for (const id of ids) stale.set(id, (stale.get(id) ?? new Set()).add(source));
  };

  const simulatedDown = new Set((process.env.PE_SIMULATE_DOWN ?? "").split(",").filter(Boolean));
  const settle = (source: SourceKey, real: SourceResult) => {
    const result: SourceResult = simulatedDown.has(source)
      ? { ok: false, lines: new Map(), ms: 0, note: "simulated outage" }
      : real;
    const lastOk = samePrev?.sources[source]?.lastOkAt ?? prev?.sources?.[source]?.lastOkAt ?? null;
    if (result.ok) {
      lines[source] = result.lines;
      health[source] = { status: "ok", players: result.lines.size, lastOkAt: nowIso, ...(result.note ? { note: result.note } : {}) };
      return;
    }
    if (result.okPositions?.size) {
      // Per-position feed: keep healthy pages, fill failed positions from this week's last run.
      const filled = new Map(result.lines);
      const carried = previousLines(source, (id) => {
        const pos = posOf(id);
        return Boolean(pos && !result.okPositions!.has(pos) && !filled.has(id));
      });
      for (const [id, line] of carried) filled.set(id, line);
      markStale(source, carried.keys());
      lines[source] = filled;
      health[source] = { status: "fallback", players: filled.size, lastOkAt: lastOk, note: result.note ?? "partial" };
      return;
    }
    const carried = previousLines(source);
    lines[source] = carried;
    markStale(source, carried.keys());
    health[source] = carried.size
      ? { status: "fallback", players: carried.size, lastOkAt: lastOk, note: result.note ?? "failed" }
      : { status: "down", players: 0, lastOkAt: lastOk, note: result.note ?? "failed" };
  };

  settle("sleeper", sleeper);
  settle("espn", espn);
  settle("cbs", cbs);

  const candidates = new Set<string>();
  for (const s of PUBLISHED) for (const id of lines[s].keys()) candidates.add(id);
  if (!candidates.size) {
    throw new Error("every published projection feed is down and nothing is cached for this week");
  }

  const history = buildHistory(nfl, identity, season, week);
  const model = new AnalyticsModel(history, identity.players, games, season);
  const nflLines = (fn: (id: string) => Stats | null): SourceResult => {
    const out = new Map<string, Stats>();
    for (const id of candidates) {
      const line = fn(id);
      if (line && points(line)) out.set(id, line);
    }
    return { ok: nfl.ok && out.size > 0, lines: out, ms: 0, ...(nfl.note ? { note: nfl.note } : {}) };
  };
  settle(
    "model",
    nflLines((id) => {
      const meta = identity.players.get(id);
      return meta ? model.project(meta) : null;
    }),
  );
  settle(
    "baseline",
    nflLines((id) => {
      const meta = identity.players.get(id);
      return meta ? baselineLine(meta, history, games) : null;
    }),
  );

  const vocab = buildVocabulary(lines, posOf);
  const players: Record<string, PlayerEntry> = {};
  for (const id of [...candidates].sort()) {
    const meta = identity.players.get(id);
    if (!meta) continue;
    const playerLines: Partial<Record<SourceKey, Stats>> = {};
    for (const s of ALL_SOURCES) {
      const line = lines[s].get(id);
      if (line) playerLines[s] = line;
    }
    const blended = blendLine(meta.pos, playerLines, vocab);
    const enginePts = points(blended?.stats);
    if (!blended || !enginePts) continue;
    const pts: Partial<Record<TrackKey, PlayerEntry["pts"][TrackKey]>> = { engine: enginePts };
    for (const s of ALL_SOURCES) {
      const p = points(playerLines[s]);
      if (p) pts[s] = p;
    }
    const game = games.get(meta.team) ?? null;
    const staleFor = stale.get(id);
    players[id] = {
      name: meta.name,
      pos: meta.pos,
      team: meta.team,
      opp: game ? (game.home === meta.team ? game.away : game.home) : null,
      kickoff: game?.kickoff ?? null,
      injury: meta.injury,
      engine: blended.stats,
      pts,
      lines: playerLines,
      used: blended.used,
      ...(staleFor?.size ? { stale: [...staleFor] } : {}),
    };
  }

  const hash = sha1({ season, week, players });
  const projection: ProjectionFile = {
    version: 1,
    season,
    week,
    generatedAt: nowIso,
    hash,
    weights: WEIGHTS,
    sources: health,
    players,
  };

  // Kickoff locks: keep overwriting a player's snapshot until his game starts.
  const weekKey = String(week);
  const weekLocks = (locks.weeks[weekKey] ??= {});
  for (const [id, entry] of Object.entries(players)) {
    const game = games.get(entry.team);
    if (!game || hasStarted(game, now)) continue;
    weekLocks[id] = {
      name: entry.name,
      pos: entry.pos,
      team: entry.team,
      opp: entry.opp,
      kickoff: game.kickoff,
      pts: entry.pts,
    };
  }
  for (const [id, locked] of Object.entries(weekLocks)) {
    const game = games.get(locked.team);
    if (!players[id] && game && !hasStarted(game, now)) delete weekLocks[id];
  }
  for (const key of Object.keys(locks.weeks)) {
    if (Number(key) < week - 2) delete locks.weeks[key];
  }
  const locksHash = sha1(locks.weeks);

  const changed: Record<string, string> = {};
  if (hash !== prev?.hash) changed[GIST_FILES.projections] = JSON.stringify(projection);
  if (locksHash !== locks.hash) {
    changed[locksName] = JSON.stringify({ ...locks, hash: locksHash, updatedAt: nowIso });
  }
  await writeFiles(changed, dryRun);

  const started = Object.values(weekLocks).filter((l) => {
    const g = games.get(l.team);
    return g && hasStarted(g, now);
  }).length;
  for (const s of ALL_SOURCES) {
    const h = health[s];
    console.log(`  ${s.padEnd(8)} ${h.status.padEnd(8)} ${String(h.players).padStart(4)} players${h.note ? `  (${h.note})` : ""}`);
  }
  console.log(`  ${Object.keys(players).length} players projected, ${Object.keys(weekLocks).length} locked for week ${week} (${started} already kicked off)`);
  console.log(`  wrote: ${Object.keys(changed).join(", ") || "nothing (no changes)"}`);
}

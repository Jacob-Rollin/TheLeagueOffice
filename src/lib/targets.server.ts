/**
 * Most-targeted players aggregated from nflverse play-by-play.
 * Counts every pass thrown to a receiver (complete or incomplete) in REG games.
 */

import { currentSeason, HOUR } from "./players-build";
import type { MostTargetedPayload, TargetedPlayerRow, TargetPos } from "./targets";

export type { MostTargetedPayload, TargetedPlayerRow, TargetPos } from "./targets";

const PBP_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const ROSTER_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;

const SKILL: TargetPos[] = ["RB", "WR", "TE"];

type Agg = {
  gsisId: string;
  name: string;
  team: string;
  /** Targets per week (1-indexed sparse map). */
  byWeek: Map<number, number>;
};

function memo<T>(ttl: number, fn: (key: string) => Promise<T>) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = fn(key).catch((err) => {
      store.delete(key);
      throw err;
    });
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cell(row: string[], idx: Record<string, number>, name: string): string {
  const i = idx[name];
  if (i == null || i < 0) return "";
  return row[i] ?? "";
}

const loadRosterMap = memo<
  Map<string, { sleeperId: string; pos: TargetPos; team: string; name: string }>
>(12 * HOUR, async (season) => {
  const res = await fetch(ROSTER_URL(season), {
    headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
  });
  if (!res.ok) throw new Error(`Roster upstream ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const header = parseCsvLine(lines[0]!);
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const map = new Map<string, { sleeperId: string; pos: TargetPos; team: string; name: string }>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const row = parseCsvLine(line);
    const gsis = cell(row, idx, "gsis_id").trim();
    const sleeper = cell(row, idx, "sleeper_id").trim();
    const posRaw = cell(row, idx, "position").trim().toUpperCase();
    if (!gsis || !sleeper) continue;
    if (!(SKILL as string[]).includes(posRaw)) continue;
    const team = cell(row, idx, "team").trim();
    const name = cell(row, idx, "full_name").trim();
    map.set(gsis, { sleeperId: sleeper, pos: posRaw as TargetPos, team, name });
  }
  return map;
});

const loadTargetsAgg = memo<{
  season: string;
  maxWeek: number;
  byGsis: Map<string, Agg>;
}>(6 * HOUR, async (seasonKey) => {
  const season = seasonKey || currentSeason();
  const res = await fetch(PBP_URL(season), {
    headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
  });
  if (!res.ok) throw new Error(`PBP upstream ${res.status}`);
  const { gunzipSync } = await import("node:zlib");
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) {
    return { season, maxWeek: 0, byGsis: new Map() };
  }
  const header = parseCsvLine(lines[0]!);
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;

  const byGsis = new Map<string, Agg>();
  let maxWeek = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const row = parseCsvLine(line);
    if (cell(row, idx, "season_type") !== "REG") continue;
    if (cell(row, idx, "play_type") !== "pass") continue;

    const recvId = cell(row, idx, "receiver_player_id").trim();
    if (!recvId) continue;

    const week = Math.max(0, Math.floor(num(cell(row, idx, "week"))));
    if (week < 1 || week > 22) continue;
    if (week > maxWeek) maxWeek = week;

    const recvName = cell(row, idx, "receiver_player_name").trim();
    const team = cell(row, idx, "posteam").trim();
    let agg = byGsis.get(recvId);
    if (!agg) {
      agg = { gsisId: recvId, name: recvName, team, byWeek: new Map() };
      byGsis.set(recvId, agg);
    } else {
      if (recvName) agg.name = recvName;
      if (team) agg.team = team;
    }
    agg.byWeek.set(week, (agg.byWeek.get(week) ?? 0) + 1);
  }

  return { season, maxWeek, byGsis };
});

export async function loadMostTargetedPlayers(
  season = currentSeason(),
): Promise<MostTargetedPayload> {
  const seasonKey = String(season ?? currentSeason()).slice(0, 16);
  const prev = String(Number(seasonKey) - 1);
  let active = await loadTargetsAgg(seasonKey).catch(() => null);
  let usedSeason = seasonKey;
  if (!active || active.byGsis.size === 0 || active.maxWeek === 0) {
    active = await loadTargetsAgg(prev);
    usedSeason = prev;
  }

  const roster = await loadRosterMap(usedSeason).catch(
    () => new Map<string, { sleeperId: string; pos: TargetPos; team: string; name: string }>(),
  );

  const maxWeek = active.maxWeek;
  const rows: TargetedPlayerRow[] = [];

  for (const agg of active.byGsis.values()) {
    const meta = roster.get(agg.gsisId);
    if (!meta) continue;
    const byWeek: number[] = new Array(maxWeek + 1).fill(0);
    let total = 0;
    for (const [week, count] of agg.byWeek) {
      if (week < 1 || week > maxWeek) continue;
      byWeek[week] = count;
      total += count;
    }
    if (total <= 0) continue;
    const avg = maxWeek > 0 ? Math.round((total / maxWeek) * 10) / 10 : 0;
    rows.push({
      id: meta.sleeperId,
      name: meta.name || agg.name,
      team: meta.team || agg.team,
      pos: meta.pos,
      byWeek,
      total,
      avg,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    season: usedSeason,
    maxWeek,
    rows,
  };
}

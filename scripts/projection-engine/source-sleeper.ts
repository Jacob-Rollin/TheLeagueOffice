import { POSITIONS } from "./config";
import { fetchJson } from "./http";
import type { Identity } from "./identity";
import { cleanLine, points } from "./scoring";
import type { Pos, SourceResult, Stats } from "./types";

type Row = { player_id?: string; stats?: Stats; player?: { position?: string } };

const SLEEPER = "https://api.sleeper.app";

export async function fetchSleeperProjections(
  season: number,
  week: number,
  identity: Identity,
): Promise<SourceResult> {
  const query = POSITIONS.map((p) => `position[]=${p}`).join("&");
  const res = await fetchJson<Row[]>(
    `${SLEEPER}/projections/nfl/${season}/${week}?season_type=regular&${query}`,
  );
  const lines = new Map<string, Stats>();
  if (!res.ok || !Array.isArray(res.data)) {
    return { ok: false, lines, ms: res.ms, note: res.error ?? "no data" };
  }
  for (const row of res.data) {
    const id = row.player_id ? String(row.player_id) : null;
    if (!id || !row.stats) continue;
    const pos = (identity.players.get(id)?.pos ?? row.player?.position) as Pos | undefined;
    if (!pos || !POSITIONS.includes(pos)) continue;
    const line = cleanLine(row.stats, pos);
    const pts = points(line);
    if (!line || !pts || pts.every((p) => p === 0)) continue;
    lines.set(id, line);
  }
  const ok = lines.size >= 250;
  return { ok, lines, ms: res.ms, ...(ok ? {} : { note: `only ${lines.size} players` }) };
}

/** Final weekly stat lines (used by the Tuesday audit for actual points). */
export async function fetchSleeperActuals(
  season: number,
  week: number,
  identity: Identity,
): Promise<Map<string, Stats> | null> {
  const query = POSITIONS.map((p) => `position[]=${p}`).join("&");
  const res = await fetchJson<Row[] | Record<string, Stats>>(
    `${SLEEPER}/stats/nfl/${season}/${week}?season_type=regular&${query}`,
  );
  if (!res.ok || !res.data) return null;
  const out = new Map<string, Stats>();
  const rows: Row[] = Array.isArray(res.data)
    ? res.data
    : Object.entries(res.data).map(([player_id, stats]) => ({ player_id, stats }));
  for (const row of rows) {
    const id = row.player_id ? String(row.player_id) : null;
    if (!id || !row.stats) continue;
    const pos = (identity.players.get(id)?.pos ?? row.player?.position) as Pos | undefined;
    if (!pos || !POSITIONS.includes(pos)) continue;
    const line = cleanLine(row.stats, pos);
    if (line) out.set(id, { ...line, _pts_std: Number(row.stats.pts_std ?? NaN), _pts_half: Number(row.stats.pts_half_ppr ?? NaN), _pts_ppr: Number(row.stats.pts_ppr ?? NaN) });
  }
  return out;
}

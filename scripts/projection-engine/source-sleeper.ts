import { POSITIONS } from "./config";
import { fetchJson } from "./http";
import type { Identity } from "./identity";
import { PA_BUCKETS, cleanLine, points } from "./scoring";
import type { Pos, SourceResult, Stats } from "./types";

type Row = { player_id?: string; stats?: Stats; player?: { position?: string } };

const SLEEPER = "https://api.sleeper.app";

function actualTier(points: number): (typeof PA_BUCKETS)[number] {
  if (points <= 0) return "pts_allow_0";
  if (points <= 6) return "pts_allow_1_6";
  if (points <= 13) return "pts_allow_7_13";
  if (points <= 20) return "pts_allow_14_20";
  if (points <= 27) return "pts_allow_21_27";
  if (points <= 34) return "pts_allow_28_34";
  return "pts_allow_35p";
}

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
    const raw: Stats = { ...row.stats };
    if (pos === "DEF" && raw.pts_allow != null && !PA_BUCKETS.some((k) => raw[k] != null)) {
      for (const k of PA_BUCKETS) raw[k] = 0;
      raw[actualTier(Number(raw.pts_allow))] = 1;
    }
    const line = cleanLine(raw, pos);
    if (line) out.set(id, { ...line, _pts_half: Number(row.stats.pts_half_ppr ?? NaN) });
  }
  return out;
}

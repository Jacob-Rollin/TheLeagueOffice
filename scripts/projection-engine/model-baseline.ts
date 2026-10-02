import type { History } from "./history";
import type { PlayerMeta } from "./identity";
import { PA_BUCKETS, cleanLine } from "./scoring";
import type { Game, Stats } from "./types";

const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR"]);

export const isRuledOut = (meta: PlayerMeta | undefined) =>
  Boolean(meta?.injury && OUT_STATUSES.has(meta.injury));

const BASELINE_GAMES = 3;

function tierOf(points: number): (typeof PA_BUCKETS)[number] {
  if (points === 0) return "pts_allow_0";
  if (points <= 6) return "pts_allow_1_6";
  if (points <= 13) return "pts_allow_7_13";
  if (points <= 20) return "pts_allow_14_20";
  if (points <= 27) return "pts_allow_21_27";
  if (points <= 34) return "pts_allow_28_34";
  return "pts_allow_35p";
}

/**
 * Recent-form yardstick: each player's average stat line over his last three
 * games (reaching back into last season when needed). Graded, never blended.
 */
export function baselineLine(
  meta: PlayerMeta,
  history: History,
  games: Map<string, Game>,
): Stats | null {
  if (isRuledOut(meta) || !games.has(meta.team)) return null;

  if (meta.pos === "DEF") {
    const recent = (history.teams.get(meta.team) ?? [])
      .filter((g) => g.pointsAllowed != null)
      .slice(0, BASELINE_GAMES);
    if (!recent.length) return null;
    const avg = (pick: (g: (typeof recent)[number]) => number) =>
      recent.reduce((s, g) => s + pick(g), 0) / recent.length;
    const line: Stats = {
      sack: avg((g) => g.sacks),
      int: avg((g) => g.ints),
      fum_rec: avg((g) => g.fumRec),
      ff: avg((g) => g.ff),
      def_td: avg((g) => g.defTd),
      safe: avg((g) => g.safeties),
      blk_kick: avg((g) => g.blocks),
      def_st_td: avg((g) => g.stTd),
      pts_allow: avg((g) => g.pointsAllowed!),
    };
    for (const key of PA_BUCKETS) line[key] = 0;
    for (const g of recent) line[tierOf(g.pointsAllowed!)]! += 1 / recent.length;
    return cleanLine(line, "DEF");
  }

  const logs = (history.players.get(meta.id) ?? []).slice(0, BASELINE_GAMES);
  if (!logs.length) return null;
  const sum: Stats = {};
  for (const log of logs) {
    for (const [k, v] of Object.entries(log.stats)) sum[k] = (sum[k] ?? 0) + v;
  }
  for (const k of Object.keys(sum)) sum[k] = sum[k]! / logs.length;
  return cleanLine(sum, meta.pos);
}

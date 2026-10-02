import { ESPN_STAT_MAP } from "../../src/lib/scoring-map";

import { fetchJson } from "./http";
import type { Identity } from "./identity";
import { cleanLine, points } from "./scoring";
import type { Pos, SourceResult, Stats } from "./types";

const ESPN_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
  11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};
const ESPN_POS: Record<number, Pos> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };

type StatLine = {
  statSourceId?: number;
  statSplitTypeId?: number;
  scoringPeriodId?: number;
  seasonId?: number;
  stats?: Record<string, number>;
};
type EspnPlayer = {
  player?: { id?: number; fullName?: string; defaultPositionId?: number; proTeamId?: number; stats?: StatLine[] };
};

/** ESPN kicker buckets are under 40 / 40-49 / 50+; under-40 makes all score 3. */
function kickerLine(raw: Record<string, number>): Stats {
  const n = (id: number) => Number(raw[id] ?? 0);
  return {
    fgm_0_19: n(80) * 0.15,
    fgm_20_29: n(80) * 0.4,
    fgm_30_39: n(80) * 0.45,
    fgm_40_49: n(77),
    fgm_50p: n(74),
    fgmiss: n(85),
    xpm: n(86),
    xpmiss: n(88),
  };
}

/**
 * ESPN publishes points-allowed tier odds as 0, 1-6, 7-13, 14-17, 18-21,
 * 22-27, 28-34, 35-45, 46+. The 18-21 tier straddles Sleeper's 14-20 and
 * 21-27 tiers, so three quarters of it goes to 14-20.
 */
function defenseLine(raw: Record<string, number>): Stats {
  const n = (id: number) => Number(raw[id] ?? 0);
  return {
    int: n(95),
    fum_rec: n(96),
    blk_kick: n(97),
    safe: n(98),
    sack: n(99),
    ff: n(106),
    def_td: n(93) + n(103) + n(104),
    def_st_td: n(101) + n(102),
    pts_allow: n(120),
    yds_allow: n(127),
    pts_allow_0: n(89),
    pts_allow_1_6: n(90),
    pts_allow_7_13: n(91),
    pts_allow_14_20: n(92) + n(121) * 0.75,
    pts_allow_21_27: n(121) * 0.25 + n(122),
    pts_allow_28_34: n(123),
    pts_allow_35p: n(124) + n(125),
  };
}

function offenseLine(raw: Record<string, number>): Stats {
  const out: Stats = {};
  for (const [id, v] of Object.entries(raw)) {
    const key = ESPN_STAT_MAP[Number(id)];
    if (key) out[key] = Number(v);
  }
  return out;
}

export async function fetchEspnProjections(
  season: number,
  week: number,
  identity: Identity,
): Promise<SourceResult> {
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17] },
      filterStatsForSourceIds: { value: [1] },
      filterStatsForSplitTypeIds: { value: [1] },
      filterStatsForScoringPeriodIds: { value: [week] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      limit: 2000,
    },
  };
  const res = await fetchJson<{ players?: EspnPlayer[] }>(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?scoringPeriodId=${week}&view=kona_player_info`,
    { headers: { "X-Fantasy-Filter": JSON.stringify(filter) } },
  );
  const lines = new Map<string, Stats>();
  if (!res.ok || !res.data?.players) {
    return { ok: false, lines, ms: res.ms, note: res.error ?? "no data" };
  }
  let unmatched = 0;
  for (const entry of res.data.players) {
    const p = entry.player;
    const pos = p?.defaultPositionId != null ? ESPN_POS[p.defaultPositionId] : undefined;
    if (!p || !pos) continue;
    // ESPN also returns last season's line for the same week number.
    const projected = (p.stats ?? []).find(
      (s) =>
        s.statSourceId === 1 &&
        s.statSplitTypeId === 1 &&
        s.scoringPeriodId === week &&
        s.seasonId === season,
    );
    if (!projected?.stats) continue;
    const team = ESPN_TEAM[p.proTeamId ?? -1] ?? "FA";
    const id =
      pos === "DEF"
        ? team
        : (identity.byEspn.get(String(p.id)) ?? identity.findByName(p.fullName ?? "", pos, team));
    if (!id || (pos === "DEF" && team === "FA")) {
      unmatched++;
      continue;
    }
    const raw = projected.stats;
    const line = cleanLine(pos === "K" ? kickerLine(raw) : pos === "DEF" ? defenseLine(raw) : offenseLine(raw), pos);
    const pts = points(line);
    if (!line || !pts || pts.every((x) => x === 0)) continue;
    lines.set(id, line);
  }
  const ok = lines.size >= 250;
  const note = `${unmatched} unmatched${ok ? "" : `, only ${lines.size} players`}`;
  return { ok, lines, ms: res.ms, note };
}

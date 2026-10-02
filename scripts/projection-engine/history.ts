import { num } from "./csv";
import type { Identity } from "./identity";
import { canonTeam } from "./names";
import type { NflverseData } from "./nflverse";
import { points } from "./scoring";
import type { Stats } from "./types";

export type OffPos = "QB" | "RB" | "WR" | "TE";

export interface GameLog {
  order: number;
  season: number;
  week: number;
  team: string;
  opp: string;
  stats: Stats;
}

export interface TeamGame {
  order: number;
  season: number;
  week: number;
  team: string;
  opp: string;
  points: number | null;
  pointsAllowed: number | null;
  passAtt: number;
  carries: number;
  targets: number;
  xpa: number;
  fga: number;
  sacks: number;
  ints: number;
  ff: number;
  fumRec: number;
  defTd: number;
  safeties: number;
  blocks: number;
  stTd: number;
  sacksTaken: number;
  intsThrown: number;
  fumLost: number;
  /** Half-PPR points this defense allowed to each offensive position. */
  allowed: Record<OffPos, number>;
}

export interface History {
  players: Map<string, GameLog[]>;
  teams: Map<string, TeamGame[]>;
}

export const orderOf = (season: number, week: number) => season * 100 + week;

/** One nflverse weekly row as a Sleeper-keyed stat line (plus kicker attempt detail). */
function rowStats(r: Record<string, string>): Stats {
  const fgBucket = (made: string[], missed: string[]) => ({
    made: made.reduce((s, k) => s + num(r[k]), 0),
    att: made.reduce((s, k) => s + num(r[k]), 0) + missed.reduce((s, k) => s + num(r[k]), 0),
  });
  const short = fgBucket(["fg_made_0_19", "fg_made_20_29", "fg_made_30_39"], ["fg_missed_0_19", "fg_missed_20_29", "fg_missed_30_39"]);
  const mid = fgBucket(["fg_made_40_49"], ["fg_missed_40_49"]);
  const long = fgBucket(["fg_made_50_59", "fg_made_60_"], ["fg_missed_50_59", "fg_missed_60_"]);
  return {
    pass_att: num(r.attempts),
    pass_cmp: num(r.completions),
    pass_yd: num(r.passing_yards),
    pass_td: num(r.passing_tds),
    pass_int: num(r.passing_interceptions),
    pass_2pt: num(r.passing_2pt_conversions),
    rush_att: num(r.carries),
    rush_yd: num(r.rushing_yards),
    rush_td: num(r.rushing_tds),
    rush_2pt: num(r.rushing_2pt_conversions),
    rec_tgt: num(r.targets),
    rec: num(r.receptions),
    rec_yd: num(r.receiving_yards),
    rec_td: num(r.receiving_tds),
    rec_2pt: num(r.receiving_2pt_conversions),
    fum_lost: num(r.rushing_fumbles_lost) + num(r.receiving_fumbles_lost) + num(r.sack_fumbles_lost),
    fgm_0_19: num(r.fg_made_0_19),
    fgm_20_29: num(r.fg_made_20_29),
    fgm_30_39: num(r.fg_made_30_39),
    fgm_40_49: num(r.fg_made_40_49),
    fgm_50p: num(r.fg_made_50_59) + num(r.fg_made_60_),
    fgmiss: num(r.fg_missed),
    xpm: num(r.pat_made),
    xpmiss: num(r.pat_missed),
    _fga_short: short.att,
    _fgm_short: short.made,
    _fga_mid: mid.att,
    _fgm_mid: mid.made,
    _fga_long: long.att,
    _fgm_long: long.made,
    _xpa: num(r.pat_att),
  };
}

function fantasyPos(position: string | undefined): OffPos | "K" | null {
  if (position === "QB" || position === "RB" || position === "WR" || position === "TE" || position === "K") return position;
  if (position === "FB") return "RB";
  return null;
}

/** Player and team game logs from games played before (season, week). */
export function buildHistory(data: NflverseData, identity: Identity, season: number, week: number): History {
  const cutoff = orderOf(season, week);
  const players = new Map<string, GameLog[]>();
  const teams = new Map<string, TeamGame>();

  const scores = new Map<string, { points: number; allowed: number }>();
  for (const g of data.games) {
    if (g.home_score === "" || g.away_score === "" || g.home_score == null) continue;
    const order = orderOf(Number(g.season), Number(g.week));
    const home = canonTeam(g.home_team);
    const away = canonTeam(g.away_team);
    scores.set(`${home}|${order}`, { points: num(g.home_score), allowed: num(g.away_score) });
    scores.set(`${away}|${order}`, { points: num(g.away_score), allowed: num(g.home_score) });
  }

  const teamGame = (team: string, opp: string, s: number, w: number): TeamGame => {
    const order = orderOf(s, w);
    const key = `${team}|${order}`;
    let tg = teams.get(key);
    if (!tg) {
      const score = scores.get(key);
      tg = {
        order, season: s, week: w, team, opp,
        points: score?.points ?? null,
        pointsAllowed: score?.allowed ?? null,
        passAtt: 0, carries: 0, targets: 0, xpa: 0, fga: 0,
        sacks: 0, ints: 0, ff: 0, fumRec: 0, defTd: 0, safeties: 0, blocks: 0, stTd: 0,
        sacksTaken: 0, intsThrown: 0, fumLost: 0,
        allowed: { QB: 0, RB: 0, WR: 0, TE: 0 },
      };
      teams.set(key, tg);
    }
    return tg;
  };

  for (const r of [...data.previous, ...data.current]) {
    const s = Number(r.season);
    const w = Number(r.week);
    if (!s || !w || orderOf(s, w) >= cutoff) continue;
    const team = canonTeam(r.team);
    const opp = canonTeam(r.opponent_team);
    if (!team || !opp) continue;
    const stats = rowStats(r);
    const tg = teamGame(team, opp, s, w);
    tg.passAtt += stats.pass_att!;
    tg.carries += stats.rush_att!;
    tg.targets += stats.rec_tgt!;
    tg.xpa += stats._xpa!;
    tg.fga += stats._fga_short! + stats._fga_mid! + stats._fga_long!;
    tg.sacks += num(r.def_sacks);
    tg.ints += num(r.def_interceptions);
    tg.ff += num(r.def_fumbles_forced);
    tg.fumRec += num(r.fumble_recovery_opp);
    tg.defTd += num(r.def_tds);
    tg.safeties += num(r.def_safeties);
    tg.blocks += num(r.def_fg_blocks) + num(r.def_punt_blocks) + num(r.def_pat_blocks);
    tg.stTd += num(r.special_teams_tds);
    tg.sacksTaken += num(r.sacks_suffered);
    tg.intsThrown += stats.pass_int!;
    tg.fumLost += stats.fum_lost!;

    const pos = fantasyPos(r.position);
    if (pos && pos !== "K") {
      const half = points(stats)?.[1] ?? 0;
      teamGame(opp, team, s, w).allowed[pos] += half;
    }
    const sid = identity.byGsis.get(r.player_id ?? "");
    if (!sid || !pos) continue;
    const logs = players.get(sid) ?? [];
    logs.push({ order: orderOf(s, w), season: s, week: w, team, opp, stats });
    players.set(sid, logs);
  }

  for (const logs of players.values()) logs.sort((a, b) => b.order - a.order);
  const byTeam = new Map<string, TeamGame[]>();
  for (const tg of teams.values()) byTeam.set(tg.team, [...(byTeam.get(tg.team) ?? []), tg]);
  for (const list of byTeam.values()) list.sort((a, b) => b.order - a.order);
  return { players, teams: byTeam };
}

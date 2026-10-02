import type { GameLog, History, OffPos, TeamGame } from "./history";
import type { PlayerMeta } from "./identity";
import { isRuledOut } from "./model-baseline";
import { cleanLine, paBuckets } from "./scoring";
import type { Game, Stats } from "./types";

/**
 * Our nflverse model. Offense: projected share of team targets / carries /
 * attempts x projected team volume x efficiency regressed toward league rates,
 * adjusted by the betting lines (implied team total, spread) and by how many
 * points the opponent allows to the position. Kickers: implied team scoring
 * x the kicker's regressed distance mix and accuracy. Defenses: opponent's
 * implied total for points-allowed tiers, blended sack/turnover rates.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const OFF_POS: OffPos[] = ["QB", "RB", "WR", "TE"];
const MAX_GAMES = 12;
const DECAY = 0.85;
/** Last season's games count for about a third as much as this season's. */
const PRIOR_SEASON_WEIGHT = 0.35;

type Rates = {
  catch: number; ypt: number; tdPerTgt: number; ypc: number; tdPerCarry: number; fumPerTouch: number;
  cmp: number; ypa: number; tdPerAtt: number; intPerAtt: number;
};

interface League {
  pos: Record<OffPos, Rates>;
  qbRushPerGame: number;
  qbFumPerGame: number;
  avgPoints: number;
  volume: { targets: number; carries: number; passAtt: number };
  allowed: Record<OffPos, number>;
  xpaPerPoint: number;
  fgaPerPoint: number;
  xpPct: number;
  fgMix: { short: number; mid: number; long: number };
  fgPct: { short: number; mid: number; long: number };
  perGame: { sacks: number; ints: number; fumRec: number; ff: number; safeties: number; blocks: number; stTd: number };
  defTdPerTakeaway: number;
}

const ratio = (a: number, b: number, fallback = 0) => (b > 0 ? a / b : fallback);

function weights<T extends { season: number }>(items: T[], season: number): number[] {
  return items.map((it, i) => (it.season === season ? 1 : PRIOR_SEASON_WEIGHT) * DECAY ** i);
}

function buildLeague(history: History, players: Map<string, PlayerMeta>): League {
  const acc: Record<OffPos, Record<string, number>> = { QB: {}, RB: {}, WR: {}, TE: {} };
  let qbGames = 0;
  let qbRush = 0;
  let qbFum = 0;
  const k = { xpa: 0, xpm: 0, short: 0, mid: 0, long: 0, shortM: 0, midM: 0, longM: 0 };
  for (const [id, logs] of history.players) {
    const pos = players.get(id)?.pos;
    if (!pos) continue;
    for (const log of logs) {
      const s = log.stats;
      if (pos === "K") {
        k.xpa += s._xpa!;
        k.xpm += s.xpm!;
        k.short += s._fga_short!;
        k.mid += s._fga_mid!;
        k.long += s._fga_long!;
        k.shortM += s._fgm_short!;
        k.midM += s._fgm_mid!;
        k.longM += s._fgm_long!;
        continue;
      }
      if (pos === "DEF") continue;
      const a = acc[pos];
      for (const key of ["rec_tgt", "rec", "rec_yd", "rec_td", "rush_att", "rush_yd", "rush_td", "fum_lost", "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int"]) {
        a[key] = (a[key] ?? 0) + (s[key] ?? 0);
      }
      if (pos === "QB" && s.pass_att! >= 10) {
        qbGames++;
        qbRush += s.rush_att!;
        qbFum += s.fum_lost!;
      }
    }
  }
  const pos = {} as Record<OffPos, Rates>;
  for (const p of OFF_POS) {
    const a = acc[p];
    pos[p] = {
      catch: ratio(a.rec ?? 0, a.rec_tgt ?? 0, 0.65),
      ypt: ratio(a.rec_yd ?? 0, a.rec_tgt ?? 0, 7.5),
      tdPerTgt: ratio(a.rec_td ?? 0, a.rec_tgt ?? 0, 0.045),
      ypc: ratio(a.rush_yd ?? 0, a.rush_att ?? 0, 4.2),
      tdPerCarry: ratio(a.rush_td ?? 0, a.rush_att ?? 0, 0.03),
      fumPerTouch: ratio(a.fum_lost ?? 0, (a.rush_att ?? 0) + (a.rec ?? 0), 0.006),
      cmp: ratio(a.pass_cmp ?? 0, a.pass_att ?? 0, 0.64),
      ypa: ratio(a.pass_yd ?? 0, a.pass_att ?? 0, 6.8),
      tdPerAtt: ratio(a.pass_td ?? 0, a.pass_att ?? 0, 0.045),
      intPerAtt: ratio(a.pass_int ?? 0, a.pass_att ?? 0, 0.022),
    };
  }

  let teamGames = 0;
  const t = {
    points: 0, scored: 0, xpa: 0, fga: 0, sacks: 0, ints: 0, fumRec: 0, ff: 0, safeties: 0, blocks: 0, stTd: 0, defTd: 0,
    targets: 0, carries: 0, passAtt: 0,
  };
  const allowed: Record<OffPos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const games of history.teams.values()) {
    for (const g of games) {
      teamGames++;
      if (g.points != null) {
        t.points += g.points;
        t.scored++;
        t.xpa += g.xpa;
        t.fga += g.fga;
      }
      t.sacks += g.sacks;
      t.ints += g.ints;
      t.fumRec += g.fumRec;
      t.ff += g.ff;
      t.safeties += g.safeties;
      t.blocks += g.blocks;
      t.stTd += g.stTd;
      t.defTd += g.defTd;
      t.targets += g.targets;
      t.carries += g.carries;
      t.passAtt += g.passAtt;
      for (const p of OFF_POS) allowed[p] += g.allowed[p];
    }
  }
  const per = (x: number) => ratio(x, teamGames);
  const fgAtt = k.short + k.mid + k.long;
  return {
    pos,
    qbRushPerGame: ratio(qbRush, qbGames, 3.5),
    qbFumPerGame: ratio(qbFum, qbGames, 0.2),
    avgPoints: ratio(t.points, t.scored, 22.5),
    volume: { targets: per(t.targets), carries: per(t.carries), passAtt: per(t.passAtt) },
    allowed: { QB: per(allowed.QB), RB: per(allowed.RB), WR: per(allowed.WR), TE: per(allowed.TE) },
    xpaPerPoint: ratio(t.xpa, t.points, 0.105),
    fgaPerPoint: ratio(t.fga, t.points, 0.075),
    xpPct: ratio(k.xpm, k.xpa, 0.95),
    fgMix: { short: ratio(k.short, fgAtt, 0.45), mid: ratio(k.mid, fgAtt, 0.3), long: ratio(k.long, fgAtt, 0.25) },
    fgPct: { short: ratio(k.shortM, k.short, 0.95), mid: ratio(k.midM, k.mid, 0.82), long: ratio(k.longM, k.long, 0.68) },
    perGame: {
      sacks: per(t.sacks), ints: per(t.ints), fumRec: per(t.fumRec), ff: per(t.ff),
      safeties: per(t.safeties), blocks: per(t.blocks), stTd: per(t.stTd),
    },
    defTdPerTakeaway: ratio(t.defTd, t.ints + t.fumRec, 0.08),
  };
}

export class AnalyticsModel {
  private league: League;
  private teamGameIndex = new Map<string, TeamGame>();

  constructor(
    private history: History,
    private players: Map<string, PlayerMeta>,
    private games: Map<string, Game>,
    private season: number,
  ) {
    this.league = buildLeague(history, players);
    for (const list of history.teams.values()) {
      for (const g of list) this.teamGameIndex.set(`${g.team}|${g.order}`, g);
    }
  }

  /** Weighted per-game average of a team field, regressed toward the league with `k` pseudo-games. */
  private teamRate(team: string, pick: (g: TeamGame) => number | null, leagueValue: number, k: number): number {
    const list = (this.history.teams.get(team) ?? []).filter((g) => pick(g) != null).slice(0, MAX_GAMES);
    const w = weights(list, this.season);
    const num = list.reduce((s, g, i) => s + w[i]! * pick(g)!, 0);
    const den = w.reduce((s, x) => s + x, 0);
    return (num + k * leagueValue) / (den + k);
  }

  private environment(team: string) {
    const game = this.games.get(team);
    if (!game) return null;
    const opp = game.home === team ? game.away : game.home;
    const basePoints = this.teamRate(team, (g) => g.points, this.league.avgPoints, 3);
    const implied = game.implied?.[team] ?? basePoints;
    const spreadFor = game.homeSpread == null ? 0 : game.home === team ? game.homeSpread : -game.homeSpread;
    const scale = implied / basePoints;
    return {
      opp,
      implied,
      oppImplied: game.implied?.[opp] ?? this.teamRate(opp, (g) => g.points, this.league.avgPoints, 3),
      passMult: clamp(1 - 0.008 * spreadFor, 0.9, 1.1) * clamp(scale ** 0.2, 0.95, 1.05),
      rushMult: clamp(1 + 0.012 * spreadFor, 0.85, 1.15) * clamp(scale ** 0.2, 0.95, 1.05),
      tdMult: clamp(scale ** 0.9, 0.7, 1.4),
      ydMult: clamp(scale ** 0.25, 0.92, 1.08),
    };
  }

  private defenseFactor(opp: string, pos: OffPos): number {
    const league = this.league.allowed[pos];
    if (!league) return 1;
    const allowed = this.teamRate(opp, (g) => g.allowed[pos], league, 4);
    return clamp(allowed / league, 0.85, 1.15);
  }

  project(meta: PlayerMeta): Stats | null {
    if (isRuledOut(meta)) return null;
    if (meta.pos === "DEF") return this.defense(meta.team);
    if (meta.pos === "K") return this.kicker(meta);
    return this.offense(meta, meta.pos);
  }

  private offense(meta: PlayerMeta, pos: OffPos): Stats | null {
    const env = this.environment(meta.team);
    const logs = (this.history.players.get(meta.id) ?? []).slice(0, MAX_GAMES);
    if (!env || !logs.length) return null;
    const w = weights(logs, this.season);
    const rates = this.league.pos[pos];

    let tgt = 0, teamTgt = 0, car = 0, teamCar = 0, att = 0, teamAtt = 0, wSum = 0, qbCarries = 0, qbFum = 0;
    const sums: Record<string, number> = {};
    logs.forEach((log: GameLog, i) => {
      const tg = this.teamGameIndex.get(`${log.team}|${log.order}`);
      const s = log.stats;
      const wi = w[i]!;
      wSum += wi;
      tgt += wi * s.rec_tgt!;
      car += wi * s.rush_att!;
      att += wi * s.pass_att!;
      qbCarries += wi * s.rush_att!;
      qbFum += wi * s.fum_lost!;
      teamTgt += wi * (tg?.targets ?? 0);
      teamCar += wi * (tg?.carries ?? 0);
      teamAtt += wi * (tg?.passAtt ?? 0);
      for (const k of ["rec_tgt", "rec", "rec_yd", "rec_td", "rush_att", "rush_yd", "rush_td", "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int"]) {
        sums[k] = (sums[k] ?? 0) + (s[k] ?? 0);
      }
    });

    const regress = (made: number, opps: number, league: number, k: number) => (made + k * league) / (opps + k);
    const lv = this.league.volume;
    const volume = {
      targets: this.teamRate(meta.team, (g) => g.targets, lv.targets, 3),
      carries: this.teamRate(meta.team, (g) => g.carries, lv.carries, 3),
      passAtt: this.teamRate(meta.team, (g) => g.passAtt, lv.passAtt, 3),
    };
    const oppF = this.defenseFactor(env.opp, pos);
    const ydF = env.ydMult * oppF ** 0.5;
    const tdF = env.tdMult * oppF;

    const T = ratio(tgt, teamTgt) * volume.targets * env.passMult;
    const C =
      pos === "QB"
        ? regress(qbCarries, wSum, this.league.qbRushPerGame, 3)
        : ratio(car, teamCar) * volume.carries * env.rushMult;
    const catchRate = regress(sums.rec!, sums.rec_tgt!, rates.catch, 30);
    const ypt = regress(sums.rec_yd!, sums.rec_tgt!, rates.ypt, 50);
    const tdT = regress(sums.rec_td!, sums.rec_tgt!, rates.tdPerTgt, 100);
    const ypc = regress(sums.rush_yd!, sums.rush_att!, rates.ypc, 60);
    const tdC = regress(sums.rush_td!, sums.rush_att!, rates.tdPerCarry, 120);
    const rec = T * catchRate;

    const line: Stats = {
      rec_tgt: T,
      rec,
      rec_yd: T * ypt * ydF,
      rec_td: T * tdT * tdF,
      rush_att: C,
      rush_yd: C * ypc * ydF,
      rush_td: C * tdC * tdF,
      fum_lost: pos === "QB" ? regress(qbFum, wSum, this.league.qbFumPerGame, 3) : (C + rec) * rates.fumPerTouch,
    };
    if (pos === "QB") {
      // History alone misses new starters (trades, injuries); the depth chart settles who throws.
      let share = ratio(att, teamAtt);
      if (meta.depth === 1) share = Math.max(share, 0.95);
      else if (meta.depth != null && meta.depth > 1) share = Math.min(share, 0.1);
      const A = share * volume.passAtt * env.passMult;
      line.pass_att = A;
      line.pass_cmp = A * regress(sums.pass_cmp!, sums.pass_att!, rates.cmp, 120);
      line.pass_yd = A * regress(sums.pass_yd!, sums.pass_att!, rates.ypa, 150) * ydF;
      line.pass_td = A * regress(sums.pass_td!, sums.pass_att!, rates.tdPerAtt, 300) * tdF;
      line.pass_int = A * regress(sums.pass_int!, sums.pass_att!, rates.intPerAtt, 300);
    }
    return cleanLine(line, pos);
  }

  private kicker(meta: PlayerMeta): Stats | null {
    const env = this.environment(meta.team);
    if (!env) return null;
    const L = this.league;
    const logs = (this.history.players.get(meta.id) ?? []).slice(0, 16);
    const sum = (k: string) => logs.reduce((s, l) => s + (l.stats[k] ?? 0), 0);
    const att = { short: sum("_fga_short"), mid: sum("_fga_mid"), long: sum("_fga_long") };
    const made = { short: sum("_fgm_short"), mid: sum("_fgm_mid"), long: sum("_fgm_long") };
    const allAtt = att.short + att.mid + att.long;
    const mix = (b: keyof typeof att) => (att[b] + 15 * L.fgMix[b]) / (allAtt + 15);
    const pct = (b: keyof typeof att) => (made[b] + 10 * L.fgPct[b]) / (att[b] + 10);
    const xpPct = (sum("xpm") + 30 * L.xpPct) / (sum("_xpa") + 30);

    const fga = env.implied * L.fgaPerPoint;
    const xpa = env.implied * L.xpaPerPoint;
    const short = fga * mix("short") * pct("short");
    const mid = fga * mix("mid") * pct("mid");
    const long = fga * mix("long") * pct("long");
    return cleanLine(
      {
        fgm_0_19: short * 0.05,
        fgm_20_29: short * 0.45,
        fgm_30_39: short * 0.5,
        fgm_40_49: mid,
        fgm_50p: long,
        fgmiss: Math.max(0, fga - short - mid - long),
        xpm: xpa * xpPct,
        xpmiss: xpa * (1 - xpPct),
      },
      "K",
    );
  }

  private defense(team: string): Stats | null {
    const env = this.environment(team);
    if (!env) return null;
    const L = this.league.perGame;
    const own = (pick: (g: TeamGame) => number, league: number, k = 3) => this.teamRate(team, pick, league, k);
    const opp = (pick: (g: TeamGame) => number, league: number, k = 3) => this.teamRate(env.opp, pick, league, k);
    const sack = 0.5 * own((g) => g.sacks, L.sacks) + 0.5 * opp((g) => g.sacksTaken, L.sacks);
    const int = 0.5 * own((g) => g.ints, L.ints) + 0.5 * opp((g) => g.intsThrown, L.ints);
    const fumRec = 0.5 * own((g) => g.fumRec, L.fumRec) + 0.5 * opp((g) => g.fumLost, L.fumRec);
    return cleanLine(
      {
        sack,
        int,
        fum_rec: fumRec,
        ff: own((g) => g.ff, L.ff),
        def_td: this.league.defTdPerTakeaway * (int + fumRec),
        safe: L.safeties,
        blk_kick: own((g) => g.blocks, L.blocks, 8),
        def_st_td: own((g) => g.stTd, L.stTd, 10),
        pts_allow: env.oppImplied,
        ...paBuckets(env.oppImplied),
      },
      "DEF",
    );
  }
}

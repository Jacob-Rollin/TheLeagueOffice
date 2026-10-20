/**
 * Server-only fact packs for Front Office weekly desks.
 * Ownership + depth + trending for Waiver; SOS + points-allowed for Start/Sit.
 */
import type { DeskPlayerBlurb } from "@/lib/weekly-desk-html";
import type { DepthChartEntry, Pos } from "@/lib/players.server";
import { teamById } from "@/lib/nfl-teams";
import { sosFromBoard, type SosBoardLike } from "@/lib/sos-from-board";

export type WaiverDeskPack = {
  kind: "waiver";
  week: number;
  season: number;
  players: Array<{
    id: string;
    name: string;
    pos: string;
    team: string;
    teamNickname: string;
    nextOpponent: string;
    owned: number;
    trendCount: number;
    /** Why this player made the board. */
    role: "starter" | "injury-elevated";
    depthOrder: number;
  }>;
};

export type StartSitDeskPack = {
  kind: "start-sit";
  week: number;
  season: number;
  byPos: Record<
    string,
    Array<{
      id: string;
      name: string;
      pos: string;
      team: string;
      opp: string;
      oppNickname: string;
      sosRank: number;
      /** Fantasy points this opponent has allowed per game to this position. */
      oppPointsAllowed: number | null;
      grade: string;
      lean: "start" | "sit";
    }>
  >;
};

const SKILL = new Set(["QB", "RB", "WR", "TE", "DEF", "DST"]);
const START_SIT_POS = ["QB", "RB", "WR", "TE", "DST"] as const;
/** Soft caps — prefer ~3 QB / 5 RB / 5 WR when available; not hard quotas. */
const WAIVER_SOFT_CAPS: Record<string, number> = { QB: 3, RB: 5, WR: 5, TE: 2, DST: 2 };
const WAIVER_OWNED_MAX = 60;
const WAIVER_BOARD_TARGET = 14;
const WAIVER_TOP_LIST = 10;

/** Out / IR / NA / PUP / Sus etc. — not startable, not a waiver add. */
function isRuledOutStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!s) return false;
  return (
    s === "O" ||
    s === "OUT" ||
    s === "IR" ||
    s === "PUP" ||
    s === "SUS" ||
    s === "SUSPENDED" ||
    s === "NA" ||
    s === "IA" ||
    s === "INACTIVE" ||
    s === "DNR" ||
    s === "COV" ||
    s === "DOUBTFUL" ||
    s === "D" ||
    /^OUT\b/.test(String(status))
  );
}

async function nflState(): Promise<{ season: number; week: number }> {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
    headers: { accept: "application/json" },
  }).catch(() => null);
  const json = res?.ok ? ((await res.json().catch(() => null)) as { season?: string; week?: number } | null) : null;
  return {
    season: Number(json?.season) || new Date().getUTCFullYear(),
    week: Math.max(1, Number(json?.week) || 1),
  };
}

async function trendingAdds(limit = 80): Promise<{ player_id: string; count: number }[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=${limit}`,
    { headers: { accept: "application/json" } },
  ).catch(() => null);
  if (!res?.ok) return [];
  const json = (await res.json().catch(() => null)) as { player_id?: string; count?: number }[] | null;
  return (Array.isArray(json) ? json : [])
    .map((r) => ({ player_id: String(r?.player_id ?? ""), count: Number(r?.count) || 0 }))
    .filter((r) => r.player_id);
}

type DepthIndex = {
  byId: Map<string, { team: string; pos: Pos; order: number; depthPos: string | null; injury: string | null }>;
  charts: Map<string, Map<Pos, DepthChartEntry[]>>;
};

function indexDepth(charts: Map<string, Map<Pos, DepthChartEntry[]>>): DepthIndex {
  const byId = new Map<string, { team: string; pos: Pos; order: number; depthPos: string | null; injury: string | null }>();
  for (const [team, byPos] of charts) {
    for (const [pos, list] of byPos) {
      for (const e of list) {
        byId.set(e.id, {
          team,
          pos,
          order: e.order ?? 99,
          depthPos: e.depthPos ?? null,
          injury: e.injury,
        });
      }
    }
  }
  return { byId, charts };
}

/** True RB1/QB1/TE1 or WR slot starter (order 1 in LWR/RWR/SWR). */
function isDepthStarter(entry: { pos: Pos; order: number; depthPos: string | null }): boolean {
  if (entry.pos === "K") return false;
  if (entry.pos === "WR") return entry.order === 1 && Boolean(entry.depthPos);
  return entry.order === 1;
}

/** Backup whose same-slot (or position) starter is ruled out. */
function isInjuryElevated(
  charts: Map<string, Map<Pos, DepthChartEntry[]>>,
  entry: { team: string; pos: Pos; order: number; depthPos: string | null },
): boolean {
  if (entry.order <= 1) return false;
  const list = charts.get(entry.team)?.get(entry.pos) ?? [];
  const ahead = list.filter((e) => {
    const ord = e.order ?? 99;
    if (ord >= entry.order) return false;
    if (entry.pos === "WR") {
      const slot = e.depthPos ?? null;
      return Boolean(entry.depthPos) && slot === entry.depthPos;
    }
    return true;
  });
  if (!ahead.length) return false;
  return ahead.every((e) => isRuledOutStatus(e.injury));
}

function teamNickname(abbr: string): string {
  const t = teamById(abbr);
  return t?.name ?? abbr;
}

/** "vs. Saints" / "at Vikings" from SOS schedule; empty when unknown. */
function nextOpponentLabel(board: SosBoardLike | null, team: string, week: number): string {
  const upper = team.trim().toUpperCase();
  if (!board || !upper || upper === "FA") return "";
  const game = board.schedule.find(
    ([w, home, away]) => w === week && (home === upper || away === upper) && home && away,
  );
  if (!game) return "";
  const [, home, away] = game;
  const opp = home === upper ? away : home;
  const nick = teamNickname(opp);
  return home === upper ? `vs. ${nick}` : `at ${nick}`;
}

/** Prefer mid-availability ownership over ghosts and near-rostered. Eligibility: <60%. */
function ownershipScore(owned: number): number {
  if (owned <= 0 || owned >= WAIVER_OWNED_MAX) return -50;
  if (owned < 5) return owned * 2;
  if (owned <= 40) return 45 - Math.abs(owned - 20);
  return 65 - owned;
}

export async function buildWaiverDeskPack(): Promise<WaiverDeskPack> {
  const { loadSleeperOwnershipMap, loadPlayers, loadDepthCharts, loadSosBoard } = await import(
    "@/lib/players.server"
  );
  const { season, week } = await nflState();
  const [ownership, trending, catalog, depthRaw, sosBoard] = await Promise.all([
    loadSleeperOwnershipMap().catch(() => new Map()),
    trendingAdds(80),
    loadPlayers().catch(() => null),
    loadDepthCharts().catch(() => new Map() as Map<string, Map<Pos, DepthChartEntry[]>>),
    loadSosBoard(String(season)).catch(() => null) as Promise<SosBoardLike | null>,
  ]);

  const byId = new Map((catalog?.players ?? []).map((p) => [p.id, p]));
  const depth = indexDepth(depthRaw);
  const trendMap = new Map(trending.map((t) => [t.player_id, t.count]));

  type Cand = WaiverDeskPack["players"][number] & { score: number };
  const scored = new Map<string, Cand>();

  const consider = (id: string) => {
    if (scored.has(id)) return;
    const p = byId.get(id);
    if (!p) return;
    const posRaw = String(p.pos || "").toUpperCase();
    if (!SKILL.has(posRaw) || posRaw === "K") return;
    const injury = p.injury_status ?? p.injury ?? null;
    if (isRuledOutStatus(injury)) return;

    const owned = ownership.get(id)?.owned ?? 100;
    if (owned >= WAIVER_OWNED_MAX) return;

    const pos = (posRaw === "DEF" ? "DEF" : posRaw) as Pos;
    const d = depth.byId.get(id);
    const isDst = pos === "DEF";
    const starter = isDst || (d ? isDepthStarter(d) : false);
    const elevated = d ? isInjuryElevated(depth.charts, d) : false;
    if (!starter && !elevated) return;

    const proj = p.proj?.half ?? 0;
    const rank = p.rank?.half ?? 999;
    if (!elevated && proj <= 0 && rank >= 300) return;

    const team = p.team || "FA";
    const trendCount = trendMap.get(id) ?? 0;
    const role: "starter" | "injury-elevated" = elevated ? "injury-elevated" : "starter";
    const score =
      (elevated ? 120 : 0) +
      (starter ? 50 : 0) +
      Math.min(trendCount, 80) * 0.6 +
      ownershipScore(owned) +
      Math.min(proj, 20) * 2.5 +
      (rank < 200 ? (200 - rank) * 0.15 : 0);

    scored.set(id, {
      id: p.id,
      name: p.name,
      pos: posRaw === "DEF" ? "DST" : posRaw,
      team,
      teamNickname: teamNickname(team),
      nextOpponent: nextOpponentLabel(sosBoard, team, week) || "TBD",
      owned,
      trendCount,
      role,
      depthOrder: d?.order ?? (isDst ? 1 : 99),
      score,
    });
  };

  for (const t of trending) consider(t.player_id);
  for (const [id, d] of depth.byId) {
    if (isInjuryElevated(depth.charts, d)) consider(id);
  }
  for (const [id, d] of depth.byId) {
    if (!isDepthStarter(d)) continue;
    const owned = ownership.get(id)?.owned ?? 100;
    if (owned > 0 && owned < WAIVER_OWNED_MAX) consider(id);
  }

  const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.owned - b.owned);
  const picked: WaiverDeskPack["players"] = [];
  const usedTeam = new Set<string>();
  const posCount = new Map<string, number>();

  for (const row of ranked) {
    if (row.team !== "FA" && usedTeam.has(row.team)) continue;
    const cap = WAIVER_SOFT_CAPS[row.pos] ?? 2;
    const pc = posCount.get(row.pos) ?? 0;
    if (pc >= cap) continue;
    picked.push({
      id: row.id,
      name: row.name,
      pos: row.pos,
      team: row.team,
      teamNickname: row.teamNickname,
      nextOpponent: row.nextOpponent,
      owned: row.owned,
      trendCount: row.trendCount,
      role: row.role,
      depthOrder: row.depthOrder,
    });
    if (row.team !== "FA") usedTeam.add(row.team);
    posCount.set(row.pos, pc + 1);
    if (picked.length >= WAIVER_BOARD_TARGET) break;
  }

  return { kind: "waiver", week, season, players: picked };
}

export async function buildStartSitDeskPack(): Promise<StartSitDeskPack> {
  const { loadSosBoard, loadPlayers, loadDepthCharts } = await import("@/lib/players.server");
  const { season, week } = await nflState();
  const [board, catalog, depthRaw] = await Promise.all([
    loadSosBoard(String(season)).catch(() => null),
    loadPlayers().catch(() => null),
    loadDepthCharts().catch(() => new Map() as Map<string, Map<Pos, DepthChartEntry[]>>),
  ]);
  const depth = indexDepth(depthRaw);
  const byPos: StartSitDeskPack["byPos"] = {};

  type Cand = StartSitDeskPack["byPos"][string][number] & { score: number };
  const pool: Cand[] = [];

  for (const p of catalog?.players ?? []) {
    const posRaw = String(p.pos || "").toUpperCase();
    if (!SKILL.has(posRaw) || posRaw === "K") continue;
    if (p.team === "FA" || !p.team) continue;
    const injury = p.injury_status ?? p.injury ?? null;
    if (isRuledOutStatus(injury)) continue;

    const pos = posRaw === "DEF" ? "DST" : posRaw;
    const sosPos = pos === "DST" ? "DEF" : (pos as Pos);

    if (pos !== "DST") {
      const d = depth.byId.get(p.id);
      if (!d || !isDepthStarter(d)) continue;
    }

    const sos = sosFromBoard(board as SosBoardLike | null, p.team, sosPos);
    const thisWeek = sos?.opponents.find((o) => o.week === week);
    if (!thisWeek?.rank) continue;
    const rank = thisWeek.rank;
    const soft = rank >= 25;
    const hard = rank <= 8;
    if (!soft && !hard) continue;
    const lean: "start" | "sit" = soft ? "start" : "sit";
    const pa = thisWeek.pointsAllowed;
    // Prefer extremes that also line up with points-allowed when present.
    const paBoost =
      pa == null
        ? 0
        : lean === "start"
          ? Math.min(pa, 30) * 0.15
          : Math.max(0, 18 - pa) * 0.2;
    const score = (soft ? rank : 33 - rank) + paBoost;
    pool.push({
      id: p.id,
      name: p.name,
      pos,
      team: p.team,
      opp: thisWeek.opp,
      oppNickname: teamNickname(thisWeek.opp),
      sosRank: rank,
      oppPointsAllowed: pa,
      grade: soft ? "Favorable" : "Tough",
      lean,
      score,
    });
  }

  const usedTeam = new Set<string>();
  const take = (rows: Cand[], n: number): Cand[] => {
    const out: Cand[] = [];
    for (const r of rows) {
      if (usedTeam.has(r.team)) continue;
      out.push(r);
      usedTeam.add(r.team);
      if (out.length >= n) break;
    }
    return out;
  };

  for (const pos of START_SIT_POS) {
    const starts = take(
      pool.filter((r) => r.pos === pos && r.lean === "start").sort((a, b) => b.score - a.score),
      3,
    );
    const sits = take(
      pool.filter((r) => r.pos === pos && r.lean === "sit").sort((a, b) => b.score - a.score),
      2,
    );
    const mixed = [...starts, ...sits].slice(0, 5);
    if (mixed.length) {
      byPos[pos] = mixed.map(({ score: _s, ...rest }) => rest);
    }
  }

  if (Object.keys(byPos).length === 0) {
    const used = new Set<string>();
    for (const pos of START_SIT_POS) {
      const sample = (catalog?.players ?? [])
        .filter((p) => {
          const pr = String(p.pos || "").toUpperCase();
          const norm = pr === "DEF" ? "DST" : pr;
          if (norm !== pos || !p.team || p.team === "FA") return false;
          if (isRuledOutStatus(p.injury_status ?? p.injury)) return false;
          if (norm !== "DST") {
            const d = depth.byId.get(p.id);
            if (!d || !isDepthStarter(d)) return false;
          }
          return true;
        })
        .filter((p) => {
          if (used.has(p.team)) return false;
          used.add(p.team);
          return true;
        })
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          name: p.name,
          pos,
          team: p.team || "FA",
          opp: "TBD",
          oppNickname: "TBD",
          sosRank: 16,
          oppPointsAllowed: null as number | null,
          grade: "Neutral",
          lean: "start" as const,
        }));
      if (sample.length) byPos[pos] = sample;
    }
  }

  return { kind: "start-sit", week, season, byPos };
}

function posShort(pos: string): string {
  const p = pos.toUpperCase();
  return p === "DEF" ? "DST" : p;
}

function posPhrase(pos: string): string {
  switch (pos.toUpperCase()) {
    case "QB":
      return "quarterbacks";
    case "RB":
      return "running backs";
    case "WR":
      return "wide receivers";
    case "TE":
      return "tight ends";
    case "DST":
    case "DEF":
      return "fantasy defenses";
    default:
      return pos.toLowerCase();
  }
}

/**
 * Our board ranks defenses for the offense's position: 1 = toughest, 32 = softest.
 * Phrase the opponent as a defense vs that position — never "SOS Favorable".
 */
function defenseVsPosStanding(rank: number, pos: string): string {
  const spot = posPhrase(pos);
  if (rank >= 32) return `the worst defense against ${spot} so far this season`;
  if (rank >= 30) return `one of the softest defenses against ${spot} so far this season`;
  if (rank >= 25) return `a below-average defense against ${spot} through the season to date`;
  if (rank <= 1) return `the toughest defense against ${spot} so far this season`;
  if (rank <= 3) return `one of the stingiest defenses against ${spot} so far this season`;
  if (rank <= 8) return `a top-tier defense against ${spot} through the season to date`;
  return `a middle-of-the-pack defense against ${spot} so far this season`;
}

/** Template blurbs when LLM is unavailable. */
export function templateWaiverBlurbs(pack: WaiverDeskPack): DeskPlayerBlurb[] {
  return pack.players.map((p) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    teamNickname: p.teamNickname,
    nextOpponent: p.nextOpponent,
    statLine: `ROSTERED: ${p.owned}%`,
    blurb:
      p.role === "injury-elevated"
        ? `${p.name} moves into a larger Week ${pack.week} role with the depth-chart starter sidelined — available in most leagues at ${p.owned}% rostered.`
        : p.owned <= 25
          ? `${p.name} is a depth-chart starter still widely available at ${p.owned}% rostered and worth priority consideration for managers hunting a secure role.`
          : `${p.name} starts for ${p.team} and remains available at ${p.owned}% rostered — still claimable in many leagues with a clear weekly role.`,
  }));
}

export function templateStartSitBlurbs(pack: StartSitDeskPack): Record<string, DeskPlayerBlurb[]> {
  const out: Record<string, DeskPlayerBlurb[]> = {};
  for (const [pos, rows] of Object.entries(pack.byPos)) {
    out[pos] = rows.map((p) => {
      const vs = /^at\s+/i.test(p.opp) || /^vs\.?\s+/i.test(p.opp) ? p.opp : `vs ${p.opp}`;
      const pa =
        p.oppPointsAllowed != null && Number.isFinite(p.oppPointsAllowed)
          ? Math.round(p.oppPointsAllowed * 10) / 10
          : null;
      const oppLabel = p.oppNickname || p.opp;
      const standing = defenseVsPosStanding(p.sosRank, p.pos);
      const spot = posPhrase(p.pos);
      const short = posShort(p.pos);
      let blurb: string;
      if (p.lean === "start") {
        blurb =
          pa != null
            ? `${p.name} draws the ${oppLabel} in Week ${pack.week}. The ${oppLabel} are ${standing}, allowing ${pa} fantasy points per game to ${spot}. Start him.`
            : `${p.name} draws the ${oppLabel} in Week ${pack.week}. The ${oppLabel} are ${standing}. Start him.`;
      } else {
        blurb =
          pa != null
            ? `${p.name} faces the ${oppLabel} in Week ${pack.week}. The ${oppLabel} are ${standing}, holding ${spot} to ${pa} fantasy points per game. Sit him if you have a cleaner option.`
            : `${p.name} faces the ${oppLabel} in Week ${pack.week}. The ${oppLabel} are ${standing}. Sit him if you have a cleaner option.`;
      }
      return {
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        statLine: `${p.lean.toUpperCase()} · ${vs} · Opp rank vs ${short}: ${p.sosRank}`,
        blurb,
      };
    });
  }
  return out;
}

/** Top N for the priority table (default 10). */
export function waiverTopList(players: DeskPlayerBlurb[], limit = WAIVER_TOP_LIST): DeskPlayerBlurb[] {
  return players.slice(0, limit);
}

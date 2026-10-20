/**
 * Server-only fact packs for Front Office weekly desks.
 * Ownership + depth + trending for Waiver; SOS + starters for Start/Sit. No FAAB.
 */
import type { DeskPlayerBlurb } from "@/lib/weekly-desk-html";
import type { DepthChartEntry, Pos } from "@/lib/players.server";
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
      sosRank: number;
      grade: string;
      lean: "start" | "sit";
    }>
  >;
};

const SKILL = new Set(["QB", "RB", "WR", "TE", "DEF", "DST"]);
const START_SIT_POS = ["QB", "RB", "WR", "TE", "DST"] as const;

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

async function trendingAdds(limit = 60): Promise<{ player_id: string; count: number }[]> {
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

/** Prefer mid-availability ownership over 0–2% ghosts and 45%+ near-rostered. */
function ownershipScore(owned: number): number {
  if (owned <= 0 || owned > 50) return -50;
  if (owned < 5) return owned * 2;
  if (owned <= 35) return 45 - Math.abs(owned - 18);
  return 55 - owned;
}

export async function buildWaiverDeskPack(): Promise<WaiverDeskPack> {
  const { loadSleeperOwnershipMap, loadPlayers, loadDepthCharts } = await import("@/lib/players.server");
  const [{ season, week }, ownership, trending, catalog, depthRaw] = await Promise.all([
    nflState(),
    loadSleeperOwnershipMap().catch(() => new Map()),
    trendingAdds(60),
    loadPlayers().catch(() => null),
    loadDepthCharts().catch(() => new Map() as Map<string, Map<Pos, DepthChartEntry[]>>),
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
    if (owned > 50) return;

    const pos = (posRaw === "DEF" ? "DEF" : posRaw) as Pos;
    const d = depth.byId.get(id);
    // DST: treat as starter when on a team (no skill-depth chart).
    const isDst = pos === "DEF";
    const starter = isDst || (d ? isDepthStarter(d) : false);
    const elevated = d ? isInjuryElevated(depth.charts, d) : false;
    if (!starter && !elevated) return;

    // Require some fantasy relevance unless injury-elevated (handcuff surge).
    const proj = p.proj?.half ?? 0;
    const rank = p.rank?.half ?? 999;
    if (!elevated && proj <= 0 && rank >= 300) return;

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
      team: p.team || "FA",
      owned,
      trendCount,
      role,
      depthOrder: d?.order ?? (isDst ? 1 : 99),
      score,
    });
  };

  for (const t of trending) consider(t.player_id);

  // Seed injury-elevated backups even when they are not yet trending.
  for (const [id, d] of depth.byId) {
    if (isInjuryElevated(depth.charts, d)) consider(id);
  }

  // Seed low-owned depth starters (available RB1/WR1/etc.) even without a trend spike.
  for (const [id, d] of depth.byId) {
    if (!isDepthStarter(d)) continue;
    const owned = ownership.get(id)?.owned ?? 100;
    if (owned > 0 && owned <= 45) consider(id);
  }

  const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.owned - b.owned);
  // Diversify: at most 2 per position, 1 per NFL team.
  const picked: WaiverDeskPack["players"] = [];
  const usedTeam = new Set<string>();
  const posCount = new Map<string, number>();
  for (const row of ranked) {
    if (row.team !== "FA" && usedTeam.has(row.team)) continue;
    const pc = posCount.get(row.pos) ?? 0;
    if (pc >= 2) continue;
    picked.push({
      id: row.id,
      name: row.name,
      pos: row.pos,
      team: row.team,
      owned: row.owned,
      trendCount: row.trendCount,
      role: row.role,
      depthOrder: row.depthOrder,
    });
    if (row.team !== "FA") usedTeam.add(row.team);
    posCount.set(row.pos, pc + 1);
    if (picked.length >= 8) break;
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

    // Starters only (depth chart). DST = the team unit.
    if (pos !== "DST") {
      const d = depth.byId.get(p.id);
      if (!d || !isDepthStarter(d)) continue;
    }

    const sos = sosFromBoard(board as SosBoardLike | null, p.team, sosPos);
    const thisWeek = sos?.opponents.find((o) => o.week === week);
    if (!thisWeek?.rank) continue;
    const rank = thisWeek.rank;
    // Extreme matchups only: soft (≥25) or hard (≤8).
    const soft = rank >= 25;
    const hard = rank <= 8;
    if (!soft && !hard) continue;
    const lean: "start" | "sit" = soft ? "start" : "sit";
    const score = soft ? rank : 33 - rank;
    pool.push({
      id: p.id,
      name: p.name,
      pos,
      team: p.team,
      opp: thisWeek.opp,
      sosRank: rank,
      grade: soft ? "Favorable" : "Tough",
      lean,
      score,
    });
  }

  // One NFL team across the whole article; per-pos ~3 starts + 2 sits.
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

  // Prefer filling starts first so soft-matchup stars aren't crowded out by sits.
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

  // Cold SOS fallback — still starters only + one per team.
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
          sosRank: 16,
          grade: "Neutral",
          lean: "start" as const,
        }));
      if (sample.length) byPos[pos] = sample;
    }
  }

  return { kind: "start-sit", week, season, byPos };
}

/** Template blurbs when LLM is unavailable. */
export function templateWaiverBlurbs(pack: WaiverDeskPack): DeskPlayerBlurb[] {
  return pack.players.map((p) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    meta: `${p.owned}% rostered${p.trendCount ? ` · ${p.trendCount} trending adds` : ""}${
      p.role === "injury-elevated" ? " · role bump" : " · starter"
    }`,
    blurb:
      p.role === "injury-elevated"
        ? `${p.name} moves into a larger Week ${pack.week} role with the depth-chart starter sidelined — available in most leagues at ${p.owned}% rostered.`
        : p.owned <= 25
          ? `${p.name} is a depth-chart starter still widely available at ${p.owned}% rostered and worth priority consideration for managers hunting a secure role.`
          : `${p.name} starts for ${p.team} and sits at ${p.owned}% rostered — still claimable in many leagues with a clear weekly role.`,
  }));
}

export function templateStartSitBlurbs(pack: StartSitDeskPack): Record<string, DeskPlayerBlurb[]> {
  const out: Record<string, DeskPlayerBlurb[]> = {};
  for (const [pos, rows] of Object.entries(pack.byPos)) {
    out[pos] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: p.team,
      meta: `${p.lean.toUpperCase()} · vs ${p.opp} · SOS ${p.sosRank} (${p.grade})`,
      blurb:
        p.lean === "start"
          ? `${p.name} draws a favorable Week ${pack.week} matchup against ${p.opp} (SOS rank ${p.sosRank}). Lock him in as a starter.`
          : `${p.name} faces a tough Week ${pack.week} draw vs ${p.opp} (SOS rank ${p.sosRank}). Look for a cleaner matchup elsewhere if you have options.`,
    }));
  }
  return out;
}

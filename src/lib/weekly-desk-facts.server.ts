/**
 * Server-only fact packs for Front Office weekly desks.
 * Ownership + trending for Waiver; SOS board for Start/Sit. No FAAB.
 */
import type { DeskPlayerBlurb } from "@/lib/weekly-desk-html";
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

async function trendingAdds(limit = 40): Promise<{ player_id: string; count: number }[]> {
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

export async function buildWaiverDeskPack(): Promise<WaiverDeskPack> {
  const { loadSleeperOwnershipMap, loadPlayers } = await import("@/lib/players.server");
  const [{ season, week }, ownership, trending, catalog] = await Promise.all([
    nflState(),
    loadSleeperOwnershipMap().catch(() => new Map()),
    trendingAdds(50),
    loadPlayers().catch(() => null),
  ]);
  const byId = new Map((catalog?.players ?? []).map((p) => [p.id, p]));

  const rows: WaiverDeskPack["players"] = [];
  for (const t of trending) {
    const p = byId.get(t.player_id);
    if (!p) continue;
    const pos = String(p.pos || "").toUpperCase();
    if (!SKILL.has(pos) || pos === "K") continue;
    const owned = ownership.get(t.player_id)?.owned ?? 100;
    if (owned > 50) continue;
    rows.push({
      id: p.id,
      name: p.name,
      pos: pos === "DEF" ? "DST" : pos,
      team: p.team || "FA",
      owned,
      trendCount: t.count,
    });
    if (rows.length >= 8) break;
  }

  // Fill with low-owned skill players if trending was thin.
  if (rows.length < 5) {
    const extras = [...ownership.entries()]
      .filter(([, o]) => o.owned > 0 && o.owned <= 40)
      .sort((a, b) => a[1].owned - b[1].owned)
      .slice(0, 30);
    for (const [id, o] of extras) {
      if (rows.some((r) => r.id === id)) continue;
      const p = byId.get(id);
      if (!p) continue;
      const pos = String(p.pos || "").toUpperCase();
      if (!SKILL.has(pos) || pos === "K") continue;
      rows.push({
        id: p.id,
        name: p.name,
        pos: pos === "DEF" ? "DST" : pos,
        team: p.team || "FA",
        owned: o.owned,
        trendCount: 0,
      });
      if (rows.length >= 8) break;
    }
  }

  return { kind: "waiver", week, season, players: rows.slice(0, 8) };
}

export async function buildStartSitDeskPack(): Promise<StartSitDeskPack> {
  const { loadSosBoard, loadPlayers } = await import("@/lib/players.server");
  const { season, week } = await nflState();
  const [board, catalog] = await Promise.all([
    loadSosBoard(String(season)).catch(() => null),
    loadPlayers().catch(() => null),
  ]);
  const byId = new Map((catalog?.players ?? []).map((p) => [p.id, p]));
  const positions = ["QB", "RB", "WR", "TE", "DST"] as const;
  const byPos: StartSitDeskPack["byPos"] = {};

  // Score active skill players by this week's SOS extremity.
  type Cand = StartSitDeskPack["byPos"][string][number] & { score: number };
  const pool: Cand[] = [];
  for (const p of catalog?.players ?? []) {
    const posRaw = String(p.pos || "").toUpperCase();
    if (!SKILL.has(posRaw) || posRaw === "K") continue;
    if (p.team === "FA" || !p.team) continue;
    const pos = posRaw === "DEF" ? "DST" : posRaw;
    const sos = sosFromBoard(board as SosBoardLike | null, p.team, pos === "DST" ? "DEF" : pos);
    const thisWeek = sos?.opponents.find((o) => o.week === week);
    if (!thisWeek?.rank) continue;
    const rank = thisWeek.rank;
    // Extreme matchups only: top-8 soft or bottom-8 hard (rank 1 = toughest usually in our board).
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

  for (const pos of positions) {
    const starts = pool
      .filter((r) => r.pos === pos && r.lean === "start")
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const sits = pool
      .filter((r) => r.pos === pos && r.lean === "sit")
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const mixed = [...starts, ...sits].slice(0, 5);
    if (mixed.length) {
      byPos[pos] = mixed.map(({ score: _s, ...rest }) => rest);
    }
  }

  // Ensure we have something readable even if SOS is cold — sample from catalog.
  if (Object.keys(byPos).length === 0) {
    for (const pos of positions) {
      const sample = (catalog?.players ?? [])
        .filter((p) => {
          const pr = String(p.pos || "").toUpperCase();
          const norm = pr === "DEF" ? "DST" : pr;
          return norm === pos && p.team && p.team !== "FA";
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

  void byId;
  return { kind: "start-sit", week, season, byPos };
}

/** Template blurbs when LLM is unavailable. */
export function templateWaiverBlurbs(pack: WaiverDeskPack): DeskPlayerBlurb[] {
  return pack.players.map((p) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    meta: `${p.owned}% rostered${p.trendCount ? ` · ${p.trendCount} trending adds` : ""}`,
    blurb:
      p.owned <= 25
        ? `${p.name} remains widely available at ${p.owned}% rostered and is drawing waiver attention for managers hunting upside.`
        : `${p.name} sits at ${p.owned}% rostered — still claimable in most leagues with a role worth monitoring this week.`,
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
          ? `${p.name} draws a favorable Week ${pack.week} matchup against ${p.opp} (SOS rank ${p.sosRank}). Treat as a strong start if the role is secure.`
          : `${p.name} faces a tough Week ${pack.week} draw vs ${p.opp} (SOS rank ${p.sosRank}). Consider sitting if you have cleaner options.`,
    }));
  }
  return out;
}

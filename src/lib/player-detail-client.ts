/**
 * Assemble player popup/detail payload in the browser from catalog + brain +
 * SOS board + weekly actuals. Avoids Fluid getPlayerDetail (buildPlayers,
 * season-stat maps, ownership research) on every open.
 */

import { readCache } from "@/lib/sleeper-cache";
import { fetchGameLogsClient } from "@/lib/sleeper-client";
import { fetchResearchSosBoard } from "@/lib/research-cdn";
import { currentSeason, type Player, type Pos, POSITIONS } from "@/lib/players-build";
import type { PlayerDetail, SeasonLine } from "@/lib/players.server";
import { sosFromBoard } from "@/lib/sos-from-board";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import type { PlayersPayload } from "@/lib/players-build";

const CATALOG_KEY = "players-v3";

function emptySeasonLine(season: string, raw: Record<string, number> = {}): SeasonLine {
  return {
    season,
    games: 0,
    points: { std: 0, half: 0, ppr: 0 },
    posRank: null,
    line: [],
    raw,
  };
}

function seasonLineFromCareer(
  year: string,
  games: number,
  pts: { std: number | null; half: number | null; ppr: number | null },
  raw: Record<string, number>,
): SeasonLine {
  return {
    season: year,
    games,
    points: {
      std: pts.std ?? 0,
      half: pts.half ?? 0,
      ppr: pts.ppr ?? 0,
    },
    posRank: null,
    line: [],
    raw,
  };
}

function simpleInjuryRisk(player: Player, history: SeasonLine[]) {
  const factors: string[] = [];
  let score = 20;
  const rookie = player.exp === 0 || (player.exp === null && history.length === 0);
  const missed = history.map((h) => Math.max(0, 17 - h.games)).filter((m) => Number.isFinite(m));
  const totalMissed = missed.reduce((a, b) => a + b, 0);
  if (rookie) factors.push("Rookie — no NFL injury history");
  else if (history.length) {
    score += Math.min(45, totalMissed * 5);
    if (totalMissed >= 6) factors.push(`${totalMissed} games missed over the last ${history.length} seasons`);
    else if (totalMissed > 0) factors.push(`${totalMissed} games missed recently`);
    else factors.push("No games missed in tracked seasons");
  }
  if (player.injury) {
    score += 20;
    factors.push(`Currently listed ${player.injury}`);
  }
  score = Math.max(0, Math.min(100, score));
  score = Math.max(5, Math.min(95, score));
  const label = score >= 70 ? "High" : score >= 45 ? "Moderate" : "Low";
  return { score, label, factors };
}

async function loadCatalogPlayer(id: string): Promise<{ player: Player; season: string; all: Player[] } | null> {
  const hit = await readCache<PlayersPayload>(CATALOG_KEY);
  const payload = hit?.data;
  if (!payload?.players?.length) return null;
  const player = payload.players.find((p) => p.id === id);
  if (!player) return null;
  return { player, season: payload.season || currentSeason(), all: payload.players };
}

/**
 * Browser player detail. Returns null only when the catalog has no such id
 * (caller may fall back to Fluid once).
 */
export async function fetchPlayerDetailClient(
  id: string,
  brain?: BrainMatrix | null,
): Promise<PlayerDetail | null> {
  const clean = String(id ?? "").slice(0, 32);
  if (!clean) return null;

  const catalog = await loadCatalogPlayer(clean);
  if (!catalog) return null;

  const { player: base, season, all } = catalog;
  const brainEntry = brain?.[clean] ?? null;
  // Prefer Sleeper catalog designation (same source as table badges). Brain
  // defaults to "Healthy" which is truthy and was clobbering real Q/O/IR.
  const player = {
    ...base,
    injury: base.injury ?? null,
    injury_status: base.injury_status ?? null,
    injury_body_part: base.injury_body_part || brainEntry?.injuryType || null,
    injury_notes: base.injury_notes || brainEntry?.injuryNotes || null,
    // Ownership research stays off the request path — null until a CDN snap exists.
    rostered_pct: null as number | null,
    started_pct: null as number | null,
  };

  const fantasyDepthPositions: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const depthChart =
    player.team === "FA"
      ? []
      : fantasyDepthPositions.flatMap((slot) =>
          all
            .filter((p) => p.team === player.team && p.pos === slot)
            .sort((a, b) => b.proj.half - a.proj.half)
            .slice(0, 12)
            .map((p) => ({
              id: p.id,
              name: p.name,
              pos: p.pos,
              proj: p.proj.half,
              adp: p.adp.half,
              injury: p.injury,
            })),
        );

  const [sosBoard, logsBundle] = await Promise.all([
    fetchResearchSosBoard(season).catch(() => null),
    // Current season only here — full career loads when the Game Logs tab opens.
    fetchGameLogsClient(clean, player.team || "FA", player.pos, season, {
      includeCareer: false,
    }).catch(() => null),
  ]);

  const sos = sosFromBoard(sosBoard, player.team, player.pos);

  const career = logsBundle?.career ?? [];
  const currentCareer = career.find((c) => c.year === season);
  const seasonToDate =
    currentCareer && currentCareer.games > 0
      ? seasonLineFromCareer(season, currentCareer.games, currentCareer.pts, currentCareer.raw)
      : null;

  // History filled when user opens Logs (includeCareer). Keep injury-risk usable.
  const history: SeasonLine[] = [];

  const projection: SeasonLine = {
    ...emptySeasonLine(season),
    points: {
      std: player.proj.std,
      half: player.proj.half,
      ppr: player.proj.ppr,
    },
  };

  void POSITIONS;
  return {
    season,
    player,
    history,
    seasonToDate,
    projection,
    depthChart,
    sos,
    injuryRisk: simpleInjuryRisk(player, history),
  };
}

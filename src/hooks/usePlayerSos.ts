import { useEffect, useMemo, useState } from "react";

import type { BrainEntry, BrainMatrix } from "@/lib/playerBrainHydration";
import { currentSeason, fetchSchedule, type PlayersPayload, type ScheduleGame } from "@/lib/players-build";
import { getCached, readCache } from "@/lib/sleeper-cache";
import type { PlayerSos, SosMatchup } from "@/lib/sos-presentation";

const SCHEDULE_KEY = "schedule-v1";
const PLAYERS_KEY = "players-v1";
const DAY = 24 * 60 * 60 * 1000;

type LocalSchedule = { season: string; games: ScheduleGame[] };

async function localSchedule(): Promise<ScheduleGame[]> {
  try {
    const payload = await getCached<LocalSchedule>(SCHEDULE_KEY, DAY, async () => {
      const season = currentSeason();
      return { season, games: await fetchSchedule(season) };
    });
    return payload?.games ?? [];
  } catch {
    return [];
  }
}

/**
 * Defensive strength ranks (1 = toughest) derived from the locally cached
 * Sleeper player catalog: team defenses ordered by projected fantasy output.
 */
async function localDefenseRanks(): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  try {
    const hit = await readCache<PlayersPayload>(PLAYERS_KEY);
    const defenses = (hit?.data?.players ?? []).filter((p) => p.pos === "DEF");
    if (defenses.length === 0) return ranks;
    [...defenses]
      .sort((a, b) => b.proj.half - a.proj.half)
      .forEach((d, i) => {
        const team = (d.team || "").toUpperCase();
        if (team) ranks.set(team, i + 1);
      });
  } catch {
    /* ignore */
  }
  return ranks;
}

/** Build week-by-week matchups for a team from the native schedule catalog. */
function scheduleMatchups(team: string, games: ScheduleGame[], ranks: Map<string, number>): SosMatchup[] {
  const upper = team.toUpperCase();
  const rows: SosMatchup[] = [];
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (home !== upper && away !== upper) continue;
    if (!g.week || g.week > 18) continue;
    const opp = home === upper ? away : home;
    rows.push({ week: g.week, opp, rank: ranks.get(opp) ?? null, pointsAllowed: null });
  }
  return rows.sort((a, b) => a.week - b.week);
}

function averageRank(matchups: SosMatchup[]): number | null {
  const values = matchups.map((m) => m.rank).filter((r): r is number => r !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, r) => sum + r, 0) / values.length);
}

/**
 * Dual-layer resolver: the synchronized brain matrix wins, and when it is
 * empty the native player-asset catalog (schedule + defense ranks) supplies
 * the same shape so the section never degrades into an error box.
 */
export function usePlayerSos(brainEntry: BrainEntry | null, team: string | null | undefined): PlayerSos | null {
  const brainSos =
    brainEntry?.sos && brainEntry.sos.matchups && brainEntry.sos.matchups.length > 0
      ? brainEntry.sos
      : null;
  const [fallback, setFallback] = useState<PlayerSos | null>(null);

  useEffect(() => {
    let alive = true;
    if (brainSos || !team) {
      setFallback(null);
      return () => {
        alive = false;
      };
    }
    (async () => {
      const [games, ranks] = await Promise.all([localSchedule(), localDefenseRanks()]);
      const matchups = scheduleMatchups(team, games, ranks);
      if (!alive || matchups.length === 0) return;
      setFallback({ rank: averageRank(matchups), matchups });
    })().catch(() => {
      /* silent by design */
    });
    return () => {
      alive = false;
    };
  }, [brainSos, team]);

  return brainSos ?? fallback;
}

type SosPeer = { position: string; sos: PlayerSos | null };

/**
 * Peer schedule matrix for the position-percentile engine. When the synced
 * brain matrix lacks per-player SOS rows, the native players-v1 catalog and
 * cached schedule supply every same-position player's burden score instead.
 */
export function useSosPeerMatrix(
  position: string | null | undefined,
  brain: BrainMatrix | null | undefined,
): Record<string, SosPeer> | null {
  const brainPeersReady = useMemo(() => {
    if (!brain || !position) return false;
    let count = 0;
    for (const entry of Object.values(brain)) {
      if (entry.position === position && entry.sos && entry.sos.matchups.length > 0) count += 1;
      if (count >= 5) return true;
    }
    return false;
  }, [brain, position]);

  const [fallbackPeers, setFallbackPeers] = useState<Record<string, SosPeer> | null>(null);

  useEffect(() => {
    let alive = true;
    if (brainPeersReady || !position) {
      setFallbackPeers(null);
      return () => {
        alive = false;
      };
    }
    (async () => {
      const [games, ranks, hit] = await Promise.all([
        localSchedule(),
        localDefenseRanks(),
        readCache<PlayersPayload>(PLAYERS_KEY),
      ]);
      if (!alive) return;
      const players = (hit?.data?.players ?? []).filter(
        (p) => p.pos === position && p.team && p.pos !== "DEF",
      );
      if (players.length < 5 || games.length === 0) return;
      const byTeam = new Map<string, PlayerSos>();
      const peers: Record<string, SosPeer> = {};
      for (const p of players) {
        const team = (p.team || "").toUpperCase();
        if (!team) continue;
        let sos = byTeam.get(team);
        if (!sos) {
          const matchups = scheduleMatchups(team, games, ranks);
          if (matchups.length === 0) continue;
          sos = { rank: averageRank(matchups), matchups };
          byTeam.set(team, sos);
        }
        peers[p.id] = { position, sos };
      }
      if (Object.keys(peers).length >= 5) setFallbackPeers(peers);
    })().catch(() => {
      /* silent by design */
    });
    return () => {
      alive = false;
    };
  }, [brainPeersReady, position]);

  return useMemo(() => {
    if (brainPeersReady) return (brain as Record<string, SosPeer>) ?? null;
    if (!fallbackPeers) return null;
    const merged: Record<string, SosPeer> = { ...fallbackPeers };
    for (const [id, entry] of Object.entries(brain ?? {})) {
      if (entry.position === position && entry.sos && entry.sos.matchups.length > 0) {
        merged[id] = { position: entry.position, sos: entry.sos };
      }
    }
    return merged;
  }, [brainPeersReady, brain, fallbackPeers, position]);
}

import { useEffect, useMemo, useState } from "react";

import type { Scoring } from "@/lib/draft";
import type { BrainEntry, BrainMatrix } from "@/lib/playerBrainHydration";
import { fetchResearchSosBoard } from "@/lib/research-cdn";
import { sosFromBoard, sosPosKey } from "@/lib/sos-from-board";
import type { PlayerSos, SosMatchup } from "@/lib/sos-presentation";

function averageRank(matchups: SosMatchup[]): number | null {
  const values = matchups.map((m) => m.rank).filter((r): r is number => r !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, r) => sum + r, 0) / values.length);
}

/** True when at least one weekly matchup carries a usable defensive rank. */
export function sosHasUsableRanks(sos: PlayerSos | null | undefined): boolean {
  if (!sos?.matchups?.length) return false;
  return sos.matchups.some(
    (m) => m.rank != null && Number.isFinite(Number(m.rank)) && Number(m.rank) > 0,
  );
}

function normalizeMatchup(m: SosMatchup): SosMatchup {
  return {
    week: Number(m.week),
    opp: String(m.opp ?? ""),
    rank: m.rank != null && Number.isFinite(Number(m.rank)) ? Number(m.rank) : null,
    pointsAllowed:
      m.pointsAllowed != null && Number.isFinite(Number(m.pointsAllowed))
        ? Number(m.pointsAllowed)
        : null,
  };
}

/**
 * Prefer brain rows for a week; fill any missing weeks (e.g. week 18) from the
 * positional FPA schedule so SOS never false-byes the final regular-season week.
 */
function mergeSosWeeks(
  primary: PlayerSos | null,
  fill: PlayerSos | null,
): PlayerSos | null {
  if (!primary && !fill) return null;
  if (!fill?.matchups.length) return primary;
  if (!primary?.matchups.length) return fill;

  const byWeek = new Map<number, SosMatchup>();
  for (const m of fill.matchups) byWeek.set(m.week, normalizeMatchup(m));
  for (const m of primary.matchups) {
    const week = Number(m.week);
    const existing = byWeek.get(week);
    const next = normalizeMatchup(m);
    // Keep brain opp/rank when present; otherwise adopt schedule fill.
    if (!existing) {
      byWeek.set(week, next);
      continue;
    }
    byWeek.set(week, {
      week,
      opp: next.opp || existing.opp,
      rank: next.rank ?? existing.rank,
      pointsAllowed: next.pointsAllowed ?? existing.pointsAllowed,
    });
  }

  const matchups = [...byWeek.values()].sort((a, b) => a.week - b.week);
  return {
    rank: primary.rank ?? fill.rank ?? averageRank(matchups),
    matchups,
  };
}

const SOS_BOARD_TTL_MS = 30 * 60 * 1000;
let sosBoardCache: { at: number; value: Promise<Awaited<ReturnType<typeof fetchResearchSosBoard>> | null> } | null =
  null;

function cachedSosBoard() {
  const now = Date.now();
  if (!sosBoardCache || now - sosBoardCache.at > SOS_BOARD_TTL_MS) {
    sosBoardCache = {
      at: now,
      value: fetchResearchSosBoard().catch(() => null),
    };
  }
  return sosBoardCache.value;
}

/**
 * Prefer the live positional FPA schedule for the player's current team, filling any
 * missing weeks from the brain so no week false-byes as 0 stars.
 * Rebuilds from the CDN/TiDB SOS board — never calls getTeamPosSos (18-week fan-out).
 */
export function usePlayerSos(
  brainEntry: BrainEntry | null,
  team: string | null | undefined,
  _scoringFormat: Scoring = "half",
  position?: string | null,
): PlayerSos | null {
  const brainSos =
    brainEntry?.sos && brainEntry.sos.matchups && brainEntry.sos.matchups.length > 0
      ? brainEntry.sos
      : null;

  const fromBrain = useMemo(() => {
    if (!sosHasUsableRanks(brainSos)) return null;
    return {
      rank: brainSos!.rank ?? averageRank(brainSos!.matchups),
      matchups: brainSos!.matchups.map(normalizeMatchup),
    };
  }, [brainSos]);

  const pos = sosPosKey(position || brainEntry?.position || "");
  const [scheduleSos, setScheduleSos] = useState<PlayerSos | null>(null);

  useEffect(() => {
    let alive = true;
    const upperTeam = (team || "").toUpperCase();
    if (!upperTeam || upperTeam === "FA" || !pos) {
      setScheduleSos(null);
      return () => {
        alive = false;
      };
    }
    (async () => {
      const board = await cachedSosBoard();
      if (!alive) return;
      const built = sosFromBoard(board, upperTeam, pos);
      const next: PlayerSos | null = built
        ? {
            rank: built.rank,
            matchups: built.opponents.map(normalizeMatchup),
          }
        : null;
      setScheduleSos(sosHasUsableRanks(next) ? next : null);
    })().catch(() => {
      if (alive) setScheduleSos(null);
    });
    return () => {
      alive = false;
    };
  }, [team, pos]);

  // The live schedule uses the player's current team; brain rows only fill gaps.
  return useMemo(
    () => mergeSosWeeks(scheduleSos, fromBrain),
    [fromBrain, scheduleSos],
  );
}

type SosPeer = { position: string; sos: PlayerSos | null };

/**
 * Peer schedule matrix for the position-percentile engine.
 * Prefers brain rows that already carry positional FPA ranks.
 */
export function useSosPeerMatrix(
  position: string | null | undefined,
  brain: BrainMatrix | null | undefined,
): Record<string, SosPeer> | null {
  return useMemo(() => {
    if (!brain || !position) return null;
    const want = sosPosKey(position);
    const peers: Record<string, SosPeer> = {};
    let count = 0;
    for (const [id, entry] of Object.entries(brain)) {
      if (sosPosKey(entry.position) !== want) continue;
      if (!sosHasUsableRanks(entry.sos)) continue;
      peers[id] = { position: entry.position, sos: entry.sos };
      count += 1;
    }
    return count >= 5 ? peers : null;
  }, [brain, position]);
}

import { useEffect, useMemo, useState } from "react";

import type { Scoring } from "@/lib/draft";
import type { BrainEntry, BrainMatrix } from "@/lib/playerBrainHydration";
import { getTeamPosSos } from "@/lib/players.functions";
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

function fromDetailOrMatrix(raw: {
  rank: number | null;
  opponents?: SosMatchup[];
  matchups?: SosMatchup[];
} | null | undefined): PlayerSos | null {
  if (!raw) return null;
  const matchups = (raw.matchups ?? raw.opponents ?? []).map(normalizeMatchup);
  if (!matchups.length) return null;
  return {
    rank: raw.rank ?? averageRank(matchups),
    matchups,
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

/**
 * Prefer synchronized brain SOS (positional fantasy points allowed vs opponent).
 * Always merge the positional FPA schedule so weeks the brain omits (historically
 * week 18) still get opponents and ranks — never leave them as 0 stars / BYE.
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

  const pos = (position || brainEntry?.position || "").toUpperCase();
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
    const sosPos = pos === "DST" ? "DEF" : pos;
    (async () => {
      const raw = await getTeamPosSos({ data: { team: upperTeam, pos: sosPos } });
      if (!alive) return;
      const next = fromDetailOrMatrix(
        raw
          ? {
              rank: raw.rank,
              opponents: raw.opponents,
            }
          : null,
      );
      setScheduleSos(sosHasUsableRanks(next) ? next : null);
    })().catch(() => {
      if (alive) setScheduleSos(null);
    });
    return () => {
      alive = false;
    };
  }, [team, pos]);

  return useMemo(
    () => mergeSosWeeks(fromBrain, scheduleSos),
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
    const normalize = (p: string) => {
      const u = (p || "").toUpperCase();
      return u === "DST" ? "DEF" : u;
    };
    const want = normalize(position);
    const peers: Record<string, SosPeer> = {};
    let count = 0;
    for (const [id, entry] of Object.entries(brain)) {
      if (normalize(entry.position) !== want) continue;
      if (!sosHasUsableRanks(entry.sos)) continue;
      peers[id] = { position: entry.position, sos: entry.sos };
      count += 1;
    }
    return count >= 5 ? peers : null;
  }, [brain, position]);
}

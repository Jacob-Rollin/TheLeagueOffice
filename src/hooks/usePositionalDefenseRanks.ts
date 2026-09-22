import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getFantasyPointsAllowed } from "@/lib/players.functions";

const HOUR = 1000 * 60 * 60;

/**
 * Positional defensive ranks for SOS stars (1 = toughest / stingiest).
 * Inverts the Fantasy Points Allowed board (where 1 = easiest / highest PA).
 */
export function usePositionalDefenseRanks() {
  const query = useQuery({
    queryKey: ["fantasy-points-allowed", "sos-defense-ranks", "v2-incl-def"],
    staleTime: 6 * HOUR,
    retry: false,
    queryFn: () => getFantasyPointsAllowed({ data: {} }),
  });

  const ranksByPos = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    const rows = query.data?.rows ?? [];
    for (const row of rows) {
      const team = (row.team || "").toUpperCase();
      if (!team) continue;
      for (const [pos, cell] of Object.entries(row.cells ?? {})) {
        const easyRank = Number(cell?.rank);
        if (!Number.isFinite(easyRank) || easyRank <= 0) continue;
        // Invert: PA board rank 1 (easiest) → SOS rank 32 (softest).
        const n = rows.length || 32;
        const toughRank = Math.max(1, Math.min(n, n - Math.round(easyRank) + 1));
        const byTeam = out.get(pos) ?? new Map<string, number>();
        byTeam.set(team, toughRank);
        out.set(pos, byTeam);
      }
    }
    return out;
  }, [query.data]);

  const rankFor = (pos: string | null | undefined, opp: string | null | undefined): number | null => {
    const raw = (pos || "").toUpperCase();
    const p = raw === "DST" ? "DEF" : raw;
    const o = (opp || "").replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase();
    if (!p || !o) return null;
    return ranksByPos.get(p)?.get(o) ?? null;
  };

  return { rankFor, loading: query.isLoading };
}

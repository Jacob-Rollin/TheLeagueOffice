import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchResearchFpa } from "@/lib/research-cdn";

const HOUR = 1000 * 60 * 60;

function normalizePos(pos: string | null | undefined): string {
  const raw = (pos || "").toUpperCase();
  return raw === "DST" ? "DEF" : raw;
}

function normalizeOpp(opp: string | null | undefined): string {
  return (opp || "").replace(/^(vs\.?|@)\s*/i, "").trim().toUpperCase();
}

/**
 * Positional defensive ranks for SOS stars (1 = toughest / stingiest).
 * Inverts the Fantasy Points Allowed board (where 1 = easiest / highest PA).
 * Prefers CDN /api/data/research/fpa (no Fluid fan-out when warm).
 */
export function usePositionalDefenseRanks() {
  const query = useQuery({
    queryKey: ["fantasy-points-allowed", "sos-defense-ranks", "v2-incl-def"],
    staleTime: 6 * HOUR,
    retry: false,
    queryFn: () => fetchResearchFpa("half"),
  });

  const { ranksByPos, avgByPos } = useMemo(() => {
    const ranks = new Map<string, Map<string, number>>();
    const avgs = new Map<string, Map<string, number>>();
    const rows = query.data?.rows ?? [];
    for (const row of rows) {
      const team = (row.team || "").toUpperCase();
      if (!team) continue;
      for (const [pos, cell] of Object.entries(row.cells ?? {})) {
        const easyRank = Number(cell?.rank);
        if (Number.isFinite(easyRank) && easyRank > 0) {
          // Invert: PA board rank 1 (easiest) → SOS rank 32 (softest).
          const n = rows.length || 32;
          const toughRank = Math.max(1, Math.min(n, n - Math.round(easyRank) + 1));
          const byTeam = ranks.get(pos) ?? new Map<string, number>();
          byTeam.set(team, toughRank);
          ranks.set(pos, byTeam);
        }
        const pa = Number(cell?.pa);
        if (Number.isFinite(pa)) {
          const byTeam = avgs.get(pos) ?? new Map<string, number>();
          byTeam.set(team, pa);
          avgs.set(pos, byTeam);
        }
      }
    }
    return { ranksByPos: ranks, avgByPos: avgs };
  }, [query.data]);

  const rankFor = (pos: string | null | undefined, opp: string | null | undefined): number | null => {
    const p = normalizePos(pos);
    const o = normalizeOpp(opp);
    if (!p || !o) return null;
    return ranksByPos.get(p)?.get(o) ?? null;
  };

  /** Season avg fantasy points this defense allows to `pos` (FPA board). */
  const avgAllowedFor = (
    pos: string | null | undefined,
    opp: string | null | undefined,
  ): number | null => {
    const p = normalizePos(pos);
    const o = normalizeOpp(opp);
    if (!p || !o) return null;
    return avgByPos.get(p)?.get(o) ?? null;
  };

  return { rankFor, avgAllowedFor, loading: query.isLoading };
}

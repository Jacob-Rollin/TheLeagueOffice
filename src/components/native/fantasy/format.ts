import type { NflGameProgress } from "@/lib/rolling-live-projection";

/** Past weeks / final boards always show actuals. */
export function playerGameStarted(
  phase: NflGameProgress["phase"] | undefined,
  opts?: { showActuals?: boolean; bye?: boolean },
): boolean {
  if (opts?.bye) return false;
  if (opts?.showActuals) return true;
  return phase === "in" || phase === "post";
}

/**
 * Actual fantasy points for display.
 * Before kickoff → null (renders as "-"). After start, missing → 0.
 */
export function displayPlayerPoints(
  raw: number | null | undefined,
  phase: NflGameProgress["phase"] | undefined,
  opts?: { showActuals?: boolean; bye?: boolean },
): number | null {
  if (!playerGameStarted(phase, opts)) return null;
  if (raw == null || !Number.isFinite(raw)) return 0;
  return raw;
}

/** Fantasy points / season totals — always 2 decimals, or "-". */
export function formatFantasyPts(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

/** Weekly projections — always 2 decimals, or "-". */
export function formatFantasyProj(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

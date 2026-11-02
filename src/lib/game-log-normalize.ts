/** Ensure FUM is never blank when LOST is present (lost ⊆ total fumbles). */
export function normalizeFumbleRaw(rawStats: Record<string, number>): Record<string, number> {
  const out = { ...rawStats };
  const lost = out["fum_lost"];
  if (lost == null || !Number.isFinite(lost) || lost <= 0) return out;
  const fum = out["fum"];
  if (fum == null || !Number.isFinite(fum) || fum < lost) {
    out["fum"] = lost;
  }
  return out;
}

/**
 * Fill derived kicker fields so scoring + UI columns match Sleeper.
 * - Derive `fgm` / `fgmiss` from each other when one side is missing
 * - Collapse `fgm_50_59` + `fgm_60p` into display `fgm_50p` when needed
 *
 * Distance makes (`fgm_20_29`, …) must already be present on the bag for
 * league distance scoring to work — this only fills aliases / aggregates.
 */
export function normalizeKickerRaw(raw: Record<string, number>): Record<string, number> {
  const out = { ...raw };
  const fga = out["fga"];
  const fgmiss = out["fgmiss"];
  if (out["fgm"] == null && fga != null && Number.isFinite(fga)) {
    const miss = fgmiss != null && Number.isFinite(fgmiss) ? fgmiss : 0;
    out["fgm"] = Math.max(0, fga - miss);
  }
  if (out["fgmiss"] == null && fga != null && out["fgm"] != null) {
    out["fgmiss"] = Math.max(0, fga - out["fgm"]);
  }
  // Collapse 50+ aliases for the display column (keep 50_59 / 60p for scoring).
  if (out["fgm_50p"] == null) {
    const from59 = out["fgm_50_59"];
    const from60 = out["fgm_60p"];
    if (from59 != null || from60 != null) {
      out["fgm_50p"] = (from59 ?? 0) + (from60 ?? 0);
    }
  }
  return out;
}

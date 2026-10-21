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

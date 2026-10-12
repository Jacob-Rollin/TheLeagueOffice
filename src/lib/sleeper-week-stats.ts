/**
 * Parse Sleeper `/stats/nfl/{season}/{week}` payloads.
 *
 * Sleeper usually returns a flat dict: `{ [playerId]: { pass_yd, … } }`.
 * Some callers / older shapes use arrays or nested `{ stats: { … } }` —
 * accept all three so live scoring never silently empties.
 */

function coerceStatLine(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const nested = record.stats;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "stats" || k === "player_id" || k === "player" || k === "team" || k === "opponent") {
      continue;
    }
    const n = Number(v);
    if (Number.isFinite(n)) stats[k] = n;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

/** player_id → numeric stat line (empty players omitted). */
export function parseSleeperWeekStatRows(
  rows: unknown,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!rows) return out;

  if (Array.isArray(rows)) {
    for (const row of rows as { player_id?: string; stats?: unknown }[]) {
      const id = String(row?.player_id ?? "").trim();
      if (!id) continue;
      const stats = coerceStatLine(row);
      if (stats) out[id] = stats;
    }
    return out;
  }

  if (typeof rows === "object") {
    for (const [id, row] of Object.entries(rows as Record<string, unknown>)) {
      const clean = String(id ?? "").trim();
      if (!clean) continue;
      const stats = coerceStatLine(row);
      if (stats) out[clean] = stats;
    }
  }
  return out;
}

/** Map form used by `useWeeklyActualStats` / pickup helpers. */
export function parseSleeperWeekStatMap(
  rows: unknown,
): Map<string, Record<string, number>> {
  return new Map(Object.entries(parseSleeperWeekStatRows(rows)));
}

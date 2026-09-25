/**
 * Competition ranks for Research boards.
 * Equal metrics share a rank; the next distinct value skips ahead (1, 2, 2, 4).
 * Higher metric values rank better (1 = leader) unless `higherIsBetter` is false.
 */
export function competitionRanksByMetric<T>(
  rows: T[],
  metricOf: (row: T) => number | null | undefined,
  idOf: (row: T) => string,
  higherIsBetter = true,
): Map<string, number> {
  const scored: { id: string; metric: number }[] = [];
  for (const row of rows) {
    const raw = metricOf(row);
    if (raw == null || !Number.isFinite(raw)) continue;
    scored.push({ id: idOf(row), metric: raw });
  }
  scored.sort((a, b) => {
    const delta = higherIsBetter ? b.metric - a.metric : a.metric - b.metric;
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });

  const ranks = new Map<string, number>();
  let i = 0;
  while (i < scored.length) {
    const start = i;
    const value = scored[i]!.metric;
    while (i < scored.length && scored[i]!.metric === value) i += 1;
    const rank = start + 1;
    for (let j = start; j < i; j += 1) ranks.set(scored[j]!.id, rank);
  }
  return ranks;
}

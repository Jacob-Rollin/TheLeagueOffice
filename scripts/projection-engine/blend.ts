import { PUBLISHED, WEIGHTS } from "./config";
import type { Pos, SourceKey, Stats } from "./types";

/** Stat keys each source actually models at each position, seen across this run. */
export type Vocabulary = Map<string, Set<string>>;

export function buildVocabulary(
  bySource: Partial<Record<SourceKey, Map<string, Stats>>>,
  posOf: (id: string) => Pos | undefined,
): Vocabulary {
  const vocab: Vocabulary = new Map();
  for (const [source, lines] of Object.entries(bySource) as [SourceKey, Map<string, Stats>][]) {
    for (const [id, line] of lines) {
      const pos = posOf(id);
      if (!pos) continue;
      const key = `${source}|${pos}`;
      const set = vocab.get(key) ?? new Set<string>();
      for (const k of Object.keys(line)) set.add(k);
      vocab.set(key, set);
    }
  }
  return vocab;
}

/**
 * Weighted blend at the stat level. Weights are re-split over the sources
 * that have this player, and per stat over the sources that model that stat
 * at this position (CBS has no QB targets, for example) — a source that
 * models a stat but omits it for a player counts as zero.
 */
export function blendLine(
  pos: Pos,
  lines: Partial<Record<SourceKey, Stats>>,
  vocab: Vocabulary,
): { stats: Stats; used: SourceKey[] } | null {
  const weights = WEIGHTS[pos];
  const used = (Object.keys(weights) as SourceKey[]).filter((s) => lines[s]);
  if (!used.some((s) => PUBLISHED.includes(s))) return null;
  const keys = new Set(used.flatMap((s) => Object.keys(lines[s]!)));
  const stats: Stats = {};
  for (const key of keys) {
    let total = 0;
    let weightSum = 0;
    for (const s of used) {
      if (!vocab.get(`${s}|${pos}`)?.has(key)) continue;
      const w = weights[s] ?? 0;
      total += w * (lines[s]![key] ?? 0);
      weightSum += w;
    }
    if (weightSum > 0) stats[key] = Math.round((total / weightSum) * 1000) / 1000;
  }
  return { stats, used };
}

import { createServerFn } from "@tanstack/react-start";

import type { MatchupReplayRequest } from "./matchup-replay";
import type { ScoringMap } from "./scoring-map";

function sanitizeStarters(
  raw: MatchupReplayRequest["left"]["starters"] | undefined,
): MatchupReplayRequest["left"]["starters"] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((s) => ({
    id: String(s?.id ?? "").slice(0, 32),
    name: String(s?.name ?? "").slice(0, 80),
    pos: String(s?.pos ?? "").slice(0, 8),
    team: String(s?.team ?? "").slice(0, 8),
    projection: Math.max(0, Number(s?.projection) || 0),
  }));
}

function sanitizeSide(
  raw: MatchupReplayRequest["left"] | undefined,
): MatchupReplayRequest["left"] {
  return {
    name: String(raw?.name ?? "Team").slice(0, 80),
    record: raw?.record != null ? String(raw.record).slice(0, 16) : null,
    logo: raw?.logo != null ? String(raw.logo).slice(0, 500) : null,
    finalScore: Math.max(0, Number(raw?.finalScore) || 0),
    projectedScore: Math.max(0, Number(raw?.projectedScore) || 0),
    starters: sanitizeStarters(raw?.starters),
  };
}

export const getMatchupReplay = createServerFn({ method: "POST" })
  .inputValidator((input: MatchupReplayRequest) => {
    const scoringMap: ScoringMap = {};
    if (input?.scoringMap && typeof input.scoringMap === "object") {
      for (const [key, value] of Object.entries(input.scoringMap)) {
        const k = String(key).slice(0, 32);
        const n = Number(value);
        if (k && Number.isFinite(n)) scoringMap[k] = n;
      }
    }
    return {
      season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
      week: Math.max(1, Math.min(22, Math.floor(Number(input?.week) || 1))),
      scoringMap,
      left: sanitizeSide(input?.left),
      right: sanitizeSide(input?.right),
    };
  })
  .handler(async ({ data }) => {
    const { loadMatchupReplay } = await import("./matchup-replay.server");
    return await loadMatchupReplay(data as MatchupReplayRequest);
  });

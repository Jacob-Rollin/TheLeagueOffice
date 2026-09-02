import {
  ESPN_STAT_MAP,
  defaultScoringMap,
  type ScoringFormat,
  type ScoringMap,
} from "./scoring-map";

const SLEEPER = "https://api.sleeper.app/v1";

async function json<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type LeagueScoring = {
  format: ScoringFormat;
  map: ScoringMap;
  source: "sleeper" | "espn" | "yahoo" | "default";
};

function formatFromRec(rec: number): ScoringFormat {
  return rec >= 1 ? "ppr" : rec > 0 ? "half" : "std";
}

/**
 * Resolve the host league's real scoring rules, normalized onto Sleeper's
 * stat vocabulary so weekly raw projections can be scored league-exactly.
 */
export async function loadLeagueScoring(
  identifier: string,
  platform = "sleeper",
  s2?: string | null,
  swid?: string | null,
): Promise<LeagueScoring> {
  if (platform === "sleeper") {
    const league = await json<{ scoring_settings?: Record<string, unknown> }>(
      `${SLEEPER}/league/${encodeURIComponent(identifier)}`,
    );
    const raw = league?.scoring_settings;
    if (raw && typeof raw === "object") {
      const map: ScoringMap = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n)) map[k] = n;
      }
      const format = formatFromRec(Number(map["rec"] ?? 0));
      return { format, map: { ...defaultScoringMap(format), ...map }, source: "sleeper" };
    }
  }

  if (platform === "espn") {
    const season = new Date().getUTCFullYear();
    const headers: Record<string, string> = { accept: "application/json" };
    if (s2 && swid) headers["cookie"] = `espn_s2=${s2}; SWID=${swid}`;
    const view = await json<{
      settings?: { scoringSettings?: { scoringItems?: { statId?: number; points?: number }[] } };
    }>(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${encodeURIComponent(identifier)}?view=mSettings`,
      { headers },
    );
    const items = view?.settings?.scoringSettings?.scoringItems ?? [];
    if (items.length) {
      const map: ScoringMap = {};
      for (const item of items) {
        const key = ESPN_STAT_MAP[Number(item?.statId)];
        const pts = Number(item?.points);
        if (key && Number.isFinite(pts)) map[key] = pts;
      }
      const format = formatFromRec(Number(map["rec"] ?? 0));
      return { format, map: { ...defaultScoringMap(format), ...map }, source: "espn" };
    }
  }

  // Yahoo (and any silent host) falls back to the standard half-PPR baseline.
  const format: ScoringFormat = "half";
  return { format, map: defaultScoringMap(format), source: "default" };
}

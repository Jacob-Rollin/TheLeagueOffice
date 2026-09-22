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
  /** Resolved Sleeper/ESPN league id when the input was a username or user id. */
  resolvedId?: string;
};

function formatFromRec(rec: number): ScoringFormat {
  return rec >= 1 ? "ppr" : rec > 0 ? "half" : "std";
}

/**
 * Synced connections may store a Sleeper league id, user id, or username.
 * `/league/{username}` 404s — without resolution we silently fall back to
 * default half-PPR and QB projections drift (e.g. pass_int -1 vs league -2).
 */
async function resolveSleeperLeagueId(identifier: string): Promise<string | null> {
  const clean = identifier.trim().replace(/^@/, "");
  if (!clean) return null;

  const season = new Date().getUTCFullYear();

  if (/^\d{6,}$/.test(clean)) {
    const direct = await json<{ league_id?: string }>(
      `${SLEEPER}/league/${encodeURIComponent(clean)}`,
    );
    if (direct?.league_id) return clean;
    const byUser = await json<{ league_id: string }[]>(
      `${SLEEPER}/user/${encodeURIComponent(clean)}/leagues/nfl/${season}`,
    );
    if (byUser?.[0]?.league_id) return byUser[0].league_id;
    const byUserPrev = await json<{ league_id: string }[]>(
      `${SLEEPER}/user/${encodeURIComponent(clean)}/leagues/nfl/${season - 1}`,
    );
    return byUserPrev?.[0]?.league_id ?? null;
  }

  const user = await json<{ user_id?: string }>(
    `${SLEEPER}/user/${encodeURIComponent(clean)}`,
  );
  const userId = user?.user_id;
  if (!userId) return null;
  for (const year of [season, season - 1]) {
    const leagues = await json<{ league_id: string }[]>(
      `${SLEEPER}/user/${encodeURIComponent(userId)}/leagues/nfl/${year}`,
    );
    if (leagues?.[0]?.league_id) return leagues[0].league_id;
  }
  return null;
}

/**
 * Sleeper often omits 2-pt conversion (and other BASE) keys from
 * `scoring_settings` when they still use the platform default. The matchup /
 * player UI still multiplies those projection stats — without this fill, QB
 * PROJ drifts by ~0.2 (e.g. Stroud 14.77 vs Sleeper 14.97).
 */
const SLEEPER_DEFAULT_FILL_KEYS = [
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_2pt",
  "rush_yd",
  "rush_td",
  "rush_2pt",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_2pt",
  "fum_lost",
] as const;

function mapFromSleeperSettings(
  raw: Record<string, unknown>,
  resolvedId?: string,
): LeagueScoring {
  const map: ScoringMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n)) map[k] = n;
  }
  const format = formatFromRec(Number(map["rec"] ?? 0));
  const baseline = defaultScoringMap(format);
  for (const key of SLEEPER_DEFAULT_FILL_KEYS) {
    if (map[key] == null && baseline[key] != null) map[key] = baseline[key]!;
  }
  return { format, map, source: "sleeper", ...(resolvedId ? { resolvedId } : {}) };
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
    const clean = identifier.trim().replace(/^@/, "");

    // Fast path: identifier is already a league id.
    const direct = await json<{
      league_id?: string;
      scoring_settings?: Record<string, unknown>;
    }>(`${SLEEPER}/league/${encodeURIComponent(clean)}`);
    if (direct?.scoring_settings && typeof direct.scoring_settings === "object") {
      return mapFromSleeperSettings(direct.scoring_settings, clean);
    }

    // Username / user id → first league for the season.
    const leagueId = await resolveSleeperLeagueId(clean);
    if (leagueId && leagueId !== clean) {
      const league = await json<{ scoring_settings?: Record<string, unknown> }>(
        `${SLEEPER}/league/${encodeURIComponent(leagueId)}`,
      );
      const raw = league?.scoring_settings;
      if (raw && typeof raw === "object") {
        return mapFromSleeperSettings(raw, leagueId);
      }
    }
  }

  if (platform === "espn") {
    const season = new Date().getUTCFullYear();
    const headers: Record<string, string> = { accept: "application/json" };
    if (s2 && swid) headers["cookie"] = `espn_s2=${s2}; SWID=${swid}`;
    const view = await json<{
      settings?: {
        scoringSettings?: { scoringItems?: { statId?: number; points?: number }[] };
      };
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
      // ESPN settings are sparse — fill missing core offense only (never flat
      // fgm when distance buckets may also be present).
      const baseline = defaultScoringMap(format);
      for (const key of [
        "pass_yd",
        "pass_td",
        "pass_int",
        "pass_2pt",
        "rush_yd",
        "rush_td",
        "rush_2pt",
        "rec",
        "rec_yd",
        "rec_td",
        "rec_2pt",
        "fum_lost",
      ] as const) {
        if (map[key] == null && baseline[key] != null) map[key] = baseline[key]!;
      }
      return { format, map, source: "espn" };
    }
  }

  // Yahoo (and any silent host) falls back to the standard half-PPR baseline.
  const format: ScoringFormat = "half";
  return { format, map: defaultScoringMap(format), source: "default" };
}

/**
 * Browser Sleeper scoring loader — public league settings, IndexedDB cached.
 * ESPN/Yahoo stay on Fluid (credentials).
 */

import {
  espnFluidCacheKey,
  espnFluidMemo,
  ESPN_FLUID_SETTINGS_TTL_MS,
} from "@/lib/espn-fluid-cache";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";
import {
  defaultScoringMap,
  type ScoringFormat,
  type ScoringMap,
} from "@/lib/scoring-map";
import type { LeagueScoring } from "@/lib/scoring.server";

const SLEEPER = "https://api.sleeper.app/v1";
const DAY = 24 * 60 * 60 * 1000;

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

function formatFromRec(rec: number): ScoringFormat {
  return rec >= 1 ? "ppr" : rec > 0 ? "half" : "std";
}

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

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

/** Public Sleeper league scoring for a known league id. */
export async function fetchSleeperLeagueScoringClient(
  leagueId: string,
): Promise<LeagueScoring | null> {
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return null;

  try {
    return await getCached(`sleeper-scoring-v2:${clean}`, DAY, async () => {
      const league = await sleeperJson<{
        league_id?: string;
        scoring_settings?: Record<string, unknown>;
      }>(`${SLEEPER}/league/${encodeURIComponent(clean)}`);
      const raw = league?.scoring_settings;
      // Throw so we do not IndexedDB-cache a half-PPR default for a day.
      if (!raw || typeof raw !== "object") throw new Error("scoring_settings missing");
      return mapFromSleeperSettings(raw, clean);
    });
  } catch {
    return null;
  }
}

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export async function fetchLeagueScoringPreferred(input: {
  identifier: string;
  platform: string;
  s2?: string | null | undefined;
  swid?: string | null | undefined;
}): Promise<LeagueScoring> {
  const platform = String(input.platform ?? "sleeper").trim().toLowerCase();
  if (platform === "sleeper") {
    let leagueId = String(input.identifier ?? "").trim();
    {
      const { ensureSleeperNumericLeagueId } = await import("@/lib/sleeper-resolve-client");
      leagueId = (await ensureSleeperNumericLeagueId(leagueId).catch(() => null)) ?? leagueId;
    }
    const client = await fetchSleeperLeagueScoringClient(leagueId).catch(() => null);
    if (client?.source === "sleeper" && client.map && Object.keys(client.map).length > 0) {
      return client;
    }
    // Production: soft-empty half-PPR rather than Fluid for public Sleeper scoring.
    if (!allowFluidFallback()) {
      return client ?? { format: "half", map: defaultScoringMap("half"), source: "default" };
    }
  }
  const identifier = String(input.identifier ?? "").trim();
  const fluidKey = espnFluidCacheKey("scoring", identifier, platform);
  const { getLeagueScoring } = await import("@/lib/scoring.functions");
  return espnFluidMemo(fluidKey, ESPN_FLUID_SETTINGS_TTL_MS, () =>
    getLeagueScoring({
      data: {
        identifier,
        platform,
        ...(input.s2 ? { s2: input.s2 } : {}),
        ...(input.swid ? { swid: input.swid } : {}),
      },
    }),
  );
}

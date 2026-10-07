/**
 * Browser resolve for Sleeper username / numeric user id → host league id.
 * Keeps synced_leagues.league_id numeric so canFetch*Client gates stay on
 * the free browse path (no Fluid username fallthrough).
 */

import { getCached } from "@/lib/sleeper-cache";

const SLEEPER = "https://api.sleeper.app/v1";
const RESOLVE_TTL_MS = 30 * 60 * 1000;

export type SleeperLeagueResolve = {
  leagueId: string;
  userId: string | null;
  username: string | null;
};

async function sleeperJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      const retry = await fetch(url, { headers: { accept: "application/json" } });
      if (!retry.ok) return null;
      return (await retry.json()) as T;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function firstLeagueForUser(userKey: string): Promise<string | null> {
  const year = new Date().getFullYear();
  for (const season of [year, year - 1]) {
    const leagues = await sleeperJson<{ league_id: string }[]>(
      `${SLEEPER}/user/${encodeURIComponent(userKey)}/leagues/nfl/${season}`,
    );
    const id = leagues?.[0]?.league_id?.trim();
    if (id && /^\d{6,}$/.test(id)) return id;
  }
  return null;
}

/** Resolve username, numeric user id, or numeric league id → host league id. */
export async function resolveSleeperLeagueIdClient(
  identifier: string,
): Promise<SleeperLeagueResolve | null> {
  const clean = String(identifier ?? "")
    .trim()
    .replace(/^@/, "");
  if (!clean) return null;

  try {
    if (/^\d{6,}$/.test(clean)) {
      return await getCached(`sleeper-resolve-v1:${clean}`, RESOLVE_TTL_MS, async () => {
        const direct = await sleeperJson<{ league_id?: string }>(`${SLEEPER}/league/${clean}`);
        if (direct?.league_id) {
          return { leagueId: clean, userId: null, username: null };
        }
        const leagueId = await firstLeagueForUser(clean);
        // Throw so we do not IndexedDB-cache a miss for 30 minutes.
        if (!leagueId) throw new Error("sleeper league unresolved");
        return { leagueId, userId: clean, username: null };
      });
    }

    return await getCached(`sleeper-resolve-v1:u:${clean.toLowerCase()}`, RESOLVE_TTL_MS, async () => {
      const user = await sleeperJson<{ user_id?: string }>(
        `${SLEEPER}/user/${encodeURIComponent(clean)}`,
      );
      if (!user?.user_id) throw new Error("sleeper user not found");
      const leagueId = await firstLeagueForUser(user.user_id);
      if (!leagueId) throw new Error("sleeper league unresolved");
      return { leagueId, userId: user.user_id, username: clean };
    });
  } catch {
    return null;
  }
}

/** Numeric host league id, or null when the identifier cannot be resolved. */
export async function ensureSleeperNumericLeagueId(identifier: string): Promise<string | null> {
  const clean = String(identifier ?? "").trim();
  if (/^\d{6,}$/.test(clean)) return clean;
  const hit = await resolveSleeperLeagueIdClient(clean).catch(() => null);
  return hit?.leagueId ?? null;
}

/**
 * Persist a healed numeric league_id for legacy username rows.
 * Best-effort — RLS / network failures must not break browse.
 */
export async function persistResolvedSleeperLeagueId(
  connectionId: string,
  leagueId: string,
  extraMeta?: Record<string, unknown>,
): Promise<void> {
  if (!connectionId || !/^\d{6,}$/.test(leagueId)) return;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: row } = await supabase
      .from("synced_leagues")
      .select("league_id, metadata")
      .eq("id", connectionId)
      .maybeSingle();
    if (!row || /^\d{6,}$/.test(String(row.league_id ?? "").trim())) return;
    const prev = (row.metadata as Record<string, unknown> | null) ?? {};
    const metadata = {
      ...prev,
      ...extraMeta,
      sleeper_username: String(row.league_id ?? prev["label"] ?? "").trim() || undefined,
    };
    await supabase
      .from("synced_leagues")
      .update({ league_id: leagueId, metadata })
      .eq("id", connectionId);
  } catch {
    /* ignore heal failures */
  }
}

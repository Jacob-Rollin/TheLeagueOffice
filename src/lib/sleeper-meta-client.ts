/**
 * Browser → Sleeper public connection meta (league name, team, avatar).
 * Prefer over Fluid getConnectionMeta so ActiveLeagueContext does not burn
 * Active CPU once per connected league on every session.
 */

import type { ConnectionMeta } from "@/lib/league.server";
import { getCached } from "@/lib/sleeper-cache";

const SLEEPER = "https://api.sleeper.app/v1";
const META_TTL_MS = 30 * 60 * 1000;

type CachedMeta = {
  leagueName: string | null;
  avatar: string | null;
  scoring: string | null;
  teams: number | null;
  hostLeagueId: string;
  users: {
    user_id: string;
    display_name: string;
    avatar: string | null;
    team_name: string | null;
    meta_avatar: string | null;
  }[];
};

function sleeperAvatar(id: string | null | undefined): string | null {
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
}

function scoringLabel(settings: Record<string, unknown> | null | undefined): string {
  const rec = Number(settings?.["rec"] ?? 0);
  if (rec >= 1) return "Full PPR";
  if (rec > 0) return "Half PPR";
  return "Standard";
}

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

const emptyMeta = (): ConnectionMeta => ({
  leagueName: null,
  teamName: null,
  avatar: null,
  scoring: null,
  teams: null,
  hostLeagueId: null,
});

export function canFetchMetaClient(platform: string, leagueId: string): boolean {
  return (
    String(platform ?? "")
      .trim()
      .toLowerCase() === "sleeper" && /^\d{6,}$/.test(String(leagueId ?? "").trim())
  );
}

function stampMine(board: CachedMeta, teamNameHint?: string | null): ConnectionMeta {
  const hint = (teamNameHint ?? "").trim().toLowerCase();
  const me =
    (hint &&
      (board.users.find((u) => {
        const team = (u.team_name ?? "").toLowerCase();
        const owner = (u.display_name ?? "").toLowerCase();
        return (team && team === hint) || (owner && owner === hint);
      }) ??
        board.users.find((u) => {
          const team = (u.team_name ?? "").toLowerCase();
          const owner = (u.display_name ?? "").toLowerCase();
          return (
            (team && (team.includes(hint) || hint.includes(team))) ||
            (owner && (owner.includes(hint) || hint.includes(owner)))
          );
        }))) ||
    null;

  if (!me) {
    return {
      leagueName: board.leagueName,
      teamName: null,
      avatar: board.avatar,
      scoring: board.scoring,
      teams: board.teams,
      hostLeagueId: board.hostLeagueId,
    };
  }

  const metaAvatar = me.meta_avatar?.trim() || null;
  return {
    leagueName: board.leagueName,
    teamName: me.team_name?.trim() || me.display_name || null,
    avatar:
      (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
      sleeperAvatar(me.avatar) ||
      board.avatar,
    scoring: board.scoring,
    teams: board.teams,
    hostLeagueId: board.hostLeagueId,
  };
}

/** Public Sleeper meta for a known numeric league id. */
export async function fetchSleeperMetaClient(
  leagueId: string,
  teamNameHint?: string | null,
): Promise<ConnectionMeta> {
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return emptyMeta();

  const board = await getCached<CachedMeta | { empty: true }>(
    `sleeper-meta-v1:${clean}`,
    META_TTL_MS,
    async () => {
      const [league, users] = await Promise.all([
        sleeperJson<{
          name?: string;
          avatar?: string | null;
          total_rosters?: number;
          scoring_settings?: Record<string, unknown>;
        }>(`${SLEEPER}/league/${clean}`),
        sleeperJson<
          {
            user_id: string;
            display_name: string;
            avatar: string | null;
            metadata?: { team_name?: string; avatar?: string };
          }[]
        >(`${SLEEPER}/league/${clean}/users`),
      ]);
      if (!league) return { empty: true as const };
      return {
        leagueName: league.name ?? null,
        avatar: sleeperAvatar(league.avatar),
        scoring: scoringLabel(league.scoring_settings),
        teams: league.total_rosters ?? null,
        hostLeagueId: clean,
        users: (users ?? []).map((u) => ({
          user_id: u.user_id,
          display_name: u.display_name,
          avatar: u.avatar,
          team_name: u.metadata?.team_name?.trim() || null,
          meta_avatar: u.metadata?.avatar?.trim() || null,
        })),
      };
    },
  );

  if ("empty" in board) return { ...emptyMeta(), hostLeagueId: clean };
  return stampMine(board, teamNameHint);
}

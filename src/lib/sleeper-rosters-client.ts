/**
 * Browser → Sleeper public league roster board.
 * Prefer this over Fluid getConnectionRosters for Sleeper so each visitor
 * uses their own rate-limit pool and Vercel stays idle.
 */

import type { LeagueRosters, LeagueRosterTeam } from "@/lib/league.server";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";

const SLEEPER = "https://api.sleeper.app/v1";

function sleeperAvatar(id: string | null | undefined): string | null {
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
}

function normalizeSlotToken(raw: string): string {
  const t = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z+/]/g, "");
  if (t === "QB") return "QB";
  if (t === "RB") return "RB";
  if (t === "WR") return "WR";
  if (t === "TE") return "TE";
  if (t === "K" || t === "PK") return "K";
  if (t === "DEF" || t === "DST" || t === "D/ST") return "DEF";
  if (t === "FLEX" || t === "WRRBTE" || t === "W/R/T" || t === "RB/WR/TE") return "FLEX";
  if (t === "SUPERFLEX" || t === "QBRBWRTE" || t === "OP") return "FLEX";
  if (t === "BN" || t === "BENCH") return "BN";
  if (t === "IR" || t === "IL" || t === "RESERVE") return "IR";
  if (t === "TAXI") return "TAXI";
  return t;
}

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

type CachedBoard = {
  teams: Omit<LeagueRosterTeam, "isMine">[];
  rosterPositions: string[];
};

function stampMine(board: CachedBoard, myTeamName?: string | null): LeagueRosters {
  const mineHint = (myTeamName ?? "").trim().toLowerCase();
  const teams: LeagueRosterTeam[] = board.teams.map((t) => ({
    ...t,
    isMine: Boolean(
      mineHint &&
        (t.team.toLowerCase() === mineHint ||
          t.owner.toLowerCase() === mineHint),
    ),
  }));
  if (mineHint && !teams.some((t) => t.isMine)) {
    const hit = teams.find(
      (t) => t.team.toLowerCase().includes(mineHint) || mineHint.includes(t.team.toLowerCase()),
    );
    if (hit) hit.isMine = true;
  }
  return {
    myTeamName: teams.find((t) => t.isMine)?.team ?? null,
    teams,
    rosterPositions: board.rosterPositions,
  };
}

/**
 * Public Sleeper league rosters for a known league id.
 * `myTeamName` (from connection meta) marks isMine when present.
 */
export async function fetchSleeperLeagueRostersClient(
  leagueId: string,
  myTeamName?: string | null,
): Promise<LeagueRosters | null> {
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return null;

  const board = await getCached<CachedBoard | { empty: true }>(
    `sleeper-rosters-v1:${clean}`,
    5 * 60 * 1000,
    async () => {
      const [rosters, users, league] = await Promise.all([
        sleeperJson<
          {
            roster_id: number;
            owner_id: string | null;
            players?: string[] | null;
            starters?: string[] | null;
            reserve?: string[] | null;
          }[]
        >(`${SLEEPER}/league/${clean}/rosters`),
        sleeperJson<
          {
            user_id: string;
            display_name: string;
            avatar?: string | null;
            metadata?: { team_name?: string; avatar?: string };
          }[]
        >(`${SLEEPER}/league/${clean}/users`),
        sleeperJson<{ roster_positions?: string[] }>(`${SLEEPER}/league/${clean}`),
      ]);
      if (!rosters?.length) return { empty: true as const };

      const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
      const ordered = [...rosters].sort((a, b) => a.roster_id - b.roster_id);
      const teams: Omit<LeagueRosterTeam, "isMine">[] = ordered.map((r, i) => {
        const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
        const reserve = (r.reserve ?? []).map((p) => String(p));
        const metaAvatar = u?.metadata?.avatar?.trim() || null;
        const logo =
          (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
          sleeperAvatar(u?.avatar) ||
          null;
        return {
          slot: r.roster_id ?? i + 1,
          team: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${i + 1}`,
          owner: u?.display_name ?? "",
          logo,
          playerIds: (r.players ?? []).map((p) => String(p)),
          playerNames: [],
          starterIds: (r.starters ?? []).map((p) => String(p)),
          starterNames: [],
          irIds: reserve,
          irNames: [],
        };
      });

      const rosterPositions = (league?.roster_positions ?? [])
        .map((p) => normalizeSlotToken(String(p)))
        .filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI");

      return { teams, rosterPositions };
    },
  );

  if ("empty" in board) return null;
  return stampMine(board, myTeamName);
}

/** True when this connection can load rosters without Fluid credentials. */
export function canFetchRostersClient(platform: string): boolean {
  return (
    String(platform ?? "")
      .trim()
      .toLowerCase() === "sleeper"
  );
}

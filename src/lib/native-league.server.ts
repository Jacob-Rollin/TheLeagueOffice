/**
 * Server-only TiDB helpers for native leagues (reads + admin list).
 */
import {
  NATIVE_LEAGUE_TABLE_NAMES,
} from "@/lib/native-league-ddl.server";
import { tidbConfigured, tidbExecute } from "@/lib/tidb";

export type NativeLeagueRow = {
  id: string;
  season_year: number;
  name: string;
  invite_code: string;
  commissioner_user_id: string;
  status: string;
  league_type: string;
  team_count: number;
  current_week: number;
  scoring_preset: string;
  draft_mode: string;
  draft_status: string;
  settings_version: number;
  created_at: string;
  updated_at: string | null;
};

export async function tidbNativeLeagueStatus(): Promise<{
  configured: boolean;
  tablesReady: boolean;
  missingTables: string[];
  leagueCount: number;
}> {
  if (!tidbConfigured()) {
    return { configured: false, tablesReady: false, missingTables: [...NATIVE_LEAGUE_TABLE_NAMES], leagueCount: 0 };
  }

  // One information_schema probe instead of SELECT 1 × N tables.
  let present = new Set<string>();
  try {
    const placeholders = NATIVE_LEAGUE_TABLE_NAMES.map(() => "?").join(", ");
    const rows = await tidbExecute<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
      [...NATIVE_LEAGUE_TABLE_NAMES],
    );
    present = new Set(rows.map((r) => String(r.table_name)));
  } catch {
    present = new Set();
  }
  const missingTables = NATIVE_LEAGUE_TABLE_NAMES.filter((name) => !present.has(name));

  let leagueCount = 0;
  if (!missingTables.includes("native_leagues")) {
    try {
      const rows = await tidbExecute<{ c: number }>("SELECT COUNT(*) AS c FROM native_leagues");
      leagueCount = Number(rows[0]?.c ?? 0);
    } catch {
      leagueCount = 0;
    }
  }

  return {
    configured: true,
    tablesReady: missingTables.length === 0,
    missingTables: [...missingTables],
    leagueCount,
  };
}

export async function getNativeLeagueById(leagueId: string): Promise<NativeLeagueRow | null> {
  if (!tidbConfigured()) return null;
  const id = String(leagueId ?? "").trim();
  if (!id) return null;
  const rows = await tidbExecute<NativeLeagueRow>(
    `SELECT id, season_year, name, invite_code, commissioner_user_id, status, league_type,
            team_count, current_week, scoring_preset, draft_mode, draft_status, settings_version,
            created_at, updated_at
     FROM native_leagues WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getNativeLeagueByInviteCode(code: string): Promise<NativeLeagueRow | null> {
  if (!tidbConfigured()) return null;
  const invite = String(code ?? "").trim().toUpperCase();
  if (!invite) return null;
  const rows = await tidbExecute<NativeLeagueRow>(
    `SELECT id, season_year, name, invite_code, commissioner_user_id, status, league_type,
            team_count, current_week, scoring_preset, draft_mode, draft_status, settings_version,
            created_at, updated_at
     FROM native_leagues WHERE invite_code = ? LIMIT 1`,
    [invite],
  );
  return rows[0] ?? null;
}

export async function countCommissionerNativeLeagues(userId: string): Promise<number> {
  if (!tidbConfigured()) return 0;
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const rows = await tidbExecute<{ c: number }>(
    `SELECT COUNT(*) AS c FROM native_leagues WHERE commissioner_user_id = ?`,
    [uid],
  );
  return Number(rows[0]?.c ?? 0);
}

export type NativeLeagueAdminListRow = {
  id: string;
  season_year: number;
  name: string;
  invite_code: string;
  commissioner_user_id: string;
  status: string;
  league_type: string;
  team_count: number;
  filled_teams: number;
  current_week: number;
  scoring_preset: string;
  draft_mode: string;
  draft_status: string;
  created_at: string;
};

/** Admin dashboard listing — capped to keep Fluid/TiDB light. */
export async function listNativeLeaguesForAdmin(limit = 500): Promise<NativeLeagueAdminListRow[]> {
  if (!tidbConfigured()) return [];
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  // Join once for filled seats — avoids correlated COUNT per league row.
  return await tidbExecute<NativeLeagueAdminListRow>(
    `SELECT l.id, l.season_year, l.name, l.invite_code, l.commissioner_user_id, l.status,
            l.league_type, l.team_count, l.current_week, l.scoring_preset, l.draft_mode,
            l.draft_status, l.created_at,
            COALESCE(f.c, 0) AS filled_teams
     FROM native_leagues l
     LEFT JOIN (
       SELECT league_id, COUNT(*) AS c FROM native_teams
       WHERE user_id IS NOT NULL GROUP BY league_id
     ) f ON f.league_id = l.id
     ORDER BY l.created_at DESC
     LIMIT ${cap}`,
  );
}

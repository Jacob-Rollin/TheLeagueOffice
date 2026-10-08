import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NativeScoringPreset, NativeDraftMode } from "@/lib/native-league-settings";

async function assertAdminUser(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Strict equality per schema rules — only `admin` grants access.
  if (data?.role !== "admin") throw new Error("Unauthorized");
}

export const createNativeLeague = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      name: string;
      teamCount?: number;
      teamName?: string;
      scoringPreset?: NativeScoringPreset;
      draftMode?: NativeDraftMode;
      seasonYear?: number;
    }) => ({
      name: String(input.name ?? "").slice(0, 128),
      teamCount: Number(input.teamCount ?? 10),
      teamName: input.teamName ? String(input.teamName).slice(0, 64) : undefined,
      scoringPreset: String(input.scoringPreset ?? "half").slice(0, 16) as NativeScoringPreset,
      draftMode: String(input.draftMode ?? "offline").slice(0, 16) as NativeDraftMode,
      seasonYear: Number(input.seasonYear ?? new Date().getUTCFullYear()),
    }),
  )
  .handler(async ({ context, data }) => {
    const { createNativeLeagueForUser } = await import("@/lib/native-league-ops.server");
    return await createNativeLeagueForUser(context.userId, {
      name: data.name,
      teamCount: data.teamCount,
      scoringPreset: data.scoringPreset,
      draftMode: data.draftMode === "live" ? "live" : "offline",
      seasonYear: data.seasonYear,
      ...(data.teamName ? { teamName: data.teamName } : {}),
    });
  });

export const joinNativeLeague = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { inviteCode: string; teamName?: string }) => ({
    inviteCode: String(input.inviteCode ?? "").trim().toUpperCase().slice(0, 16),
    teamName: input.teamName ? String(input.teamName).slice(0, 64) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { joinNativeLeagueForUser } = await import("@/lib/native-league-ops.server");
    return await joinNativeLeagueForUser(context.userId, {
      inviteCode: data.inviteCode,
      ...(data.teamName ? { teamName: data.teamName } : {}),
    });
  });

export type AdminNativeLeagueRow = {
  id: string;
  name: string;
  inviteCode: string;
  seasonYear: number;
  status: string;
  leagueType: string;
  teamCount: number;
  filledTeams: number;
  currentWeek: number;
  scoringPreset: string;
  draftMode: string;
  draftStatus: string;
  createdAt: string;
  commissionerUserId: string;
  commissionerEmail: string | null;
  commissionerName: string | null;
};

export const adminListNativeLeagues = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminNativeLeagueRow[]> => {
    await assertAdminUser(context.userId);
    const { listNativeLeaguesForAdmin } = await import("@/lib/native-league.server");
    const rows = await listNativeLeaguesForAdmin(500);
    if (rows.length === 0) return [];

    const commissionerIds = [...new Set(rows.map((r) => r.commissioner_user_id).filter(Boolean))];
    const profileById = new Map<string, { email: string; full_name: string | null }>();
    if (commissionerIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", commissionerIds);
      if (error) throw new Error(error.message);
      for (const profile of profiles ?? []) {
        profileById.set(String(profile.id), {
          email: String(profile.email ?? ""),
          full_name: profile.full_name ?? null,
        });
      }
    }

    return rows.map((row) => {
      const profile = profileById.get(row.commissioner_user_id);
      return {
        id: row.id,
        name: row.name,
        inviteCode: row.invite_code,
        seasonYear: Number(row.season_year),
        status: row.status,
        leagueType: row.league_type,
        teamCount: Number(row.team_count),
        filledTeams: Number(row.filled_teams ?? 0),
        currentWeek: Number(row.current_week),
        scoringPreset: row.scoring_preset,
        draftMode: row.draft_mode,
        draftStatus: row.draft_status,
        createdAt: row.created_at,
        commissionerUserId: row.commissioner_user_id,
        commissionerEmail: profile?.email || null,
        commissionerName: profile?.full_name ?? null,
      };
    });
  });

export const adminDeleteNativeLeague = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { leagueId: string }) => ({
    leagueId: String(input.leagueId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    await assertAdminUser(context.userId);
    const { adminDeleteNativeLeague: deleteLeague } = await import("@/lib/native-league-ops.server");
    return await deleteLeague(data.leagueId);
  });

export type NativeMemberLeagueSummary = {
  linkId: string;
  leagueId: string;
  role: string;
  teamId: number | null;
  name: string;
  inviteCode: string;
  seasonYear: number;
  status: string;
  leagueType: string;
  teamCount: number;
  filledTeams: number;
  scoringPreset: string;
  draftMode: string;
  draftStatus: string;
  updatedAt: string | null;
  createdAt: string;
  canEditInvite: boolean;
};

export const getNativeLeagueSummary = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }): Promise<NativeMemberLeagueSummary | null> => {
    const { getNativeLeagueSummaryForLink } = await import("@/lib/native-league-ops.server");
    return await getNativeLeagueSummaryForLink(context.userId, data.linkId);
  });

export const updateNativeInviteCode = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; inviteCode: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    inviteCode: String(input.inviteCode ?? "").trim().toUpperCase().slice(0, 16),
  }))
  .handler(async ({ context, data }) => {
    const { updateNativeInviteCodeForUser } = await import("@/lib/native-league-ops.server");
    return await updateNativeInviteCodeForUser(context.userId, data.linkId, data.inviteCode);
  });

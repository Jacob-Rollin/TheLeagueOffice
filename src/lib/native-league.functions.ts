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

/** Batched My Leagues summaries — one Fluid call instead of N× getNativeLeagueSummary. */
export const listNativeLeagueSummaries = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }): Promise<NativeMemberLeagueSummary[]> => {
    const { listNativeLeagueSummariesForUser } = await import("@/lib/native-league-ops.server");
    return await listNativeLeagueSummariesForUser(context.userId);
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

export const getNativeLeagueBoard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { getNativeLeagueBoardForLink } = await import("@/lib/native-league-ops.server");
    return await getNativeLeagueBoardForLink(context.userId, data.linkId);
  });

export const renameNativeTeam = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; teamId: number; teamName: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    teamId: Number(input.teamId),
    teamName: String(input.teamName ?? "").slice(0, 64),
  }))
  .handler(async ({ context, data }) => {
    const { renameNativeTeamForUser } = await import("@/lib/native-league-ops.server");
    return await renameNativeTeamForUser(context.userId, data.linkId, data.teamId, data.teamName);
  });

export const kickNativeTeamMember = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; teamId: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    teamId: Number(input.teamId),
  }))
  .handler(async ({ context, data }) => {
    const { kickNativeTeamMemberForUser } = await import("@/lib/native-league-ops.server");
    return await kickNativeTeamMemberForUser(context.userId, data.linkId, data.teamId);
  });

export const updateNativeLeagueBasics = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: { linkId: string; name?: string; scoringPreset?: NativeScoringPreset; draftMode?: NativeDraftMode }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      name: input.name != null ? String(input.name).slice(0, 128) : undefined,
      scoringPreset: input.scoringPreset
        ? (String(input.scoringPreset).slice(0, 16) as NativeScoringPreset)
        : undefined,
      draftMode: input.draftMode ? (String(input.draftMode).slice(0, 16) as NativeDraftMode) : undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { updateNativeLeagueBasicsForUser } = await import("@/lib/native-league-ops.server");
    return await updateNativeLeagueBasicsForUser(context.userId, data.linkId, {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.scoringPreset ? { scoringPreset: data.scoringPreset } : {}),
      ...(data.draftMode ? { draftMode: data.draftMode } : {}),
    });
  });

export const getNativeDraftState = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { getNativeDraftStateForLink } = await import("@/lib/native-league-ops.server");
    return await getNativeDraftStateForLink(context.userId, data.linkId);
  });

export const assignNativeOfflinePick = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; teamId: number; playerId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    teamId: Number(input.teamId),
    playerId: String(input.playerId ?? "").trim().slice(0, 32),
  }))
  .handler(async ({ context, data }) => {
    const { assignNativeOfflinePickForUser } = await import("@/lib/native-league-ops.server");
    return await assignNativeOfflinePickForUser(context.userId, data.linkId, {
      teamId: data.teamId,
      playerId: data.playerId,
    });
  });

export const undoNativeOfflinePick = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { undoNativeOfflinePickForUser } = await import("@/lib/native-league-ops.server");
    return await undoNativeOfflinePickForUser(context.userId, data.linkId);
  });

export const completeNativeDraft = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { completeNativeDraftForUser } = await import("@/lib/native-league-ops.server");
    return await completeNativeDraftForUser(context.userId, data.linkId);
  });

export const getNativeLineup = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; week?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    week: input.week != null ? Number(input.week) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { getNativeLineupForLink } = await import("@/lib/native-league-ops.server");
    return await getNativeLineupForLink(context.userId, data.linkId, data.week);
  });

export const saveNativeLineup = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      week: number;
      version: number;
      slots: Record<string, Array<string | null>>;
      posById: Record<string, string>;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      week: Number(input.week),
      version: Number(input.version),
      slots: input.slots ?? {},
      posById: input.posById ?? {},
    }),
  )
  .handler(async ({ context, data }) => {
    const { saveNativeLineupForUser } = await import("@/lib/native-league-ops.server");
    return await saveNativeLineupForUser(context.userId, data.linkId, {
      week: data.week,
      version: data.version,
      slots: data.slots,
      posById: data.posById,
    });
  });

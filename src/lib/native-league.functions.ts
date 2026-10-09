import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  NativeDraftMode,
  NativeIrAllowedStatus,
  NativeScoringPreset,
} from "@/lib/native-league-settings";

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
      benchSpots?: number;
      irSpots?: number;
      irAllowedStatuses?: NativeIrAllowedStatus[];
    }) => ({
      name: String(input.name ?? "").slice(0, 128),
      teamCount: Number(input.teamCount ?? 10),
      teamName: input.teamName ? String(input.teamName).slice(0, 64) : undefined,
      scoringPreset: String(input.scoringPreset ?? "half").slice(0, 16) as NativeScoringPreset,
      draftMode: String(input.draftMode ?? "offline").slice(0, 16) as NativeDraftMode,
      seasonYear: Number(input.seasonYear ?? new Date().getUTCFullYear()),
      benchSpots: input.benchSpots != null ? Number(input.benchSpots) : undefined,
      irSpots: input.irSpots != null ? Number(input.irSpots) : undefined,
      irAllowedStatuses: Array.isArray(input.irAllowedStatuses)
        ? (input.irAllowedStatuses as NativeIrAllowedStatus[])
        : undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    const { createNativeLeagueForUser } = await import("@/lib/native-league-ops.server");
    const rosterSlots =
      data.benchSpots != null || data.irSpots != null
        ? {
            ...(data.benchSpots != null ? { BN: data.benchSpots } : {}),
            ...(data.irSpots != null ? { IR: data.irSpots } : {}),
          }
        : undefined;
    return await createNativeLeagueForUser(context.userId, {
      name: data.name,
      teamCount: data.teamCount,
      scoringPreset: data.scoringPreset,
      draftMode: data.draftMode === "live" ? "live" : "offline",
      seasonYear: data.seasonYear,
      ...(data.teamName ? { teamName: data.teamName } : {}),
      ...(rosterSlots ? { rosterSlots } : {}),
      ...(data.irAllowedStatuses ? { irAllowedStatuses: data.irAllowedStatuses } : {}),
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
  .inputValidator((input: { linkId: string } & Record<string, unknown>) => {
    const linkId = String(input.linkId ?? "").trim().slice(0, 36);
    const patch: Record<string, unknown> = { linkId };
    const copy = (key: string) => {
      if (input[key] !== undefined) patch[key] = input[key];
    };
    for (const key of [
      "name",
      "scoringPreset",
      "scoringSettings",
      "draftMode",
      "draftFormat",
      "draftOrderType",
      "draftPickTimeLimitSec",
      "benchSpots",
      "irSpots",
      "irAllowedStatuses",
      "seasonStartWeek",
      "isPublic",
      "autoActivateNextYear",
      "playoffTeams",
      "playoffMatchupLength",
      "playoffWeekPair",
      "standingsTiebreaker",
      "allowMatchupTies",
      "matchupTiebreakerSlot",
      "divisionsEnabled",
      "waiverType",
      "waiverBudget",
      "waiverPeriodDays",
      "postDraftPlayerStatus",
      "lockFaOnGametime",
      "maxAddsPerWeek",
      "maxAddsPerSeason",
      "undroppableTopPlayers",
      "rosterLockType",
      "tradeDeadlineWeek",
      "tradeReviewHours",
      "tradeVetoMode",
      "maxTradesPerSeason",
      "keepersPerTeam",
      "keeperNote",
      "teamCount",
      "allowAiTeams",
    ]) {
      copy(key);
    }
    if (typeof patch["name"] === "string") patch["name"] = patch["name"].slice(0, 128);
    if (typeof patch["scoringPreset"] === "string") {
      patch["scoringPreset"] = patch["scoringPreset"].slice(0, 16) as NativeScoringPreset;
    }
    if (typeof patch["draftMode"] === "string") {
      patch["draftMode"] = patch["draftMode"].slice(0, 16) as NativeDraftMode;
    }
    if (Array.isArray(patch["irAllowedStatuses"])) {
      patch["irAllowedStatuses"] = patch["irAllowedStatuses"] as NativeIrAllowedStatus[];
    }
    return patch as { linkId: string } & Record<string, unknown>;
  })
  .handler(async ({ context, data }) => {
    const { updateNativeLeagueBasicsForUser } = await import("@/lib/native-league-ops.server");
    const { linkId, ...patch } = data;
    return await updateNativeLeagueBasicsForUser(context.userId, linkId, patch);
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
  .inputValidator((input: { linkId: string; startWeek?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    startWeek: input.startWeek != null ? Number(input.startWeek) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { completeNativeDraftForUser } = await import("@/lib/native-league-ops.server");
    return await completeNativeDraftForUser(context.userId, data.linkId, {
      ...(data.startWeek != null ? { startWeek: data.startWeek } : {}),
    });
  });

/** Commissioner: advance or jump the league's live week (optionally refresh AI lineups). */
export const setNativeLeagueWeek = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; toWeek?: number; runAiLineups?: boolean }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    toWeek: input.toWeek != null ? Number(input.toWeek) : undefined,
    runAiLineups: input.runAiLineups !== false,
  }))
  .handler(async ({ context, data }) => {
    const { setNativeLeagueWeekForUser } = await import("@/lib/native-league-ops.server");
    return await setNativeLeagueWeekForUser(context.userId, data.linkId, {
      ...(data.toWeek != null ? { toWeek: data.toWeek } : {}),
      runAiLineups: data.runAiLineups,
    });
  });

/** Commissioner testing: add/drop a player on any team roster (skip draft / FA rules). */
export const commissionerEditNativeRoster = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      teamId: number;
      addPlayerId?: string | null;
      dropPlayerId?: string | null;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      teamId: Number(input.teamId),
      addPlayerId:
        input.addPlayerId == null || input.addPlayerId === ""
          ? null
          : String(input.addPlayerId).trim().slice(0, 32),
      dropPlayerId:
        input.dropPlayerId == null || input.dropPlayerId === ""
          ? null
          : String(input.dropPlayerId).trim().slice(0, 32),
    }),
  )
  .handler(async ({ context, data }) => {
    const { commissionerEditRosterForUser } = await import("@/lib/native-league-ops.server");
    return await commissionerEditRosterForUser(context.userId, data.linkId, {
      teamId: data.teamId,
      addPlayerId: data.addPlayerId,
      dropPlayerId: data.dropPlayerId,
    });
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
      injuryById?: Record<string, string | null | undefined>;
      teamByPlayerId?: Record<string, string | null | undefined>;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      week: Number(input.week),
      version: Number(input.version),
      slots: input.slots ?? {},
      posById: input.posById ?? {},
      injuryById: input.injuryById ?? {},
      teamByPlayerId: input.teamByPlayerId ?? {},
    }),
  )
  .handler(async ({ context, data }) => {
    const { saveNativeLineupForUser } = await import("@/lib/native-league-ops.server");
    return await saveNativeLineupForUser(context.userId, data.linkId, {
      week: data.week,
      version: data.version,
      slots: data.slots,
      posById: data.posById,
      injuryById: data.injuryById,
      teamByPlayerId: data.teamByPlayerId,
    });
  });

export const submitNativeFreeAgentMove = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      addPlayerId: string;
      dropPlayerId?: string | null;
      rosterVersion: number;
      addPlayerTeam?: string | null;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      addPlayerId: String(input.addPlayerId ?? "").trim().slice(0, 32),
      dropPlayerId:
        input.dropPlayerId == null || input.dropPlayerId === ""
          ? null
          : String(input.dropPlayerId).trim().slice(0, 32),
      rosterVersion: Number(input.rosterVersion),
      addPlayerTeam:
        input.addPlayerTeam == null || input.addPlayerTeam === ""
          ? null
          : String(input.addPlayerTeam).trim().slice(0, 8),
    }),
  )
  .handler(async ({ context, data }) => {
    const { submitNativeFreeAgentMoveForUser } = await import("@/lib/native-league-ops.server");
    return await submitNativeFreeAgentMoveForUser(context.userId, data.linkId, {
      addPlayerId: data.addPlayerId,
      dropPlayerId: data.dropPlayerId,
      rosterVersion: data.rosterVersion,
      addPlayerTeam: data.addPlayerTeam,
    });
  });

/** Pure drop (no add) for native leagues — frees a roster slot. */
export const submitNativeFreeAgentDrop = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; dropPlayerId: string; rosterVersion: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    dropPlayerId: String(input.dropPlayerId ?? "").trim().slice(0, 32),
    rosterVersion: Number(input.rosterVersion),
  }))
  .handler(async ({ context, data }) => {
    const { submitNativeFreeAgentDropForUser } = await import("@/lib/native-league-ops.server");
    return await submitNativeFreeAgentDropForUser(context.userId, data.linkId, {
      dropPlayerId: data.dropPlayerId,
      rosterVersion: data.rosterVersion,
    });
  });

export const listNativeTransactions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; limit?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    limit: input.limit != null ? Number(input.limit) : 40,
  }))
  .handler(async ({ context, data }) => {
    const { listNativeTransactionsForLink } = await import("@/lib/native-league-ops.server");
    return await listNativeTransactionsForLink(context.userId, data.linkId, data.limit);
  });

export const resolveNativeIrViolation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      playerId: string;
      action: "drop" | "activate";
      dropPlayerId?: string | null;
      rosterVersion: number;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      playerId: String(input.playerId ?? "").trim().slice(0, 32),
      action: input.action === "activate" ? ("activate" as const) : ("drop" as const),
      dropPlayerId:
        input.dropPlayerId == null || input.dropPlayerId === ""
          ? null
          : String(input.dropPlayerId).trim().slice(0, 32),
      rosterVersion: Number(input.rosterVersion),
    }),
  )
  .handler(async ({ context, data }) => {
    const { resolveNativeIrViolationForUser } = await import("@/lib/native-league-ops.server");
    return await resolveNativeIrViolationForUser(context.userId, data.linkId, {
      playerId: data.playerId,
      action: data.action,
      dropPlayerId: data.dropPlayerId,
      rosterVersion: data.rosterVersion,
    });
  });

export const listNativeWaiverClaims = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { listNativeWaiverClaimsForLink } = await import("@/lib/native-league-gameplay.server");
    return await listNativeWaiverClaimsForLink(context.userId, data.linkId);
  });

export const submitNativeWaiverClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      playerToAdd: string;
      playerToDrop?: string | null;
      bidAmount?: number | null;
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      playerToAdd: String(input.playerToAdd ?? "").trim().slice(0, 32),
      playerToDrop:
        input.playerToDrop == null || input.playerToDrop === ""
          ? null
          : String(input.playerToDrop).trim().slice(0, 32),
      bidAmount: input.bidAmount == null ? null : Number(input.bidAmount),
    }),
  )
  .handler(async ({ context, data }) => {
    const { submitNativeWaiverClaimForUser } = await import("@/lib/native-league-gameplay.server");
    return await submitNativeWaiverClaimForUser(context.userId, data.linkId, data);
  });

export const cancelNativeWaiverClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; claimId: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    claimId: Number(input.claimId),
  }))
  .handler(async ({ context, data }) => {
    const { cancelNativeWaiverClaimForUser } = await import("@/lib/native-league-gameplay.server");
    return await cancelNativeWaiverClaimForUser(context.userId, data.linkId, data.claimId);
  });

export const listNativeTrades = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { listNativeTradesForLink } = await import("@/lib/native-league-gameplay.server");
    return await listNativeTradesForLink(context.userId, data.linkId);
  });

export const proposeNativeTrade = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: {
      linkId: string;
      acceptorTeamId: number;
      givePlayerIds: string[];
      receivePlayerIds: string[];
    }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      acceptorTeamId: Number(input.acceptorTeamId),
      givePlayerIds: Array.isArray(input.givePlayerIds)
        ? input.givePlayerIds.map((id) => String(id).trim().slice(0, 32)).filter(Boolean)
        : [],
      receivePlayerIds: Array.isArray(input.receivePlayerIds)
        ? input.receivePlayerIds.map((id) => String(id).trim().slice(0, 32)).filter(Boolean)
        : [],
    }),
  )
  .handler(async ({ context, data }) => {
    const { proposeNativeTradeForUser } = await import("@/lib/native-league-gameplay.server");
    return await proposeNativeTradeForUser(context.userId, data.linkId, data);
  });

export const respondNativeTrade = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    (input: { linkId: string; tradeId: number; action: "accept" | "reject" | "cancel" | "veto" }) => ({
      linkId: String(input.linkId ?? "").trim().slice(0, 36),
      tradeId: Number(input.tradeId),
      action: (["accept", "reject", "cancel", "veto"] as const).includes(input.action)
        ? input.action
        : ("reject" as const),
    }),
  )
  .handler(async ({ context, data }) => {
    const { respondNativeTradeForUser } = await import("@/lib/native-league-gameplay.server");
    return await respondNativeTradeForUser(context.userId, data.linkId, data);
  });

export const getNativeMatchupWeek = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; week?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    week: input.week != null ? Number(input.week) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { getNativeMatchupWeekForLink } = await import("@/lib/native-league-gameplay.server");
    return await getNativeMatchupWeekForLink(context.userId, data.linkId, data.week);
  });

export const getNativeStandings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
  }))
  .handler(async ({ context, data }) => {
    const { getNativeStandingsForLink } = await import("@/lib/native-league-gameplay.server");
    return await getNativeStandingsForLink(context.userId, data.linkId);
  });

export const setNativeTeamAi = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; teamId: number; enabled: boolean }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    teamId: Number(input.teamId),
    enabled: Boolean(input.enabled),
  }))
  .handler(async ({ context, data }) => {
    const { setNativeTeamAiForUser } = await import("@/lib/native-league-ai.server");
    return await setNativeTeamAiForUser(context.userId, data.linkId, data);
  });

/** Commissioner: fill consecutive on-the-clock AI draft picks (bounded). */
export const runNativeAiDraft = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; maxPicks?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    maxPicks: input.maxPicks != null ? Number(input.maxPicks) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { runNativeAiDraftForUser } = await import("@/lib/native-league-ai.server");
    return await runNativeAiDraftForUser(context.userId, data.linkId, {
      ...(data.maxPicks != null ? { maxPicks: data.maxPicks } : {}),
    });
  });

/** Commissioner: set AI team lineups for the week (bye / Out / IR aware). */
export const runNativeAiLineups = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { linkId: string; week?: number }) => ({
    linkId: String(input.linkId ?? "").trim().slice(0, 36),
    week: input.week != null ? Number(input.week) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const { runNativeAiLineupsForUser } = await import("@/lib/native-league-ai.server");
    return await runNativeAiLineupsForUser(context.userId, data.linkId, {
      ...(data.week != null ? { week: data.week } : {}),
    });
  });

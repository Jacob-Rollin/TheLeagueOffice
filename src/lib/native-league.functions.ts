import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NativeScoringPreset, NativeDraftMode } from "@/lib/native-league-settings";

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

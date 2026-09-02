import { createServerFn } from "@tanstack/react-start";

/** League-specific scoring rules for the active synced host. */
export const getLeagueScoring = createServerFn({ method: "GET" })
  .inputValidator((input: { identifier: string; platform?: string; s2?: string; swid?: string }) => ({
    identifier: String(input.identifier ?? "").slice(0, 64),
    platform: String(input.platform ?? "sleeper").slice(0, 16),
    s2: input.s2 ? String(input.s2).slice(0, 512) : undefined,
    swid: input.swid ? String(input.swid).slice(0, 64) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadLeagueScoring } = await import("./scoring.server");
    return await loadLeagueScoring(data.identifier, data.platform, data.s2, data.swid);
  });

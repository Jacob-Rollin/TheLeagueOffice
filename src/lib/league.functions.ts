import { createServerFn } from "@tanstack/react-start";

export const getUserLeagues = createServerFn({ method: "GET" })
  .inputValidator((input: { username: string }) => ({
    username: String(input.username ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    const { loadUserLeagues } = await import("./league.server");
    return await loadUserLeagues(data.username);
  });

export const getStandings = createServerFn({ method: "GET" })
  .inputValidator((input: { leagueId: string }) => ({
    leagueId: String(input.leagueId ?? "").slice(0, 32),
  }))
  .handler(async ({ data }) => {
    const { loadStandings } = await import("./league.server");
    return await loadStandings(data.leagueId);
  });

export const getLeagueSync = createServerFn({ method: "GET" })
  .inputValidator((input: { leagueId: string; username?: string }) => ({
    leagueId: String(input.leagueId ?? "").slice(0, 32),
    username: String(input.username ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    const { loadLeagueSync } = await import("./league.server");
    return await loadLeagueSync(data.leagueId, data.username);
  });

export const getConnectionMeta = createServerFn({ method: "GET" })
  .inputValidator((input: { identifier: string; platform?: string; s2?: string; swid?: string }) => ({
    identifier: String(input.identifier ?? "").slice(0, 64),
    platform: String(input.platform ?? "sleeper").slice(0, 16),
    s2: input.s2 ? String(input.s2).slice(0, 512) : undefined,
    swid: input.swid ? String(input.swid).slice(0, 64) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadConnectionMeta, loadEspnConnectionMeta } = await import("./league.server");
    if (data.platform === "espn") return await loadEspnConnectionMeta(data.identifier, data.s2, data.swid);
    return await loadConnectionMeta(data.identifier);
  });

export const getConnectionStandings = createServerFn({ method: "GET" })
  .inputValidator((input: { identifier: string; platform?: string; s2?: string; swid?: string }) => ({
    identifier: String(input.identifier ?? "").slice(0, 64),
    platform: String(input.platform ?? "sleeper").slice(0, 16),
    s2: input.s2 ? String(input.s2).slice(0, 512) : undefined,
    swid: input.swid ? String(input.swid).slice(0, 64) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadConnectionStandings } = await import("./league.server");
    return await loadConnectionStandings(data.identifier, data.platform, data.s2, data.swid);
  });
